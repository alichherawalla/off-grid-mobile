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
import { applicationFacade } from '../applicationFacade';

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
    applicationFacade().models.setLoadPolicy(policy);
  },
  async canPreloadText(modelId: string): Promise<boolean> {
    return applicationFacade().models.canLoadWithoutEviction(
      await resolveTextResidentSpec(modelId),
    );
  },
  canPreloadTranscription(modelId: string): boolean {
    return applicationFacade().models.canLoadWithoutEviction(
      resolveTranscriptionResidentSpec(modelId),
    );
  },
};
