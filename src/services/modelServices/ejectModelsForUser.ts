import { generationService } from '../generationService';
import { imageGenerationService } from '../imageGenerationService';
import { ejectAllModels } from './modelLifecycleBootstrap';

/** Stop active work before shared residency releases every native model slot. */
export async function ejectAllModelsForUser(): Promise<{ count: number }> {
  await Promise.all([
    generationService.stopGeneration(),
    imageGenerationService.cancelGeneration(),
  ]);
  return ejectAllModels();
}
