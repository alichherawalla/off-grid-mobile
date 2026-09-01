import {
  isModelProjectorFile,
  reconcileNativeDownloadSnapshot,
  type NativeDownloadRow,
} from '@offgrid/models';
import { coordinatedDownloads as backgroundDownloadService } from './modelServices/coordinatedDownloadBridge';
import { useDownloadStore, type DownloadEntry } from '../stores/downloadStore';
import { makeModelKey } from '../utils/modelKey';
import { loadActiveDownloads } from './activeDownloadPersistence';
import logger from '../utils/logger';

/** Kept as a boundary export for the model-library restore adapter. */
export function isMmProjFileName(fileName: string): boolean {
  return isModelProjectorFile(fileName);
}

/** Read native and durable projections, then let Shared reconcile one authoritative snapshot. */
export async function hydrateDownloadStore(): Promise<void> {
  if (!backgroundDownloadService.isAvailable()) return;
  const [rows, persistedPrior] = await Promise.all([
    backgroundDownloadService.getActiveDownloads() as Promise<NativeDownloadRow[]>,
    loadActiveDownloads(),
  ]);
  const entries = reconcileNativeDownloadSnapshot({
    rows,
    persistedPrior,
    inMemoryPrior: Object.values(useDownloadStore.getState().downloads),
    keyFor: row => makeModelKey(row.modelId ?? '', row.fileName),
    interruptedMessage: 'Interrupted — app closed. Tap retry.',
    onMalformedRow: (row, error) => logger.error(
      '[DownloadHydration] Failed to hydrate download row',
      {
        downloadId: row.downloadId,
        modelId: row.modelId,
        fileName: row.fileName,
        error: error instanceof Error ? error.message : String(error),
      },
    ),
  });
  useDownloadStore.getState().hydrate(entries as DownloadEntry[]);
}
