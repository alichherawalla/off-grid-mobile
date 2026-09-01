import { ModelEjectionService } from '@offgrid/models';
import { generationService } from '../generationService';
import { imageGenerationService } from '../imageGenerationService';
import { ejectAllModels } from './modelLifecycleBootstrap';

const service = new ModelEjectionService({
  cancelActiveGeneration: async () => { await generationService.stopGeneration(); },
  cancelActiveImageGeneration: () => imageGenerationService.cancelGeneration(),
  ejectAll: ejectAllModels,
});

/** Mobile supplies cancellation and native teardown ports; Shared owns their order. */
export const ejectAllModelsForUser = (): Promise<{ count: number }> =>
  service.ejectAllForUser();
