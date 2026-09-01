import {
  LLMService,
  type ActiveModelSnapshot,
  type ModelModality,
} from '@offgrid/models';
import { mobileModelSelectionStore } from './selectionStore';

/** The single Mobile owner of model inventory, selection, and canonical route identity. */
export const mobileLLMService = new LLMService(mobileModelSelectionStore);
let refreshChain = Promise.resolve<ReturnType<LLMService['list']>>([]);

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
  await mobileLLMService.select(modality, canonicalId);
  await refreshMobileLLMServiceInventory();
}

export function activeMobileRoute(modality: ModelModality): ActiveModelSnapshot {
  return mobileLLMService.active(modality);
}
