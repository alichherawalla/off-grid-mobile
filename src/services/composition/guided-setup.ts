import {
  createGuidedSetupSession,
  guidedSetupDownloadId,
  guidedSetupTierFromLoadingMode,
  guidedSetupTierToLoadingMode,
  type GuidedSetupCandidate,
  type GuidedSetupDownloadProjection,
  type GuidedSetupSession,
  type GuidedSetupTierPlan,
} from '@offgrid/models';
import type { ModelDownloadStartRequest } from '../modelServices/downloadTypes';
import {
  createWhisperPublicDownloadRequest,
  modelsFailureMessage,
  WHISPER_MODELS,
} from '@offgrid/application';
import { useAppStore } from '../../stores';
import {
  loadAutoSetupCompatibleCatalog,
  type AutoSetupImagePayload,
  type AutoSetupSttPayload,
  type AutoSetupTextPayload,
  type AutoSetupCatalogBoundaries,
} from '../autoSetupCatalog';
import { selectMobileModel } from '../modelServices/selectionCommands';
import { applicationFacade } from '../applicationFacade';
import {
  mobileTextDownloadRequest,
} from '../modelServices/modelDownloadRequests';
import { publicImageDownloadRequest } from '../adapters/models/downloads/publicImageDownloadRequest';

export interface AutoSetupDownloadBoundaries {
  start: (request: ModelDownloadStartRequest) => Promise<void>;
  list: () => Promise<GuidedSetupDownloadProjection[]>;
  cancel: (id: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
}

function publicRequest(request: ModelDownloadStartRequest) {
  if (request.modelType === 'text') {
    return mobileTextDownloadRequest(request.modelId, request.file);
  }
  if (request.modelType === 'image') return publicImageDownloadRequest(request.model);
  const model = WHISPER_MODELS.find(candidate => candidate.id === request.modelId);
  if (!model) throw new Error(`Unknown transcription model: ${request.modelId}`);
  return createWhisperPublicDownloadRequest(model);
}

const productionDownloads: AutoSetupDownloadBoundaries = {
  async start(request) {
    const outcome = await applicationFacade().models.download(publicRequest(request));
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
  },
  list: async () => applicationFacade().models.snapshot().downloads.map(row => ({
    id: guidedSetupDownloadId({ kind: row.modelType ?? 'text', id: row.modelId }),
    status: row.status,
    progress: row.totalBytes > 0 ? row.bytesDownloaded / row.totalBytes : 0,
    ...(row.reason ? { error: row.reason } : {}),
  })),
  async cancel(id) {
    const row = applicationFacade().models.snapshot().downloads.find(candidate =>
      guidedSetupDownloadId({ kind: candidate.modelType ?? 'text', id: candidate.modelId }) === id,
    );
    if (!row) return;
    const outcome = await applicationFacade().models.cancelDownload({
      downloadId: row.downloadId,
      removePartial: true,
    });
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
  },
  subscribe: listener => applicationFacade().models.watch(snapshot => snapshot.downloads, listener),
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
