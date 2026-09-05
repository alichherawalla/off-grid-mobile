import { useEffect, type MutableRefObject } from 'react';
import { recordingController } from '../../services/recordingController';
import { audioRecorderService } from '../../services/audioRecorderService';
import { applicationFacade } from '../../services/applicationFacade';
import { useAppStore } from '../../stores';

interface VoiceControllerEffectInput {
  conversationId?: string | null;
  recordingConversationIdRef: MutableRefObject<string | null>;
  startRef: MutableRefObject<() => Promise<void>>;
  stopRef: MutableRefObject<() => Promise<void>>;
  cancelRef: MutableRefObject<() => void>;
  finalResult: string;
  clearResult: () => void;
  deliverTranscript: (text: string) => void;
}

/** Register recorder intents and project completed Whisper results. */
export function useVoiceControllerEffects(input: VoiceControllerEffectInput): void {
  const {
    conversationId,
    recordingConversationIdRef,
    startRef,
    stopRef,
    cancelRef,
    finalResult,
    clearResult,
    deliverTranscript,
  } = input;
  useEffect(() => recordingController.registerHandlers({
    start: () => startRef.current(),
    stop: () => {
      if (
        (useAppStore.getState().settings.voiceTurnMode ?? 'silence') ===
        'handsfree'
      ) {
        applicationFacade().speech.session.dispatch('userStop');
      }
      stopRef.current();
    },
    cancel: () => cancelRef.current(),
  }), [startRef, stopRef, cancelRef]);

  useEffect(() => {
    if (
      recordingConversationIdRef.current &&
      recordingConversationIdRef.current !== conversationId
    ) {
      cancelRef.current();
    }
  }, [conversationId, cancelRef, recordingConversationIdRef]);

  useEffect(() => {
    if (!finalResult) return;
    if (
      !recordingConversationIdRef.current ||
      recordingConversationIdRef.current === conversationId
    ) {
      deliverTranscript(finalResult);
    }
    clearResult();
    recordingConversationIdRef.current = null;
  }, [
    finalResult,
    conversationId,
    deliverTranscript,
    clearResult,
    recordingConversationIdRef,
  ]);
}

export async function stopVoiceRecording(input: {
  isChatDictation: boolean;
  isDirectRecording: boolean;
  isAudioModeRecording: boolean;
  stopListeningForSilence: () => void;
  stopDirectRecording: () => Promise<void>;
  stopAudioModeRecording: () => Promise<void>;
  stopWhisperRecording: () => Promise<void>;
}): Promise<void> {
  applicationFacade().speech.session.dispatch('turnCaptured');
  input.stopListeningForSilence();
  try {
    if (input.isDirectRecording) return await input.stopDirectRecording();
    if (input.isAudioModeRecording) return await input.stopAudioModeRecording();
    await input.stopWhisperRecording();
  } finally {
    if (input.isChatDictation)
      applicationFacade().speech.session.dispatch('dictationFinished');
  }
}

export function cancelVoiceRecording(input: {
  isDirectRecording: boolean;
  isAudioModeRecording: boolean;
  setIsDirectRecording: (value: boolean) => void;
  setIsAudioModeRecording: (value: boolean) => void;
  stopWhisperRecording: () => void;
  clearWhisperResult: () => void;
  clearConversation: () => void;
  stopListeningForSilence: () => void;
}): void {
  const isReplayCancellation =
    !!applicationFacade().speech.snapshot().voice.replayReturnsTo;
  input.stopListeningForSilence();
  try {
    if (input.isDirectRecording || input.isAudioModeRecording) {
      audioRecorderService.cancelRecording();
      if (input.isDirectRecording) input.setIsDirectRecording(false);
      else input.setIsAudioModeRecording(false);
    } else {
      input.stopWhisperRecording();
      input.clearWhisperResult();
    }
    input.clearConversation();
  } finally {
    if (!isReplayCancellation)
      applicationFacade().speech.session.dispatch('dictationFinished');
  }
}
