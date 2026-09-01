import { ModelEjectionService } from '@offgrid/models';
import { imageGenerationService } from '../imageGenerationService';
import { stopActiveMobileChatSession } from './chatSessionControl';
import { ejectAllModels } from './modelLifecycleBootstrap';

const service = new ModelEjectionService({
  cancelActiveGeneration: async () => { stopActiveMobileChatSession(); },
  cancelActiveImageGeneration: () => imageGenerationService.cancelGeneration(),
  ejectAll: ejectAllModels,
});

/** Mobile supplies cancellation and native teardown ports; Shared owns their order. */
export const ejectAllModelsForUser = (): Promise<{ count: number }> =>
  service.ejectAllForUser();
