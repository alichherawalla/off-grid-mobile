import { restoreQueuedDownloadRequests } from '@offgrid/models';
import { modelDownloadRegistry } from './modelServices/downloadRegistryBootstrap';
import { loadQueuedDownloads, saveQueuedDownloads } from './queuedDownloadPersistence';
import { useDownloadStore } from '../stores/downloadStore';
import { useAppStore } from '../stores';
import { makeModelKey } from '../utils/modelKey';
import logger from '../utils/logger';
import type { QueuedParams } from './queuedDownloadPersistence';

function keyFor(params: QueuedParams): string {
  return params.modelKey ?? (
    params.modelId && params.fileName
      ? makeModelKey(params.modelId, params.fileName)
      : params.modelId ?? params.fileName ?? params.url
  );
}

/** Mobile persistence and registry adapter for Shared queued-start recovery. */
export function restoreQueuedDownloads(): Promise<void> {
  return restoreQueuedDownloadRequests({
    load: loadQueuedDownloads,
    save: saveQueuedDownloads,
    keyFor,
    isPresent: key => Boolean(useDownloadStore.getState().downloads[key]) ||
      useAppStore.getState().downloadedModels.some(model => model.id === key),
    reissue: params => modelDownloadRegistry.reissue({
      ...params,
      modelType: params.modelType ?? 'text',
    }),
    onEvent: message => logger.log(`[DL-SM] ${message}`),
  });
}
