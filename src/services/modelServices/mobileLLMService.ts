import {
  decodeModelRouteId,
  LLMService,
  type ActiveModelSnapshot,
  type ModelModality,
} from '@offgrid/models';
import type { LLMProvider } from '../adapters/providers/types';
import { providerRegistry } from '../adapters/providers';
import { mobileModelSelectionStore } from './selectionStore';

/** The single Mobile owner of model inventory, selection, and canonical route identity. */
export const mobileLLMService = new LLMService(mobileModelSelectionStore);
let refreshChain = Promise.resolve<ReturnType<LLMService['list']>>([]);

/** Serialize canonical inventory rebuilds so an older platform snapshot cannot win a race. */
export function refreshMobileLLMServiceInventory() {
  refreshChain = refreshChain.catch(() => []).then(() => mobileLLMService.refresh());
  return refreshChain;
}

export function activeMobileRoute(modality: ModelModality): ActiveModelSnapshot {
  return mobileLLMService.active(modality);
}

/** Resolve the exact provider named by the selected canonical text route. Never substitute local. */
export function activeMobileTextProvider(): LLMProvider | null {
  const selectedId = activeMobileRoute('text').selectedId;
  const route = selectedId ? decodeModelRouteId(selectedId) : null;
  if (!route) return null;
  return providerRegistry.getProvider(route.serverId ?? 'local') ?? null;
}
