import type { ResidencyLoadPolicy } from '@offgrid/models';
import {
  ejectAllModels,
  loadImageModel,
  loadTextModel,
  loadTranscriptionModel,
  resolveTextResidentSpec,
  resolveTranscriptionResidentSpec,
  unloadAllModels,
  unloadImageModel,
  unloadTextModel,
  unloadTranscriptionModel,
} from './modelLifecycleBootstrap';
import { modelResidencyManager } from './residencyBootstrap';

/** Canonical application intents. Only this model-service boundary invokes native lifecycle APIs. */
export const mobileResidencyIntents = {
  ejectAll: ejectAllModels,
  unloadAll: unloadAllModels,
  unloadImage: unloadImageModel,
  unloadText: unloadTextModel,
  ensureText: loadTextModel,
  ensureImage: loadImageModel,
  ensureTranscription: loadTranscriptionModel,
  unloadTranscription: unloadTranscriptionModel,
  setLoadPolicy(policy: ResidencyLoadPolicy): void {
    modelResidencyManager.setLoadPolicy(policy);
  },
  async canPreloadText(modelId: string): Promise<boolean> {
    return modelResidencyManager.canLoadWithoutEviction(
      await resolveTextResidentSpec(modelId),
    );
  },
  canPreloadTranscription(modelId: string): boolean {
    return modelResidencyManager.canLoadWithoutEviction(
      resolveTranscriptionResidentSpec(modelId),
    );
  },
};
