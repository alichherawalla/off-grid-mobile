import type { ActiveModelSnapshot, RuntimeModel } from '@offgrid/models';
import { mobileVoiceGenerationService as voiceGeneration } from '../composition/generation';
import type { DownloadedModel, RemoteModel } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { serverDiscoveredModels } from '../../stores/remoteServerProjection';
import { useWhisperStore } from '../../stores/whisperStore';
import { useModelSelectionStore } from '../../stores/modelSelectionStore';
import { useModelResidencyStore } from '../../stores/modelResidencyStore';
import {
  resolveSelectedTextModel,
  subscribeToModelState,
} from './modelState';
import { mobileInventoryAdapters } from './inventoryAdapters';
import {
  mobileRouteFacts,
  mobileRouteId,
  type MobileRouteFacts,
} from './mobileRoute';
import {
  activeMobileRoute,
  mobileLLMService,
  refreshMobileLLMServiceInventory,
  selectMobileRoute,
} from './mobileLLMService';
import { reconcileMobileGenerationAdapters } from './generationAdapters';
import { mobileWorkspace } from './workspace';
import { reconcileMobileTranscriptionAdapters } from './transcriptionGenerationAdapter';
import { reconcileMobileVoiceAdapters } from './voiceGenerationAdapter';
import { reconcileMobileSidecarAdapters } from './sidecarGenerationAdapter';
import { mobileModelDownloadCoordinator } from './modelDownloadCoordinator';
import { registerLifecycleProjectionPort } from './lifecycleProjectionPort';
import { composeMobileSidecarExecution } from './sidecarExecutionComposition';
import { registerModelSelectionCommandPort } from './modelSelectionCommandPort';
import { mobileModelSelectionService } from './modelSelectionApplication';
import { reportModelFailure } from '../modelFailureHandler';
import { remoteServerManager } from '../remoteServerManager';
import logger from '../../utils/logger';

mobileInventoryAdapters.forEach(adapter => mobileLLMService.registerAdapter(adapter));
registerLifecycleProjectionPort({
  refreshInventory: refreshMobileLLMServiceInventory,
  selectRoute: selectMobileRoute,
});
registerModelSelectionCommandPort({
  select: selectMobileRoute,
  async removeServer(serverId) {
    await Promise.all(
      (['text', 'image', 'transcription', 'voice', 'embedding'] as const).map(
        modality => mobileModelSelectionService.remove({ modality, serverId }),
      ),
    );
  },
});
export const mobileGenerationService = mobileWorkspace.generation;
/** Voice has its own queue so sentence playback can run while text is still streaming. */
export const mobileVoiceGenerationService = voiceGeneration();
const generationAdapterRegistrations = new Map<string, () => void>();
const transcriptionAdapterRegistrations = new Map<string, () => void>();
const voiceAdapterRegistrations = new Map<string, () => void>();
const sidecarAdapterRegistrations = new Map<string, () => void>();

let started = false;
let refreshChain = Promise.resolve<RuntimeModel[]>([]);
const cleanups: Array<() => void> = [];

type ModelServiceInitializationStage = 'inventory' | 'downloads';

export function projectMobileModelServiceInitializationFailure(
  stage: ModelServiceInitializationStage,
  error: unknown,
): void {
  logger.error(`[ModelServices] ${stage} initialization failed`, error);
  reportModelFailure('text', error, {
    id: `mobile-model-services-${stage}`,
    title: stage === 'downloads'
      ? 'Model downloads are unavailable'
      : 'Model services are unavailable',
    message: error instanceof Error
      ? error.message
      : 'Off Grid could not initialize the model service.',
  });
}

function consumeAlreadyProjectedFailure(): void {
  // The owner has logged and projected this error. Startup observers consume the
  // rejection only to prevent an unhandled promise rejection.
}

/** Serialize inventory rebuilds so an older store snapshot cannot win a race. */
export function refreshMobileModelServices(): Promise<RuntimeModel[]> {
  refreshChain = refreshChain
    .catch(() => [])
    .then(() => refreshMobileLLMServiceInventory())
    .then(models => {
      reconcileMobileGenerationAdapters(
        mobileGenerationService,
        mobileLLMService,
        generationAdapterRegistrations,
      );
      reconcileMobileTranscriptionAdapters(
        mobileGenerationService,
        mobileLLMService,
        transcriptionAdapterRegistrations,
      );
      reconcileMobileVoiceAdapters(
        mobileVoiceGenerationService,
        mobileLLMService,
        voiceAdapterRegistrations,
      );
      reconcileMobileSidecarAdapters(
        mobileGenerationService,
        mobileLLMService,
        sidecarAdapterRegistrations,
      );
      return models;
    })
    .catch(error => {
      projectMobileModelServiceInitializationFailure('inventory', error);
      throw error;
    });
  return refreshChain;
}

composeMobileSidecarExecution(mobileGenerationService, refreshMobileModelServices);

/** Connect persisted and native Mobile projections to the shared service once. */
export function startMobileModelServices(): () => void {
  if (!started) {
    started = true;
    const refresh = () => {
      refreshMobileModelServices().catch(consumeAlreadyProjectedFailure);
    };
    cleanups.push(useAppStore.subscribe(refresh));
    cleanups.push(useRemoteServerStore.subscribe(refresh));
    cleanups.push(useWhisperStore.subscribe(refresh));
    cleanups.push(useModelSelectionStore.subscribe(refresh));
    cleanups.push(useModelResidencyStore.subscribe(refresh));
    cleanups.push(subscribeToModelState(refresh));
    mobileModelDownloadCoordinator.hydrate().catch(error =>
      projectMobileModelServiceInitializationFailure('downloads', error),
    );
    refreshMobileModelServices().catch(consumeAlreadyProjectedFailure);
  }
  return stopMobileModelServices;
}

export function stopMobileModelServices(): void {
  if (!started) return;
  started = false;
  for (const cleanup of cleanups.splice(0)) cleanup();
  mobileModelDownloadCoordinator.shutdown().catch(() => undefined);
}

export function activeMobileModel(modality: ActiveModelSnapshot['modality']): ActiveModelSnapshot {
  return activeMobileRoute(modality);
}

/** The user picked a model. For a remote route, ask that server to activate it FIRST (the one
 * place the phone may change a paired Mac's selection), then record the phone's own selection. */
export async function selectMobileModel(facts: MobileRouteFacts): Promise<void> {
  if (facts.source === 'remote') {
    if (facts.modality === 'text') {
      await remoteServerManager.prepareRemoteTextModel(facts.hostId, facts.modelId);
    } else if (
      facts.modality === 'image' || facts.modality === 'transcription' ||
      facts.modality === 'voice' || facts.modality === 'embedding'
    ) {
      await remoteServerManager.prepareRemoteMediaModel(facts.hostId, facts.modality, facts.modelId);
    } else {
      throw new Error(`Remote ${facts.modality} selection is not supported`);
    }
  }
  await selectMobileRoute(facts.modality, mobileRouteId(facts));
  await refreshMobileModelServices();
}

/** Convenience intent for UI surfaces that select a discovered remote route. */
export function selectRemoteMobileModel(
  serverId: string,
  modality: MobileRouteFacts['modality'],
  modelId: string,
): Promise<void> {
  return selectMobileModel({ source: 'remote', hostId: serverId, modality, modelId });
}

export async function clearMobileModel(
  modality: ActiveModelSnapshot['modality'],
): Promise<void> {
  await selectMobileRoute(modality, null);
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
    ) ?? resolveSelectedTextModel();
  }
  const server = useRemoteServerStore.getState().servers.find(item => item.id === identity.hostId);
  return server
    ? serverDiscoveredModels(server).find(candidate => candidate.id === identity.modelId) ?? null
    : null;
}

export { mobileRouteId } from './mobileRoute';
export { mobileLLMService, mobileModelsFacade } from './mobileLLMService';
export type { MobileRouteFacts } from './mobileRoute';
