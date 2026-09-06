import { whisperService } from '../whisperService';

/** Native realtime-session controls. Model lifecycle is owned by the Models facade. */
export const mobileTranscriptionRuntime = {
  isModelLoaded: () => whisperService.isModelLoaded(),
  isTranscribing: () => whisperService.isCurrentlyTranscribing(),
  stopTranscription: () => whisperService.stopTranscription(),
  forceReset: () => whisperService.forceReset(),
};
