import type { ModelEjectionService, ModelModality } from '@offgrid/models';
import { stopActiveMobileChatSession } from './chatSessionControl';
import { activeRouteIsRemote } from './activeRoute';
import { lifecycleProjectionPort } from './lifecycleProjectionPort';
import { unloadImageModel, unloadTextModel } from './modelLifecycleBootstrap';

const EJECTABLE_MODALITIES = ['text', 'image', 'transcription', 'voice'] as const;

/**
 * The platform half of full ejection. PRIMITIVES ONLY - shared owns the order.
 *
 * Two earlier versions of this file were the wrong level. One implemented `evict(key)` by calling
 * `models.evictWhenReleased`; the other supplied `ejectAll`, which assembled
 * `ejectModelResidency` and reached back through `applicationFacade().models.residency` to run it.
 * Both made the call graph run facade -> shared service -> this adapter -> facade, so the workflow
 * was owned here while appearing to be shared's. Neither member exists on the port now.
 *
 * The rule: no implementation of a `ModelsFacade` outbound port may call back into the facade. This
 * file imports no facade at all, which is the enforceable form of that.
 */
export function mobileModelEjectionPorts(): ConstructorParameters<typeof ModelEjectionService>[0] {
  return {
    cancelActiveGeneration: async () => { stopActiveMobileChatSession(); },
    // The two local runtimes this device can unload. Shared counts the answers; it does not need to
    // know the names.
    localUnloads: {
      textUnloaded: () => unloadTextModel(true),
      imageUnloaded: () => unloadImageModel(true),
    },
    // Which modalities a remote server answers is the active route's fact, per modality.
    remoteModalities: (): readonly ModelModality[] =>
      EJECTABLE_MODALITIES.filter(modality => activeRouteIsRemote(modality)),
    clearRemoteRoute: modality => lifecycleProjectionPort.selectRoute(modality, null),
    refreshInventory: async () => {
      await lifecycleProjectionPort.refreshInventory();
    },
  };
}
