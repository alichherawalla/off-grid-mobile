import { useActiveMobileModel } from '../../hooks/useActiveMobileModel';
import { useCallback, useRef, useState } from 'react';
import { useWhisperTranscription } from '../../hooks/useWhisperTranscription';
import { useWhisperStore } from '../../stores';
import { mobileModelCommands } from '../../services/modelServices/modelCommandApplication';
import {
  mobileTranscriptionRuntime,
  transcriptionModelIntents,
} from '../../services/modelServices/transcriptionRuntimePort';
import { supportsAudioInput } from '../../services/modelServices/modelState';
import { audioRecorderService } from '../../services/audioRecorderService';
import { recordingController } from '../../services/recordingController';
import { useSilenceEndpoint, type SilenceEndpoint } from './useSilenceEndpoint';
import { finaliseRecording, type RecordedAudio } from './finaliseRecording';
import { useVoiceSessionDriver } from './useVoiceSessionDriver';
import { voiceSession } from '../../services/voiceSession';
import {
  transcriptionOutcomeFrom,
  transcriptionOutcomeMessage,
  transcriptionShouldDispatch,
  type TranscriptionOutcome,
} from '@offgrid/application';
import { ensureWhisperForTranscription } from './ensureWhisperForTranscription';
import logger from '../../utils/logger';
import { executeMobileTranscription } from '../../services/mobileTranscription';
import {
  cancelVoiceRecording,
  stopVoiceRecording,
  useVoiceControllerEffects,
} from './voiceControllerEffects';

interface UseVoiceInputParams {
  conversationId?: string | null;
  interfaceMode: 'chat' | 'audio';
  onTranscript: (text: string) => void;
  onAudioAttachment?: (audio: {
    uri: string;
    format: 'wav' | 'mp3';
    durationSeconds?: number;
    transcription?: string;
  }) => void;
  /** Called in Audio Mode to auto-send. Includes audio info so caller can build attachment atomically. */
  onAutoSend?: (
    text: string,
    audio: { uri: string; format: 'wav' | 'mp3'; durationSeconds: number },
  ) => void;
}

/** Stop the recorder and produce the note the person MEANT - dead air cut from both ends. The one
 *  artifact every stop path shares, so two paths cannot disagree about what a recording is. */
async function stopAndFinalise(
  silence: SilenceEndpoint,
): Promise<RecordedAudio> {
  return finaliseRecording(
    await audioRecorderService.stopRecording(),
    silence.silenceBeforeSpeech(),
    silence.silenceAfterSpeech(),
  );
}

function recordedTranscriptionOutcome(
  modelReady: boolean,
  transcript: string,
  durationSeconds: number,
): TranscriptionOutcome {
  return transcriptionOutcomeFrom({
    audioBytes: durationSeconds > 0 ? 1 : 0,
    modelReady,
    cleanedText: transcript,
  });
}

function visibleTranscriptionFailure(outcome: TranscriptionOutcome): string {
  return transcriptionOutcomeMessage(outcome) ?? 'Transcription was cancelled.';
}

/** Build the one readiness boundary shared by realtime and file transcription. */
function createWhisperReadiness(
  downloadedModelId: string | null,
  remoteTranscriptionAvailable: boolean,
): () => Promise<boolean> {
  if (remoteTranscriptionAvailable) return async () => true;
  return () =>
    ensureWhisperForTranscription({
      isSelectedModelLoaded: () =>
        !!downloadedModelId &&
        mobileTranscriptionRuntime.isSelectedModelLoaded(downloadedModelId),
      hasDownloadedModel: () => !!downloadedModelId,
      loadWhisper: () => transcriptionModelIntents.loadModel(),
      freeGenerationModels: () =>
        mobileModelCommands.release(['text', 'image']),
    });
}

function useRemoteTranscriptionAvailable(): boolean {
  return useActiveMobileModel('transcription').model?.source === 'remote';
}

function settleVoiceIntent(intent: Promise<unknown>, label: string): void {
  intent.catch(error => logger.error(label, error));
}

/** End a no-speech turn once and keep its message visible long enough to read. */
function presentTranscriptionFailure(
  message: string,
  setError: (value: string | null) => void,
): void {
  voiceSession.dispatch('nothingHeard');
  setError(message);
  setTimeout(() => setError(null), 3000);
}

export function useVoiceInput({
  conversationId,
  interfaceMode,
  onTranscript,
  onAudioAttachment,
  onAutoSend,
}: UseVoiceInputParams) {
  const recordingConversationIdRef = useRef<string | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onAudioAttachmentRef = useRef(onAudioAttachment);
  onAudioAttachmentRef.current = onAudioAttachment;
  const onAutoSendRef = useRef(onAutoSend);
  onAutoSendRef.current = onAutoSend;
  const { downloadedModelId, transcriptionLanguage } = useWhisperStore();
  const remoteTranscriptionAvailable = useRemoteTranscriptionAvailable();
  const [isDirectRecording, setIsDirectRecording] = useState(false);
  const [isAudioModeRecording, setIsAudioModeRecording] = useState(false);
  /** Hands-free: the mic is open but nobody has spoken yet, so the turn has not begun. */
  const [isTranscribingFile, setIsTranscribingFile] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);

  const supportsDirectAudio = (): boolean =>
    supportsAudioInput() && audioRecorderService.supportsDirectAudioInput();

  // The rendered composer mode is the recording mode. Passing it in prevents the
  // Voice layout and recorder from observing two different store snapshots.
  const isInAudioInterfaceMode = (): boolean => interfaceMode === 'audio';

  // Use file-based transcription path when: Audio Mode + Whisper available + not direct audio model
  const shouldUseFilePath = (): boolean =>
    isInAudioInterfaceMode() && !!downloadedModelId && !supportsDirectAudio();

  const ensureWhisper = createWhisperReadiness(
    downloadedModelId,
    remoteTranscriptionAvailable,
  );

  const {
    isRecording: isWhisperRecording,
    isModelLoading,
    isStartingRecording,
    isTranscribing: isWhisperTranscribing,
    partialResult,
    finalResult,
    error: whisperError,
    startRecording: startWhisperRecording,
    stopRecording: stopWhisperRecording,
    clearResult,
  } = useWhisperTranscription({ ensureModelReady: ensureWhisper });

  const isTranscribing = isWhisperTranscribing || isTranscribingFile;
  const isRecording =
    isDirectRecording || isAudioModeRecording || isWhisperRecording;
  const error = directError ?? whisperError;

  // voiceAvailable: direct audio OR whisper downloaded
  const voiceAvailable =
    supportsDirectAudio() ||
    !!downloadedModelId ||
    remoteTranscriptionAvailable;

  useVoiceSessionDriver({
    // Hands-free auto-arm is voice-mode only (a global setting leaves the session in `listen`, so
    // without this it armed the mic in a text/image chat too); tap-to-dictate via recordingController
    // is deliberately NOT gated. No silencing: a reply only plays while speaking, so the mic can't collide.
    startTurn: () => {
      if (isInAudioInterfaceMode())
        settleVoiceIntent(startRef.current({ silenceAssistant: false }), '[Voice] Auto-arm failed');
    },
  });
  const silence = useSilenceEndpoint({
    isInAudioInterfaceMode,
    // stopRef is assigned below and kept current every render, so this is never a stale closure.
    stopTurn: () => settleVoiceIntent(stopRef.current(), '[Voice] Auto-stop failed'),
  });
  const listenForSilence = silence.listen;
  const stopListeningForSilence = silence.stop;

  const startRecording = async (opts: { silenceAssistant?: boolean } = {}) => {
    // Taking the floor by TAPPING silences the assistant, as it always did. A hands-free ARM must not:
    // it opens the mic before the assistant has even started speaking, so stopping speech here killed
    // autoplay outright. Echo cancellation is what makes the overlap safe, and barge-in stops the
    // assistant on actual detected speech instead - which is the honest trigger for it.
    const { silenceAssistant = true } = opts;
    // The session decides whether a mic may be open. Nothing else needs asking.
    if (!voiceSession.micShouldBeOpen()) {
      logger.log('[TURN] start refused - session is not listening');
      return;
    }
    logger.log(
      `[TURN] start (${
        silenceAssistant ? 'tapped' : 'hands-free arm'
      }) direct=${supportsDirectAudio()} file=${shouldUseFilePath()}`,
    );
    recordingConversationIdRef.current = conversationId || null;
    setDirectError(null);

    if (supportsDirectAudio() || remoteTranscriptionAvailable) {
      try {
        setIsDirectRecording(true);
        await audioRecorderService.startRecording();
        listenForSilence();
      } catch (err) {
        setIsDirectRecording(false);
        const msg = err instanceof Error ? err.message : 'Recording failed';
        logger.error('[Voice] Direct audio recording error:', err);
        setDirectError(msg);
      }
      return;
    }

    if (shouldUseFilePath()) {
      try {
        setIsAudioModeRecording(true);
        await audioRecorderService.startRecording();
        listenForSilence();
      } catch (err) {
        setIsAudioModeRecording(false);
        const msg = err instanceof Error ? err.message : 'Recording failed';
        logger.error('[Voice] Audio mode recording error:', err);
        setDirectError(msg);
      }
      return;
    }

    // The whisper path drives its own recorder, so this turn's token would otherwise be held by a
    // mic this code never opened.
    await startWhisperRecording();
  };

  // Transcribe a just-recorded file, toggling the transcribing flag around the work.
  // whisperReady tracks whether the MODEL loaded — a throw from transcribeFile after a
  // successful load is a transcription miss (not a load failure), so whisperReady stays
  // true and the user gets "couldn't hear that", not "couldn't load the voice model".
  const transcribeRecordedFile = async (
    path: string,
    errLabel: string,
  ): Promise<{ whisperReady: boolean; transcript: string }> => {
    let whisperReady = false;
    let transcript = '';
    if (downloadedModelId || remoteTranscriptionAvailable) {
      setIsTranscribingFile(true);
      try {
        whisperReady = await ensureWhisper();
        if (whisperReady)
          transcript = await executeMobileTranscription(path, {
            language: transcriptionLanguage,
          });
      } catch (err) {
        logger.error(errLabel, err);
      }
      setIsTranscribingFile(false);
    }
    return { whisperReady, transcript };
  };

  // Direct-audio model: after stopping, transcribe and either auto-send (Audio Mode) or
  // attach the transcript (Chat mode). In ANY mode we send a TRANSCRIPT, never raw audio.
  const stopDirectRecording = async () => {
    try {
      const { path, durationSeconds } = await stopAndFinalise(silence);
      setIsDirectRecording(false);
      if (
        !recordingConversationIdRef.current ||
        recordingConversationIdRef.current === conversationId
      ) {
        const format = audioRecorderService.getFormat();
        // In Audio Mode, transcribe FIRST, then auto-send with the text.
        // Sending audio with EMPTY text made the intent router classify on "" — so a
        // voice request like "draw a dog" always routed to the text model (image gen
        // needs the transcribed prompt, which never reached routing). We still attach
        // the audio so multimodal text models get the original speech; the text is what
        // lets routing pick image vs text.
        if (onAutoSendRef.current && isInAudioInterfaceMode()) {
          const { whisperReady, transcript } = await transcribeRecordedFile(
            path,
            '[Voice] transcription error:',
          );
          // NEVER dispatch an empty transcript — that misroutes to the text model.
          const outcome = recordedTranscriptionOutcome(whisperReady, transcript, durationSeconds);
          if (transcriptionShouldDispatch(outcome)) {
            onAutoSendRef.current(outcome.text, {
              uri: path,
              format,
              durationSeconds,
            });
          } else {
            // Nothing to send. Hands-free must NOT re-open the mic: on device that spun - record,
            // hear the room, transcribe to nothing, arm again - three turns in eight seconds with no
            // output. A person tapping the mic resumes it.
            presentTranscriptionFailure(visibleTranscriptionFailure(outcome), setDirectError);
          }
        } else {
          // CHAT mode: STT is dictation-into-the-input-box on EVERY engine — the SAME behavior a non-audio
          // (llama) model's hold-to-talk has. Transcribe the recording and drop the text into the composer
          // for the user to review/edit/send; do NOT build a voice-note attachment (that was the litert-only
          // divergence). Voice/Audio interface mode still attaches audio above. `durationSeconds`/`format`
          // are unused here now (no attachment) — the temp recording file is transient.
          const { whisperReady, transcript } = await transcribeRecordedFile(
            path,
            '[Voice] chat-mode dictation transcription error:',
          );
          const outcome = recordedTranscriptionOutcome(whisperReady, transcript, durationSeconds);
          if (transcriptionShouldDispatch(outcome)) {
            onTranscriptRef.current(outcome.text);
          } else {
            // Nothing to send. Hands-free must NOT re-open the mic: on device that spun - record,
            // hear the room, transcribe to nothing, arm again - three turns in eight seconds with no
            // output. A person tapping the mic resumes it.
            presentTranscriptionFailure(visibleTranscriptionFailure(outcome), setDirectError);
          }
        }
      }
      recordingConversationIdRef.current = null;
    } catch (err) {
      setIsDirectRecording(false);
      logger.error('[Voice] Failed to stop direct recording:', err);
    }
  };

  // Audio Mode with a Whisper model: stop, transcribe the file, then auto-send or attach.
  const stopAudioModeRecording = async () => {
    try {
      const { path, durationSeconds } = await stopAndFinalise(silence);
      setIsAudioModeRecording(false);
      if (
        recordingConversationIdRef.current &&
        recordingConversationIdRef.current !== conversationId
      ) {
        recordingConversationIdRef.current = null;
        return;
      }
      setIsTranscribingFile(true);
      let whisperReady = false;
      let transcript = '';
      try {
        whisperReady = await ensureWhisper();
        if (whisperReady)
          transcript = await executeMobileTranscription(path, {
            language: transcriptionLanguage,
          });
      } catch (transcribeErr) {
        logger.error('[Voice] File transcription error:', transcribeErr);
      }
      setIsTranscribingFile(false);
      recordingConversationIdRef.current = null;
      // NEVER dispatch an empty transcript — that misroutes to the text model.
      const outcome = recordedTranscriptionOutcome(whisperReady, transcript, durationSeconds);
      if (transcriptionShouldDispatch(outcome)) {
        if (onAutoSendRef.current) {
          onAutoSendRef.current(outcome.text, {
            uri: path,
            format: 'wav',
            durationSeconds,
          });
        } else {
          onAudioAttachmentRef.current?.({
            uri: path,
            format: 'wav',
            durationSeconds,
            transcription: outcome.text,
          });
          onTranscriptRef.current(outcome.text);
        }
      } else {
        presentTranscriptionFailure(visibleTranscriptionFailure(outcome), setDirectError);
      }
    } catch (err) {
      setIsAudioModeRecording(false);
      setIsTranscribingFile(false);
      logger.error('[Voice] Failed to stop audio mode recording:', err);
    }
  };

  const stopRecording = async () => {
    logger.log('[TURN] stop requested');
    await stopVoiceRecording({
      isChatDictation: !isInAudioInterfaceMode(),
      isDirectRecording,
      isAudioModeRecording,
      stopListeningForSilence,
      stopDirectRecording,
      stopAudioModeRecording,
      stopWhisperRecording,
    });
  };

  const cancelRecording = () => cancelVoiceRecording({
    isDirectRecording,
    isAudioModeRecording,
    setIsDirectRecording,
    setIsAudioModeRecording,
    stopWhisperRecording,
    clearWhisperResult: clearResult,
    clearConversation: () => { recordingConversationIdRef.current = null; },
    stopListeningForSilence,
  });

  // Register this recorder's concrete intents with the single recording-controller
  // owner, and report phase transitions to it (the controller is the one source of
  // truth every mic reads). Stable wrappers call the latest closures via refs so
  // re-registration isn't needed each render.
  const startRef = useRef(startRecording);
  startRef.current = startRecording;
  const stopRef = useRef(stopRecording);
  stopRef.current = stopRecording;
  const cancelRef = useRef(cancelRecording);
  cancelRef.current = cancelRecording;
  const deliverTranscript = useCallback((text: string) => {
    onTranscriptRef.current(text);
  }, []);
  useVoiceControllerEffects({
    conversationId,
    recordingConversationIdRef,
    startRef,
    stopRef,
    cancelRef,
    finalResult,
    clearResult,
    deliverTranscript,
  });

  return {
    isRecording,
    isAwaitingSpeech: silence.isAwaitingSpeech,
    isModelLoading,
    isStartingRecording,
    isTranscribing,
    partialResult,
    error,
    voiceAvailable,
    // INTENTS, not mechanics: the controller's registered handlers own the session decisions
    // (userStart out of stopped, userStop on a deliberate hands-free stop). Handing out the raw
    // closures let the stop button bypass that - the stop read as a captured turn and re-armed.
    startRecording: () => recordingController.start(),
    stopRecording: () => recordingController.stop(),
    cancelRecording: () => recordingController.cancel(),
    clearResult,
    /** True when model accepts audio directly (no Whisper needed) */
    isDirectAudioMode: supportsDirectAudio(),
    /** True when recording in Audio Mode for file-based transcription */
    isAudioModeRecording,
  };
}
