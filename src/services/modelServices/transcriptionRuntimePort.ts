import { whisperService } from '../whisperService';
import { WHISPER_MODELS } from '../whisperModels';
import { mobileResidencyIntents } from './residencyIntents';

export type MobileTranscriptionLoadResult = 'loaded' | 'blocked' | 'error';
type Observer = { onLoaded?(): void; onUnloaded?(): void };

/** Native transcription projection used by stores and presentation hooks. */
export const mobileTranscriptionRuntime = {
  models: WHISPER_MODELS,
  modelPath: (modelId: string) => whisperService.getModelPath(modelId),
  loadedModelPath: () => whisperService.getLoadedModelPath(),
  isModelLoaded: () => whisperService.isModelLoaded(),
  isSelectedModelLoaded(modelId: string | null): boolean {
    return !!modelId && whisperService.getLoadedModelPath() === whisperService.getModelPath(modelId);
  },
  isTranscribing: () => whisperService.isCurrentlyTranscribing(),
  stopTranscription: () => whisperService.stopTranscription(),
  forceReset: () => whisperService.forceReset(),
  ensureLoaded: (modelId: string, observer: Observer = {}) =>
    mobileResidencyIntents.ensureTranscription(modelId, observer),
  unload: (modelId?: string | null, observer: Observer = {}) =>
    mobileResidencyIntents.unloadTranscription(modelId, observer),
  download: (...args: Parameters<typeof whisperService.downloadModel>) =>
    whisperService.downloadModel(...args),
  delete: (...args: Parameters<typeof whisperService.deleteModel>) =>
    whisperService.deleteModel(...args),
  listDownloaded: (...args: Parameters<typeof whisperService.listDownloadedModels>) =>
    whisperService.listDownloadedModels(...args),
  isDownloaded: (...args: Parameters<typeof whisperService.isModelDownloaded>) =>
    whisperService.isModelDownloaded(...args),
};
