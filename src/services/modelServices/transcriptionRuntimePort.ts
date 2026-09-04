import { whisperService } from '../whisperService';
import { WHISPER_MODELS, type TranscriptionModelWorkflowState } from '@offgrid/models';
import { mobileResidencyIntents } from './residencyIntents';
import { lifecycleProjectionPort } from './lifecycleProjectionPort';
import { selectLocalTranscriptionModelOnDemand } from './modelCommandApplication';
import { requireTranscriptionModelProjection } from './transcriptionProjectionPort';
export type { MobileTranscriptionLoadResult } from './transcriptionProjectionPort';
type Observer = { onLoaded?(): void; onUnloaded?(): void };

/** Native transcription projection used by stores and presentation hooks. */
export const mobileTranscriptionRuntime = {
  models: WHISPER_MODELS,
  modelPath: (modelId: string) => whisperService.getModelPath(modelId),
  loadedModelPath: () => whisperService.getLoadedModelPath(),
  isModelLoaded: () => whisperService.isModelLoaded(),
  isSelectedModelLoaded(modelId: string | null): boolean {
    return (
      !!modelId &&
      whisperService.getLoadedModelPath() ===
        whisperService.getModelPath(modelId)
    );
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
  listDownloaded: (
    ...args: Parameters<typeof whisperService.listDownloadedModels>
  ) => whisperService.listDownloadedModels(...args),
  isDownloaded: (
    ...args: Parameters<typeof whisperService.isModelDownloaded>
  ) => whisperService.isModelDownloaded(...args),
};

/** Projection, route, and inventory ports the shared workflow needs beyond the runtime. */
export const mobileTranscriptionWorkflowPorts = {
  state: () => requireTranscriptionModelProjection().state(),
  project: (patch: Partial<TranscriptionModelWorkflowState>) =>
    requireTranscriptionModelProjection().project(patch),
  selectRoute: selectLocalTranscriptionModelOnDemand,
  refreshInventory: async () => {
    await lifecycleProjectionPort.refreshInventory();
  },
};
