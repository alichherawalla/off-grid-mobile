import { decodeModelRouteId, type ModelSelectionStore } from '@offgrid/models';
import { remoteServerManager } from '../remoteServerManager';
import { mobileModelSelectionProjection } from './modelSelectionProjection';

/** Shared LLMService calls this single persisted-selection adapter. */
export const mobileModelSelectionStore: ModelSelectionStore = {
  read: mobileModelSelectionProjection.read,
  async write(modality, canonicalId) {
    const route = canonicalId ? decodeModelRouteId(canonicalId) : null;
    if (canonicalId && !route) throw new Error('The selected model route is invalid');
    if (route?.serverId) {
      if (modality === 'text') {
        await remoteServerManager.prepareRemoteTextModel(route.serverId, route.modelId);
      } else if (
        modality === 'image' || modality === 'transcription' ||
        modality === 'voice' || modality === 'embedding'
      ) {
        await remoteServerManager.prepareRemoteMediaModel(route.serverId, modality, route.modelId);
      } else {
        throw new Error(`Remote ${modality} selection is not supported`);
      }
    }
    await mobileModelSelectionProjection.write(modality, canonicalId);
  },
};
