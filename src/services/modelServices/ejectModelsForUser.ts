import type { ModelEjectionService } from '@offgrid/models';
import { modelEjection } from '../composition/model-commands';
import { imageGenerationService } from '../imageGenerationService';
import { stopActiveMobileChatSession } from './chatSessionControl';
import { ejectAllModels } from './modelLifecycleBootstrap';
import { modelResidencyManager } from './residencyBootstrap';

/** Cancellation and native teardown ports. Shared owns their order. */
export function mobileModelEjectionPorts(): ConstructorParameters<typeof ModelEjectionService>[0] {
  return {
    cancelActiveGeneration: async () => { stopActiveMobileChatSession(); },
    cancelActiveImageGeneration: () => imageGenerationService.cancelGeneration(),
    ejectAll: ejectAllModels,
    evict: key => modelResidencyManager.evictWhenReleased(key),
  };
}

/** Mobile supplies cancellation and native teardown ports; Shared owns their order. */
export const ejectAllModelsForUser = (): Promise<{ count: number }> =>
  modelEjection().ejectAllForUser();

/** Eject one resident on a person's request; running work stops first (shared owns the order). */
export const ejectResidentForUser = (key: string): Promise<boolean> =>
  modelEjection().ejectResident(key);
