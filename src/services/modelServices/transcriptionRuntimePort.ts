import { whisperService } from '../whisperService';
import {
  TranscriptionModelWorkflow,
  WHISPER_MODELS,
  type TranscriptionModelWorkflowState,
} from '@offgrid/models';
import { mobileResidencyIntents } from './residencyIntents';
import { lifecycleProjectionPort } from './lifecycleProjectionPort';
import { selectLocalTranscriptionModelOnDemand } from './modelCommandApplication';

export type MobileTranscriptionLoadResult = 'loaded' | 'blocked' | 'error';
type Observer = { onLoaded?(): void; onUnloaded?(): void };

interface MobileTranscriptionProjection {
  state(): TranscriptionModelWorkflowState;
  project(patch: Partial<TranscriptionModelWorkflowState>): void;
}

let projection: MobileTranscriptionProjection | null = null;

export function registerTranscriptionModelProjection(
  port: MobileTranscriptionProjection,
): void {
  projection = port;
}

function requireProjection(): MobileTranscriptionProjection {
  if (!projection)
    throw new Error('Transcription model projection is not registered');
  return projection;
}

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

/** Shared workflow with Mobile native, filesystem, route, and UI projection ports. */
export const transcriptionModelIntents = new TranscriptionModelWorkflow({
  state: () => requireProjection().state(),
  project: patch => requireProjection().project(patch),
  modelPath: modelId => mobileTranscriptionRuntime.modelPath(modelId),
  loadedModelPath: () => mobileTranscriptionRuntime.loadedModelPath(),
  download: (modelId, onProgress) =>
    mobileTranscriptionRuntime.download(modelId, onProgress),
  ensureLoaded: modelId => mobileTranscriptionRuntime.ensureLoaded(modelId),
  unload: modelId => mobileTranscriptionRuntime.unload(modelId),
  delete: modelId => mobileTranscriptionRuntime.delete(modelId),
  listDownloaded: () => mobileTranscriptionRuntime.listDownloaded(),
  isDownloaded: modelId => mobileTranscriptionRuntime.isDownloaded(modelId),
  selectRoute: selectLocalTranscriptionModelOnDemand,
  refreshInventory: async () => {
    await lifecycleProjectionPort.refreshInventory();
  },
});
