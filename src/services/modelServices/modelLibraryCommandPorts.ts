import type {
  ModelLibraryCommandService,
  ModelLibraryCommandTarget,
  ModelModality,
} from '@offgrid/models';
import { useAppStore } from '../../stores/appStore';
import {
  modelDownloadProjection,
  useDownloadStore,
  type DownloadEntry,
} from '../../stores/downloadStore';
import logger from '../../utils/logger';
import { modelLibrary } from './bootstrap/modelLibraryBootstrap';
import { coordinatedDownloads } from './coordinatedDownloadBridge';
import { unloadImageModel, unloadTextModel } from './modelLifecycleBootstrap';
import { mobileModelSelectionService } from './modelSelectionApplication';
import { readMobileModelSelection } from './modelSelectionProjection';
import { mobileRouteId } from './mobileRoute';
import { refreshMobileLLMServiceInventory } from './mobileLLMService';

export type LibraryModality = 'text' | 'image';

interface MobileLibraryCommandTarget extends ModelLibraryCommandTarget {
  modality: LibraryModality;
  installed: boolean;
}

function downloadEntries(modality: LibraryModality, modelId: string): DownloadEntry[] {
  return Object.values(useDownloadStore.getState().downloads).filter(entry => {
    if (entry.modelType !== modality) return false;
    if (modality === 'image') return entry.modelId.replace(/^image:/, '') === modelId;
    return entry.modelKey === modelId || entry.modelId === modelId;
  });
}

async function resolveTarget(
  modality: ModelModality,
  modelId: string,
): Promise<MobileLibraryCommandTarget | null> {
  if (modality !== 'text' && modality !== 'image') return null;
  const app = useAppStore.getState();
  const entries = downloadEntries(modality, modelId);
  const textModel = modality === 'text'
    ? app.downloadedModels.find(model => model.id === modelId)
    : undefined;
  const imageModel = modality === 'image'
    ? app.downloadedImageModels.find(model => model.id === modelId)
    : undefined;
  const installed = textModel ?? imageModel;
  if (!installed && entries.length === 0) return null;
  const hostId = modality === 'text'
    ? textModel?.engine ?? 'llama'
    : imageModel?.backend ?? 'image-runtime';
  const canonicalRouteId = installed
    ? mobileRouteId({ source: 'local', hostId, modality, modelId })
    : null;
  const extraImageTransferIds = modality === 'image'
    ? (await coordinatedDownloads.getActiveDownloads().catch(() => []))
      .filter(row => row.modelId === `image:${modelId}`)
      .map(row => row.downloadId)
    : [];
  return {
    modelId,
    modality,
    canonicalRouteId,
    selectedRouteId: readMobileModelSelection(modality),
    installed: Boolean(installed),
    queuedKeys: entries.map(entry => entry.modelKey),
    transferIds: entries.flatMap(entry =>
      [entry.downloadId, entry.mmProjDownloadId].filter((id): id is string => Boolean(id)))
      .concat(extraImageTransferIds),
    projectionKeys: entries.map(entry => entry.modelKey),
  };
}

/** Store, download-bridge, and runtime ports. Shared owns the remove/cancel transactions. */
export function mobileModelLibraryCommandPorts(): ConstructorParameters<typeof ModelLibraryCommandService>[0] {
  return {
  resolve: resolveTarget,
  cancelQueued: modelKey => { coordinatedDownloads.cancelQueued(modelKey); },
  cancelTransfer: transferId => coordinatedDownloads.cancelDownload(transferId),
  async releaseRuntime(target) {
    if (target.modality === 'text') await unloadTextModel();
    else if (target.modality === 'image') await unloadImageModel();
  },
  async removePackage(target) {
    const mobile = target as MobileLibraryCommandTarget;
    if (!mobile.installed) return;
    if (mobile.modality === 'text') await modelLibrary.deleteModel(mobile.modelId);
    else await modelLibrary.deleteImageModel(mobile.modelId);
  },
  removeProjection(target, scope) {
    const mobile = target as MobileLibraryCommandTarget;
    for (const key of target.projectionKeys) modelDownloadProjection.remove(key);
    if (scope !== 'package' || !mobile.installed) return;
    if (mobile.modality === 'text') useAppStore.getState().removeDownloadedModel(mobile.modelId);
    else useAppStore.getState().removeDownloadedImageModel(mobile.modelId);
  },
  removeSelection(target) {
    if (!target.canonicalRouteId) return Promise.resolve(false);
    return mobileModelSelectionService.remove({
      modality: target.modality,
      routeId: target.canonicalRouteId,
    });
  },
  refreshInventory: async () => { await refreshMobileLLMServiceInventory(); },
  observe(event) {
    if (event.type === 'removed') {
      logger.log(`[ModelLibrary] removed ${event.modality}:${event.modelId}`);
      return;
    }
    const transfer = 'transferId' in event ? ` transfer=${event.transferId}` : '';
    logger.log(`[ModelLibrary] ${event.type} model=${event.modelId}${transfer} error=${event.error}`);
  },
};
}
