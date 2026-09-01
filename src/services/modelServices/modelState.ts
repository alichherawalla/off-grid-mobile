import { createSelectedModelResolver, selectedModelId } from '@offgrid/models';
import type { DownloadedModel } from '../../types';
import { useAppStore } from '../../stores/appStore';
import logger from '../../utils/logger';
import { llmService } from '../llm';
import { nativeModelLifecycle } from '../adapters/native/modelLifecycle';
import { modelResidencyManager } from './residencyBootstrap';
import { activeModelSnapshot } from './modelStateSnapshot';
import type {
  ActiveModelInfo,
  MemoryCheckResult,
  ModelType,
  ResourceUsage,
} from './modelStateTypes';
import { selectCanonicalModel } from './modelSelectionCommandPort';
import { mobileRouteId } from './mobileRoute';
import {
  checkMemoryForDualModel as checkDualMemory,
  checkMemoryForModel as checkMemory,
} from './modelMemoryAdvisory';
import { getResourceUsage as readResourceUsage } from './modelStateNativeProjection';

const selectedTextModel = createSelectedModelResolver<DownloadedModel>({
  read: () => {
    const state = useAppStore.getState();
    return { models: state.downloadedModels, selectedId: state.activeModelId };
  },
  warn: message => logger.warn(message),
});

export function resolveSelectedTextModel(): DownloadedModel | null {
  return selectedTextModel();
}

export function selectedTextModelId(): string | null {
  const state = useAppStore.getState();
  return selectedModelId({
    activeModelId: state.activeModelId,
    lastModelId: state.lastTextModelId,
  });
}

export function selectTextModel(modelId: string): Promise<void> {
  const model = useAppStore.getState().downloadedModels.find(candidate => candidate.id === modelId);
  if (!model) return Promise.reject(new Error('Model not found'));
  return selectCanonicalModel('text', mobileRouteId({
    source: 'local', hostId: model.engine, modality: 'text', modelId,
  }));
}

export function getActiveModels(): ActiveModelInfo {
  const store = useAppStore.getState();
  const native = nativeModelLifecycle.getState();
  return activeModelSnapshot({
    textModel: resolveSelectedTextModel(),
    imageModel: store.downloadedImageModels.find(
      model => model.id === store.activeImageModelId,
    ) ?? null,
    textIsLoaded: native.textIsLoaded,
    imageIsLoaded: native.imageIsLoaded,
    loading: native.loading,
  });
}

export function hasAnyModelLoaded(): boolean {
  const models = getActiveModels();
  return models.text.isLoaded || models.image.isLoaded;
}

export function supportsAudioInput(): boolean {
  return nativeModelLifecycle.supportsAudioInput();
}

export function getLoadedModelIds(): {
  textModelId: string | null;
  imageModelId: string | null;
} {
  const state = nativeModelLifecycle.getState();
  return {
    textModelId: state.loadedTextModelId,
    imageModelId: state.loadedImageModelId,
  };
}

export function getPerformanceStats() {
  return llmService.getPerformanceStats();
}

export async function getResourceUsage(): Promise<ResourceUsage> {
  return readResourceUsage();
}

export async function checkMemoryForModel(
  modelId: string,
  modelType: ModelType,
): Promise<MemoryCheckResult> {
  const state = useAppStore.getState();
  const loaded = getLoadedModelIds();
  return checkMemory({
    modelId,
    modelType,
    ids: {
      loadedTextModelId: loaded.textModelId,
      loadedImageModelId: loaded.imageModelId,
    },
    lists: {
      downloadedModels: state.downloadedModels,
      downloadedImageModels: state.downloadedImageModels,
    },
    policy: modelResidencyManager.getLoadPolicy(),
    sessionOverride: modelResidencyManager.hasSessionOverride(modelId),
  });
}

export async function checkMemoryForDualModel(
  textModelId: string | null,
  imageModelId: string | null,
): Promise<MemoryCheckResult> {
  const state = useAppStore.getState();
  return checkDualMemory({
    textModelId,
    imageModelId,
    lists: {
      downloadedModels: state.downloadedModels,
      downloadedImageModels: state.downloadedImageModels,
    },
  });
}

export async function clearTextModelCache(): Promise<void> {
  if (llmService.isModelLoaded()) await llmService.clearKVCache(false);
}

export function syncWithNativeState(): Promise<void> {
  return nativeModelLifecycle.syncWithNativeState();
}

export function subscribeToModelState(listener: (state: ActiveModelInfo) => void): () => void {
  return nativeModelLifecycle.subscribe(() => listener(getActiveModels()));
}

export type { ActiveModelInfo, ResourceUsage } from './modelStateTypes';
