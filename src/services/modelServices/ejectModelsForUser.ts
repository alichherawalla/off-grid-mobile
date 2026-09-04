import type { ModelEjectionService } from '@offgrid/models';
import { imageGenerationService } from '../imageGenerationService';
import { stopActiveMobileChatSession } from './chatSessionControl';
import { ejectAllModels } from './modelLifecycleBootstrap';

/**
 * Cancellation and native teardown ports. Shared owns their order.
 *
 * Genuine platform operations only. Per-resident eviction is NOT here: it is residency's own
 * capability, supplied to the ejection service by the composer. An earlier version of this file
 * implemented it by calling `models.evictWhenReleased`, which closed a control loop - facade, out to
 * this adapter, back into the facade - and made an app adapter a hop inside shared's coordination.
 * The port no longer carries the member, so that cannot be written here again.
 */
export function mobileModelEjectionPorts(): ConstructorParameters<typeof ModelEjectionService>[0] {
  return {
    cancelActiveGeneration: async () => { stopActiveMobileChatSession(); },
    cancelActiveImageGeneration: () => imageGenerationService.cancelGeneration(),
    ejectAll: ejectAllModels,
  };
}
