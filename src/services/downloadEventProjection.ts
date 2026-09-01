import { coordinatedDownloads as downloads } from './modelServices/coordinatedDownloadBridge';
import { useDownloadStore } from '../stores/downloadStore';
import { toUserMessage } from '../utils/downloadErrors';
import type { ModelKey } from '../utils/modelKey';

/** Route native transfer events into the shared-backed download projection store. */
export function subscribeToDownloadProjection(): () => void {
  if (!downloads.isAvailable()) return () => undefined;

  const unsubProgress = downloads.onAnyProgress(event => {
    const state = useDownloadStore.getState();
    const modelKey = state.downloadIdIndex[event.downloadId];
    const entry = modelKey ? state.downloads[modelKey] : undefined;
    if (!entry) return;
    if (event.status === 'retrying' || event.status === 'waiting_for_network') {
      state.setStatus(event.downloadId, event.status);
    } else if (entry.downloadId === event.downloadId) {
      state.updateProgress(event.downloadId, event.bytesDownloaded, event.totalBytes);
    } else if (entry.mmProjDownloadId === event.downloadId) {
      state.updateMmProjProgress(event.downloadId, event.bytesDownloaded);
    }
  });

  const unsubComplete = downloads.onAnyComplete(event => {
    const state = useDownloadStore.getState();
    const modelKey = state.downloadIdIndex[event.downloadId];
    const entry = modelKey ? state.downloads[modelKey] : undefined;
    if (!entry) return;
    if (entry.mmProjDownloadId === event.downloadId) {
      state.setMmProjCompleted(event.downloadId, event.bytesDownloaded);
      const updated = useDownloadStore.getState().downloads[modelKey];
      if (updated?.status === 'completed') useDownloadStore.getState().setCompleted(entry.downloadId);
      return;
    }
    if (entry.mmProjDownloadId && entry.mmProjStatus !== 'completed') {
      state.updateProgress(event.downloadId, event.bytesDownloaded, event.totalBytes);
    } else if (entry.modelType === 'image') {
      state.setProcessing(event.downloadId);
    } else if (entry.modelType === 'text') {
      state.updateProgress(event.downloadId, event.bytesDownloaded, event.totalBytes);
    } else {
      state.setCompleted(event.downloadId);
    }
  });

  const unsubError = downloads.onAnyError(event => {
    const state = useDownloadStore.getState();
    if (!state.downloadIdIndex[event.downloadId]) return;
    state.setStatus(event.downloadId, 'failed', {
      message: toUserMessage(event.reason, event.reasonCode),
      code: event.reasonCode,
    });
  });

  return () => { unsubProgress(); unsubComplete(); unsubError(); };
}

export async function cancelProjectedDownload(modelKey: ModelKey): Promise<void> {
  const entry = useDownloadStore.getState().downloads[modelKey];
  if (!entry) return;
  useDownloadStore.getState().remove(modelKey);
  await downloads.cancelDownload(entry.downloadId).catch(() => undefined);
  if (entry.mmProjDownloadId) await downloads.cancelDownload(entry.mmProjDownloadId).catch(() => undefined);
}

export async function retryProjectedDownload(
  modelKey: ModelKey,
  startDownload: () => Promise<string>,
): Promise<void> {
  const entry = useDownloadStore.getState().downloads[modelKey];
  if (!entry) return;
  await downloads.cancelDownload(entry.downloadId).catch(() => undefined);
  const newDownloadId = await startDownload();
  useDownloadStore.getState().retryEntry(modelKey, newDownloadId);
}
