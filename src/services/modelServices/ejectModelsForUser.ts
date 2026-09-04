import type { ModelEjectionService } from '@offgrid/models';
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
