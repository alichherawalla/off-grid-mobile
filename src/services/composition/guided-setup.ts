import {
  createGuidedSetupSession,
  guidedSetupTierFromLoadingMode,
  guidedSetupTierToLoadingMode,
  type GuidedSetupCandidate,
  type GuidedSetupSession,
  type GuidedSetupTierPlan,
} from '@offgrid/models';
import { modelDownloadRegistry } from '../modelServices/downloadRegistryBootstrap';
import type { ModelDownload, ModelDownloadStartRequest } from '../modelServices/downloadTypes';
import { useAppStore } from '../../stores';
import {
  loadAutoSetupCompatibleCatalog,
  type AutoSetupImagePayload,
  type AutoSetupSttPayload,
  type AutoSetupTextPayload,
  type AutoSetupCatalogBoundaries,
} from '../autoSetupCatalog';
import { selectMobileModel } from '../modelServices';

export { guidedSetupDownloadId as autoSetupDownloadId } from '@offgrid/models';

export interface AutoSetupDownloadBoundaries {
  start: (request: ModelDownloadStartRequest) => Promise<void>;
  list: () => Promise<ModelDownload[]>;
  cancel: (id: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
}

const productionDownloads: AutoSetupDownloadBoundaries = {
  start: request => modelDownloadRegistry.start(request),
  list: () => modelDownloadRegistry.list(),
  cancel: id => modelDownloadRegistry.cancel(id),
  subscribe: listener => modelDownloadRegistry.subscribe(listener),
};

export type AutoSetupSession = GuidedSetupSession<
  AutoSetupTextPayload,
  AutoSetupImagePayload,
  AutoSetupSttPayload,
  never
>;
export type AutoSetupPlan = GuidedSetupTierPlan<
  AutoSetupTextPayload,
  AutoSetupImagePayload,
  AutoSetupSttPayload,
  never
>;

export interface AutoSetupSessionBoundaries {
  catalog?: AutoSetupCatalogBoundaries;
  downloads?: AutoSetupDownloadBoundaries;
  catalogDeadlineMs?: number;
}

type SetupPayload = AutoSetupTextPayload | AutoSetupImagePayload | AutoSetupSttPayload;

function toDownloadRequest(item: GuidedSetupCandidate<SetupPayload>): ModelDownloadStartRequest {
  if (item.kind === 'text') {
    const payload = item.payload as AutoSetupTextPayload;
    return { modelType: 'text', modelId: payload.modelId, file: payload.file };
  }
  if (item.kind === 'image') {
    return { modelType: 'image', model: item.payload as AutoSetupImagePayload };
  }
  return { modelType: 'stt', modelId: (item.payload as AutoSetupSttPayload).modelId };
}

/** Composition root: shared owns the complete Auto Setup use case; these are Mobile's ports. */
export function createAutoSetupSession(
  boundaries: AutoSetupSessionBoundaries = {},
): AutoSetupSession {
  const downloads = boundaries.downloads ?? productionDownloads;
  return createGuidedSetupSession({
    loadCatalog: () => loadAutoSetupCompatibleCatalog(boundaries.catalog),
    listDownloads: () => downloads.list(),
    startDownload: item => downloads.start(toDownloadRequest(item)),
    cancelDownload: id => downloads.cancel(id),
    subscribeDownloads: listener => downloads.subscribe(listener),
    loadTier: () => guidedSetupTierFromLoadingMode(
      useAppStore.getState().settings.modelLoadingMode,
    ),
    saveTier: tier => {
      useAppStore.getState().updateSettings({
        modelLoadingMode: guidedSetupTierToLoadingMode(tier),
      });
    },
    activate: async item => {
      if (item.kind !== 'text') return;
      const selected = useAppStore.getState().downloadedModels.find(
        model => model.id === item.id,
      );
      if (!selected) throw new Error('The downloaded text model is not available');
      await selectMobileModel({
        source: 'local',
        hostId: selected.engine,
        modality: 'text',
        modelId: selected.id,
      });
    },
    catalogDeadlineMs: boundaries.catalogDeadlineMs,
  });
}
