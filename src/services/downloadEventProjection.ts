import {
  coordinatedDownloads as downloads,
} from './modelServices/coordinatedDownloadBridge';
import { mapDownloadStoreStatus } from '@offgrid/models';
import { modelDownloadApplication } from './composition/downloads';
import { modelDownloadProjection } from '../stores/downloadStore';
import { toUserMessage } from '../utils/downloadErrors';
import type { ModelKey } from '../utils/modelKey';

const downloadApplication = modelDownloadApplication();

/** Route native transfer events into the shared-backed download projection store. */
export function subscribeToDownloadProjection(): () => void {
  if (!downloads.isAvailable()) return () => undefined;

  const unsubProgress = downloads.onAnyProgress(event => {
    downloadApplication.projectEvent({
      controller: modelDownloadProjection,
      event: { ...event, status: mapDownloadStoreStatus(event.status) },
      errorMessage: toUserMessage,
      at: Date.now(),
    });
  });

  const unsubComplete = downloads.onAnyComplete(event => {
    downloadApplication.projectEvent({
      controller: modelDownloadProjection,
      event,
      errorMessage: toUserMessage,
      at: Date.now(),
    });
  });

  const unsubError = downloads.onAnyError(event => {
    downloadApplication.projectEvent({
      controller: modelDownloadProjection,
      event,
      errorMessage: toUserMessage,
      at: Date.now(),
    });
  });

  return () => { unsubProgress(); unsubComplete(); unsubError(); };
}

export async function cancelProjectedDownload(modelKey: ModelKey): Promise<void> {
  await downloadApplication.cancelProjected({
    controller: modelDownloadProjection,
    modelKey,
    cancel: id => downloads.cancelDownload(id),
  });
}

export async function retryProjectedDownload(
  modelKey: ModelKey,
  startDownload: () => Promise<string>,
): Promise<void> {
  await downloadApplication.retryProjected({
    controller: modelDownloadProjection,
    modelKey,
    cancel: id => downloads.cancelDownload(id),
    start: startDownload,
  });
}
