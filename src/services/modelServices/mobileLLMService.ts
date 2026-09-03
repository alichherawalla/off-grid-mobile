import type { ActiveModelSnapshot, ModelModality, WorkspaceRoutingPort } from '@offgrid/models';
import { lazyInstance } from '../composition/lazy';

/** The single Mobile owner of model inventory, selection, and canonical route identity. */
// Resolved on first use: the workspace module may still be initializing when this module loads.
export const mobileLLMService: WorkspaceRoutingPort = lazyInstance(
  () => (require('./workspace') as typeof import('./workspace')).mobileWorkspace.llm,
);
let refreshChain = Promise.resolve<ReturnType<WorkspaceRoutingPort['list']>>([]);

/** Serialize canonical inventory rebuilds so an older platform snapshot cannot win a race. */
export function refreshMobileLLMServiceInventory() {
  refreshChain = refreshChain.catch(() => []).then(() => mobileLLMService.refresh());
  return refreshChain;
}

/** Canonical Mobile selection transaction for callers below the app-service facade. */
export async function selectMobileRoute(
  modality: ModelModality,
  canonicalId: string | null,
): Promise<void> {
  await refreshMobileLLMServiceInventory();
  // The facade owns selection: it resolves the route and adopts a discovered remote model on its
  // server before committing, so callers never reach the inventory service directly.
  const { mobileWorkspace } = require('./workspace') as typeof import('./workspace');
  await mobileWorkspace.select(modality, canonicalId);
  await refreshMobileLLMServiceInventory();
}

export function activeMobileRoute(modality: ModelModality): ActiveModelSnapshot {
  return mobileLLMService.active(modality);
}
