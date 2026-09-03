import type { ModelCommandApplicationService } from '@offgrid/models';
import { modelCommands } from '../composition/model-commands';
import { mobileResidencyIntents } from './residencyIntents';
import { lifecycleProjectionPort } from './lifecycleProjectionPort';
import { mobileRouteId } from './mobileRoute';

/** Platform ports. Shared owns command ordering. */
export function mobileModelCommandPorts(): ConstructorParameters<typeof ModelCommandApplicationService>[0] {
  return {
  async select(route) {
    await lifecycleProjectionPort.selectRoute(
      route.modality,
      mobileRouteId(route),
    );
    await lifecycleProjectionPort.refreshInventory();
  },
  async clear(modality) {
    await lifecycleProjectionPort.selectRoute(modality, null);
    await lifecycleProjectionPort.refreshInventory();
  },
  async loadLocal(modality, modelId, override) {
    if (modality === 'text')
      await mobileResidencyIntents.ensureText(
        modelId,
        undefined,
        override ? { override: true } : undefined,
      );
    else if (modality === 'image')
      await mobileResidencyIntents.ensureImage(
        modelId,
        undefined,
        override ? { override: true } : undefined,
      );
  },
  async unloadLocal(modality, keepSelection) {
    if (modality === 'text')
      await mobileResidencyIntents.unloadText(keepSelection);
    else if (modality === 'image')
      await mobileResidencyIntents.unloadImage(keepSelection);
  },
  };
}

export const mobileModelCommands = modelCommands();

/** Record a local text route without acquiring native residency. Chat generation owns first load. */
export function selectLocalTextModelOnDemand(model: {
  id: string;
  engine: string;
}): Promise<void> {
  return mobileModelCommands.select(
    {
      source: 'local',
      hostId: model.engine,
      modality: 'text',
      modelId: model.id,
    },
    { load: false },
  );
}

/** Record the Whisper route through the canonical selection application without eager loading. */
export function selectLocalTranscriptionModelOnDemand(
  modelId: string | null,
): Promise<void> {
  if (!modelId) return mobileModelCommands.unload('transcription');
  return mobileModelCommands.select(
    {
      source: 'local',
      hostId: 'whisper.rn',
      modality: 'transcription',
      modelId,
    },
    { load: false },
  );
}
