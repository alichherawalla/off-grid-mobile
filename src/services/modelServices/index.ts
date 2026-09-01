import { LLMService, type ActiveModelSnapshot, type RuntimeModel } from '@offgrid/models';
import type { DownloadedModel, RemoteModel } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { useWhisperStore } from '../../stores/whisperStore';
import { activeModelService } from '../activeModelService';
import { mobileInventoryAdapters } from './inventoryAdapters';
import {
  mobileRouteFacts,
  mobileRouteId,
  type MobileRouteFacts,
} from './mobileRoute';
import { mobileModelSelectionStore } from './selectionStore';

export const mobileLLMService = new LLMService(mobileModelSelectionStore);
mobileInventoryAdapters.forEach(adapter => mobileLLMService.registerAdapter(adapter));

let started = false;
let refreshChain = Promise.resolve<RuntimeModel[]>([]);
const cleanups: Array<() => void> = [];

/** Serialize inventory rebuilds so an older store snapshot cannot win a race. */
export function refreshMobileModelServices(): Promise<RuntimeModel[]> {
  refreshChain = refreshChain
    .catch(() => [])
    .then(() => mobileLLMService.refresh());
  return refreshChain;
}

/** Connect persisted and native Mobile projections to the shared service once. */
export function startMobileModelServices(): () => void {
  if (!started) {
    started = true;
    const refresh = () => {
      refreshMobileModelServices().catch(() => undefined);
    };
    cleanups.push(useAppStore.subscribe(refresh));
    cleanups.push(useRemoteServerStore.subscribe(refresh));
    cleanups.push(useWhisperStore.subscribe(refresh));
    cleanups.push(activeModelService.subscribe(refresh));
    refreshMobileModelServices().catch(() => undefined);
  }
  return stopMobileModelServices;
}

export function stopMobileModelServices(): void {
  if (!started) return;
  started = false;
  for (const cleanup of cleanups.splice(0)) cleanup();
}

export function activeMobileModel(modality: ActiveModelSnapshot['modality']): ActiveModelSnapshot {
  return mobileLLMService.active(modality);
}

/** Refresh first so a newly downloaded or discovered route can be selected immediately. */
export async function selectMobileModel(facts: MobileRouteFacts): Promise<void> {
  await refreshMobileModelServices();
  await mobileLLMService.select(facts.modality, mobileRouteId(facts));
  await refreshMobileModelServices();
}

export async function clearMobileModel(
  modality: ActiveModelSnapshot['modality'],
): Promise<void> {
  await mobileLLMService.select(modality, null);
  await refreshMobileModelServices();
}

/** Presentation adapter: recover the rich Mobile record after shared routing selected it. */
export function mobileTextModelRecord(
  model: RuntimeModel | null,
): DownloadedModel | RemoteModel | null {
  if (!model) return null;
  const identity = mobileRouteFacts(model);
  if (!identity || identity.modality !== 'text') return null;
  if (identity.source === 'local') {
    return useAppStore.getState().downloadedModels.find(
      candidate => candidate.id === identity.modelId && candidate.engine === identity.hostId,
    ) ?? activeModelService.resolveSelectedTextModel();
  }
  return useRemoteServerStore.getState().discoveredModels[identity.hostId]?.find(
    candidate => candidate.id === identity.modelId,
  ) ?? null;
}

export { mobileRouteId, mobileRouteFacts } from './mobileRoute';
export type { MobileRouteFacts } from './mobileRoute';
