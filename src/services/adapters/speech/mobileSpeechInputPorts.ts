/** React Native microphone and transcription I/O for Shared's Speech application. */
import RNFS from 'react-native-fs';
import type { SpeechPlatformPorts } from '@offgrid/application';
import { cleanTranscription } from '@offgrid/models';
import { audioRecorderService } from '../../audioRecorderService';
import { whisperService } from '../../whisperService';

export type MobileSpeechInputPorts = Pick<
  SpeechPlatformPorts,
  'microphone' | 'transcriber' | 'files' | 'clock' | 'cleanTranscript'
>;

/** Native input adapters only. Shared owns recording and transcription policy. */
export const mobileSpeechInputPorts: MobileSpeechInputPorts = {
  microphone: {
    start: () => audioRecorderService.startRecording(),
    async stop() {
      const recording = await audioRecorderService.stopRecording();
      return {
        path: recording.path,
        mime: 'audio/wav',
        durationSeconds: recording.durationSeconds,
        // Message audio is durable so a failed or cancelled decode can be retried.
        transient: false,
      };
    },
    cancel: () => audioRecorderService.cancelRecording(),
    onLevel: listener => audioRecorderService.onAudioLevel(listener),
    echoCancelled: () => audioRecorderService.isEchoCancelled(),
  },
  transcriber: {
    ready: () =>
      whisperService.isModelLoaded() &&
      whisperService.getLoadedModelPath() !== null,
    async transcribe(source, options) {
      if (source.kind !== 'file') {
        throw new TypeError(
          'Mobile Speech transcription requires a file source.',
        );
      }
      return {
        text: await whisperService.transcribeFileRaw(source.path, {
          language: options.language,
          signal: options.signal,
        }),
      };
    },
  },
  files: {
    remove: path => RNFS.unlink(path),
  },
  clock: {
    now: () => Date.now(),
    after(ms, callback) {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
  },
  cleanTranscript: cleanTranscription,
};
