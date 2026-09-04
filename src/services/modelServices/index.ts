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
import logger from '../../utils/logger';
import { applicationFacade } from '../applicationFacade';

/** The one Mobile owner of model inventory, selection and canonical route identity. */
export const mobileLLMService = mobileWorkspace.llm;

mobileInventoryAdapters.forEach(adapter => mobileLLMService.registerAdapter(adapter));
registerLifecycleProjectionPort({
  // The full refresh: an inventory rebuild is only complete once the generation,
  // transcription, voice and sidecar adapters have been reconciled against it.
  refreshInventory: () => refreshMobileModelServices(),
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
const mobileGenerationService = mobileWorkspace.generation;
/** Voice has its own queue so sentence playback can run while text is still streaming. */
export const mobileVoiceGenerationService = voiceGeneration();
const generationAdapterRegistrations = new Map<string, () => void>();
const transcriptionAdapterRegistrations = new Map<string, () => void>();
const voiceAdapterRegistrations = new Map<string, () => void>();
const sidecarAdapterRegistrations = new Map<string, () => void>();

let started = false;
let refreshChain = Promise.resolve<RuntimeModel[]>([]);
const cleanups: Array<() => void> = [];

type ModelServiceInitializationStage = 'inventory' | 'downloads' | 'shutdown';

export function projectMobileModelServiceInitializationFailure(
  stage: ModelServiceInitializationStage,
  error: unknown,
): void {
  logger.error(`[ModelServices] ${stage} initialization failed`, error);
  reportModelFailure('text', error, {
    id: `mobile-model-services-${stage}`,
    title: stage === 'downloads'
      ? 'Model downloads are unavailable'
      : stage === 'shutdown'
        ? 'Model services did not stop cleanly'
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
  const refreshInventory = () => refreshMobileLLMServiceInventory();
  refreshChain = refreshChain
    .then(refreshInventory, refreshInventory)
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
  mobileModelDownloadCoordinator.shutdown().catch(error =>
    projectMobileModelServiceInitializationFailure('shutdown', error),
  );
}

/** The user picked a model. The application facade owns remote activation and route selection. */
export async function selectMobileModel(facts: MobileRouteFacts): Promise<void> {
  const selected = await applicationFacade().models.select({
    modality: facts.modality,
    modelId: mobileRouteId(facts),
  });
  if (!selected.ok) {
    throw new Error(
      selected.failure.kind === 'runtime'
        ? selected.failure.message
        : selected.failure.kind,
    );
  }
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
  const selected = await applicationFacade().models.select({
    modality,
    modelId: null,
  });
  if (!selected.ok) {
    throw new Error(
      selected.failure.kind === 'runtime'
        ? selected.failure.message
        : selected.failure.kind,
    );
  }
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
export type { MobileRouteFacts } from './mobileRoute';
