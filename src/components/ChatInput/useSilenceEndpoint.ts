import { useRef, useState } from 'react';
import { useAppStore } from '../../stores';
import { audioRecorderService } from '../../services/audioRecorderService';
import {
  SpeechEndpointTimer,
  SPEECH_ONSET_LOOKBACK_MS,
  DEFAULT_SILENCE_AFTER_SPEECH_MS,
} from '@offgrid/speech';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { voiceSession } from '../../services/voiceSession';
import logger from '../../utils/logger';

/**
 * When a spoken turn begins and when it ends.
 *
 * Its own hook because it is its own question. useVoiceInput owns the recorder lifecycle - permission,
 * start, stop, transcribe, send - and "has this person finished talking" is a decision about audio
 * that happens to interrupt that lifecycle. Keeping them apart is also what keeps useVoiceInput under
 * the function-length limit, but the reason is the concern, not the line count.
 *
 * Wired to the FILE-recording path deliberately: that is what the record button actually takes.
 * audioRecorderService records to a file and transcribeFile produces the transcript afterwards. The
 * realtime whisper API is a different path that voice mode never calls - instrumenting it produced no
 * logs at all, which cost hours.
 */
export interface SilenceEndpoint {
  /** Begin watching the room. No-op unless voice mode and the setting allow it. */
  listen: () => void;
  /** Stop watching, however the turn ended. Safe to call when not listening. */
  stop: () => void;
  /** Hands-free only: the microphone is open but nobody has spoken, so the turn has not begun. */
  isAwaitingSpeech: boolean;
  /** Seconds of recording before the person actually started speaking, already offset by the
   *  detection delay. 0 when nothing was heard or the mode never waited. */
  silenceBeforeSpeech: () => number;
  /** Seconds of dead air at the END of the turn - the quiet since the last heard speech, less the
   *  hangover. When the turn ended on silence this is the person's whole chosen window; on a manual
   *  stop it is however long they had already been quiet. 0 when nothing was watching. */
  silenceAfterSpeech: () => number;
}

export function useSilenceEndpoint(opts: {
  /** Voice mode only - chat dictation must never be auto-stopped. */
  isInAudioInterfaceMode: () => boolean;
  /** The SAME stop the button runs, so a turn finalises identically however it ended. */
  stopTurn: () => void;
  /** Told the turn ended because the room went quiet, NOT because someone pressed stop. Hands-free
   *  only hands the floor back by itself in the first case; a deliberate stop has to mean stop. */
  onEndedBySilence?: () => void;
}): SilenceEndpoint {
  const endpointRef = useRef<SpeechEndpointTimer | null>(null);
  const levelsOffRef = useRef<(() => void) | null>(null);
  const [isAwaitingSpeech, setIsAwaitingSpeech] = useState(false);
  /** Latched for the turn: barge-in fires once on the first speech, not on every loud buffer. */
  const awaitingRef = useRef(false);
  /** When listening began, and when speech was first confirmed - the two the front-trim needs. */
  const listenAtRef = useRef(0);
  const speechAtRef = useRef(0);
  /** Dead air at the turn's end, captured from the endpoint at the moment watching stops - the
   *  endpoint is gone by the time the recording finalises, so the number must be taken here. */
  const tailRef = useRef(0);

  const stop = (): void => {
    awaitingRef.current = false;
    setIsAwaitingSpeech(false);
    if (endpointRef.current) tailRef.current = endpointRef.current.quietTailSeconds();
    endpointRef.current?.cancel();
    endpointRef.current = null;
    levelsOffRef.current?.();
    levelsOffRef.current = null;
  };

  const listen = (): void => {
    stop();
    // Cleared BEFORE any early return below. These two drive the front-trim, and every path that
    // declines to watch a turn - tap mode, chat dictation - used to leave the PREVIOUS hands-free
    // turn's numbers in place, so the next recording was trimmed against timings that were not its
    // own. Cutting the front off audio nobody was watching is silent data loss.
    listenAtRef.current = 0;
    speechAtRef.current = 0;
    tailRef.current = 0;
    // VOICE MODE ONLY. Chat-mode dictation is someone typing with their voice - they pause to think
    // mid-sentence and expect the recorder to wait. Ending that turn on silence would cut them off.
    if (!opts.isInAudioInterfaceMode()) return;

    // Read at the START of each turn, so changing the setting takes effect on the very next turn
    // rather than needing a reload.
    const { voiceTurnMode, voiceSilenceAfterSpeechMs } = useAppStore.getState().settings;
    const mode = voiceTurnMode ?? 'silence';
    if (mode === 'tap') {
      logger.log('[VAD] voice turns are tap-to-talk; not listening for silence');
      return;
    }
    const handsFree = mode === 'handsfree';

    if (handsFree) {
      awaitingRef.current = true;
      setIsAwaitingSpeech(true);
    }

    const endpoint = new SpeechEndpointTimer(() => {
      logger.log('[VAD] silence detected - ending the turn');
      opts.onEndedBySilence?.();
      stop();
      // Deferred off the audio callback: stopping the recorder from inside its own buffer callback
      // tears down native state that the callback is still standing on.
      setTimeout(() => opts.stopTurn(), 0);
    }, line => logger.log(line));
    endpointRef.current = endpoint;
    listenAtRef.current = Date.now();
    endpoint.begin(listenAtRef.current, {
      handsFree,
      silenceAfterSpeechMs: voiceSilenceAfterSpeechMs ?? DEFAULT_SILENCE_AFTER_SPEECH_MS,
    });
    levelsOffRef.current = audioRecorderService.onAudioLevel(rms => {
      // Unless the session is LISTENING, these buffers are not a person. With no echo cancellation the
      // microphone hears our own speaker, and treating that as speech is what made a reply stop itself
      // 95ms after it started playing.
      if (!voiceSession.micShouldBeOpen()) return;
      const reading = endpoint.observeLevel(rms);
      // The moment speech is first heard, the turn has genuinely begun.
      if (handsFree && reading.speech) {
        if (awaitingRef.current) {
          awaitingRef.current = false;
          speechAtRef.current = Date.now();
          // BARGE-IN: the person talking wins. If the assistant is mid-sentence it stops here, which
          // is only safe because iOS voice-processing keeps its voice out of this mic in the first
          // place - otherwise the assistant would interrupt itself.
          logger.log('[VAD] speech detected - the person has the floor');
          callHook(HOOKS.audioStop);
        }
        setIsAwaitingSpeech(false);
          }
    });
  };

  const silenceBeforeSpeech = (): number => {
    if (!listenAtRef.current || !speechAtRef.current) return 0;
    const elapsed = speechAtRef.current - listenAtRef.current - SPEECH_ONSET_LOOKBACK_MS;
    return elapsed > 0 ? elapsed / 1000 : 0;
  };

  const silenceAfterSpeech = (): number => tailRef.current;

  return { listen, stop, isAwaitingSpeech, silenceBeforeSpeech, silenceAfterSpeech };
}
