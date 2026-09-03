import type { ModelEjectionService } from '@offgrid/models';
import { modelEjection } from '../composition/model-commands';
import { imageGenerationService } from '../imageGenerationService';
import { stopActiveMobileChatSession } from './chatSessionControl';
import { ejectAllModels } from './modelLifecycleBootstrap';

/** Cancellation and native teardown ports. Shared owns their order. */
export function mobileModelEjectionPorts(): ConstructorParameters<typeof ModelEjectionService>[0] {
  return {
    cancelActiveGeneration: async () => { stopActiveMobileChatSession(); },
    cancelActiveImageGeneration: () => imageGenerationService.cancelGeneration(),
    ejectAll: ejectAllModels,
  };
}

/** Mobile supplies cancellation and native teardown ports; Shared owns their order. */
export const ejectAllModelsForUser = (): Promise<{ count: number }> =>
  modelEjection().ejectAllForUser();
