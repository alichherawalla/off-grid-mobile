import { useSyncExternalStore } from 'react';
import type { ActiveModelSnapshot, ModelModality } from '@offgrid/models';
import { mobileLLMService } from './mobileLLMService';

/**
 * The one answer to "which model is selected for this modality" on the phone: the shared active
 * route. These are convenience reads for callers that only care about a LOCAL model's id; a remote
 * route reads as null here, exactly as the retired appStore mirrors did.
 */
export function activeLocalModelId(modality: ModelModality): string | null {
  const model = mobileLLMService.active(modality).model;
  return model && model.source === 'local' ? model.id : null;
}

export function activeRouteIsRemote(modality: ModelModality): boolean {
  return mobileLLMService.active(modality).model?.source === 'remote';
}

const snapshotCache = new Map<ModelModality, ActiveModelSnapshot>();

/** The same object while the route's facts are unchanged: React's external-store hook needs stable snapshots. */
function stableActiveRoute(modality: ModelModality): ActiveModelSnapshot {
  const next = mobileLLMService.active(modality);
  const previous = snapshotCache.get(modality);
  if (
    previous &&
    previous.selectedId === next.selectedId &&
    previous.selectedRouteId === next.selectedRouteId &&
    previous.ready === next.ready &&
    previous.model?.id === next.model?.id &&
    previous.model?.serverId === next.model?.serverId &&
    previous.model?.source === next.model?.source &&
    previous.model?.loaded === next.model?.loaded &&
    previous.model?.name === next.model?.name
  ) {
    return previous;
  }
  snapshotCache.set(modality, next);
  return next;
}

/** Reactive read of the shared active route for UI: re-renders when inventory or selection changes. */
export function useActiveMobileRoute(modality: ModelModality): ActiveModelSnapshot {
  return useSyncExternalStore(
    listener => mobileLLMService.subscribe(listener),
    () => stableActiveRoute(modality),
    () => stableActiveRoute(modality),
  );
}
