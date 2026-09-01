import {
  createAutoSetupSession as createSharedAutoSetupSession,
  type AutoSetupCandidate,
  type AutoSetupSession as SharedAutoSetupSession,
} from '@offgrid/models';
import { modelDownloadRegistry } from './modelServices/downloadRegistryBootstrap';
import type { ModelDownload, ModelDownloadStartRequest } from './modelServices/downloadTypes';
import { useAppStore } from '../stores';
import {
  loadAutoSetupCompatibleCatalog,
  type AutoSetupCatalogBoundaries,
} from './autoSetupCatalog';
import type {
  AutoSetupImagePayload,
  AutoSetupSttPayload,
  AutoSetupTextPayload,
} from './autoSetupPlan';
import { selectMobileModel } from './modelServices';

export { autoSetupDownloadId } from '@offgrid/models';

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

export type AutoSetupSession = SharedAutoSetupSession<
  AutoSetupTextPayload,
  AutoSetupImagePayload,
  AutoSetupSttPayload
>;

export interface AutoSetupSessionBoundaries {
  catalog?: AutoSetupCatalogBoundaries;
  downloads?: AutoSetupDownloadBoundaries;
  catalogDeadlineMs?: number;
}

const TIER_TO_LOADING_MODE = {
  lean: 'conservative',
  balanced: 'balanced',
  extreme: 'aggressive',
} as const;

type SetupPayload = AutoSetupTextPayload | AutoSetupImagePayload | AutoSetupSttPayload;

function toDownloadRequest(item: AutoSetupCandidate<SetupPayload>): ModelDownloadStartRequest {
  if (item.kind === 'text') {
    const payload = item.payload as AutoSetupTextPayload;
    return { modelType: 'text', modelId: payload.modelId, file: payload.file };
  }
  if (item.kind === 'image') {
    return { modelType: 'image', model: item.payload as AutoSetupImagePayload };
  }
  return { modelType: 'stt', modelId: (item.payload as AutoSetupSttPayload).modelId };
}

/** Mobile composition root. Shared owns the complete Auto Setup use case. */
export function createAutoSetupSession(
  boundaries: AutoSetupSessionBoundaries = {},
): AutoSetupSession {
  const downloads = boundaries.downloads ?? productionDownloads;
  return createSharedAutoSetupSession({
    loadCatalog: () => loadAutoSetupCompatibleCatalog(boundaries.catalog),
    listDownloads: () => downloads.list(),
    startDownload: item => downloads.start(toDownloadRequest(item)),
    cancelDownload: id => downloads.cancel(id),
    subscribeDownloads: listener => downloads.subscribe(listener),
    loadTier: () => {
      const mode = useAppStore.getState().settings.modelLoadingMode;
      return mode === 'conservative'
        ? 'lean'
        : mode === 'aggressive'
          ? 'extreme'
          : 'balanced';
    },
    saveTier: tier => {
      useAppStore.getState().updateSettings({ modelLoadingMode: TIER_TO_LOADING_MODE[tier] });
    },
    activateText: async item => {
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
