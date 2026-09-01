import { create } from 'zustand';
import { reduceDownloadProjection } from '@offgrid/models';
import type { ModelKey } from '../utils/modelKey';
import type { DownloadStatus, DownloadEntry } from '../utils/downloadStatus';

export type { DownloadStatus, DownloadEntry };
export type { ModelType } from '../utils/downloadStatus';
export {
  isActiveStatus,
  isQueuedStatus,
  isDownloadingStatus,
  isFailedStatus,
} from '../utils/downloadStatus';

interface DownloadStoreState {
  downloads: Record<ModelKey, DownloadEntry>;
  downloadIdIndex: Record<string, ModelKey>;
  repairingVisionIds: Record<string, true>;
  setRepairingVision(modelId: string, repairing: boolean): void;
  setAll(entries: DownloadEntry[]): void;
  hydrate(entries: DownloadEntry[]): void;
  add(entry: DownloadEntry): void;
  setMmProjDownloadId(modelKey: ModelKey, mmProjDownloadId: string): void;
  updateProgress(downloadId: string, bytes: number, total: number): void;
  updateMmProjProgress(mmProjDownloadId: string, bytes: number): void;
  setStatus(downloadId: string, status: DownloadStatus, error?: { message: string; code?: string }): void;
  setProcessing(downloadId: string): void;
  setCompleted(downloadId: string): void;
  setMmProjCompleted(mmProjDownloadId: string, bytes: number): void;
  retryEntry(modelKey: ModelKey, newDownloadId: string): void;
  remove(modelKey: ModelKey): void;
}

type Projection = Pick<DownloadStoreState, 'downloads' | 'downloadIdIndex'>;

export const useDownloadStore = create<DownloadStoreState>((set) => {
  const reduce = (event: Parameters<typeof reduceDownloadProjection<DownloadEntry>>[1]) =>
    set(state => reduceDownloadProjection(state as Projection, event));
  return {
    downloads: {},
    downloadIdIndex: {},
    repairingVisionIds: {},
    setRepairingVision: (modelId, repairing) => set(state => {
      const repairingVisionIds = { ...state.repairingVisionIds };
      if (repairing) repairingVisionIds[modelId] = true;
      else delete repairingVisionIds[modelId];
      return { repairingVisionIds };
    }),
    setAll: entries => reduce({ type: 'replace', entries }),
    hydrate: entries => reduce({ type: 'hydrate', entries }),
    add: entry => reduce({ type: 'add', entry }),
    setMmProjDownloadId: (modelKey, downloadId) =>
      reduce({ type: 'attach-projector', modelKey, downloadId }),
    updateProgress: (downloadId, bytes, total) =>
      reduce({ type: 'progress', downloadId, bytes, total, at: Date.now() }),
    updateMmProjProgress: (downloadId, bytes) =>
      reduce({ type: 'projector-progress', downloadId, bytes, at: Date.now() }),
    setStatus: (downloadId, status, error) =>
      reduce({ type: 'status', downloadId, status, error }),
    setProcessing: downloadId => reduce({ type: 'processing', downloadId }),
    setCompleted: downloadId => reduce({ type: 'completed', downloadId }),
    setMmProjCompleted: (downloadId, bytes) =>
      reduce({ type: 'projector-completed', downloadId, bytes }),
    retryEntry: (modelKey, downloadId) => reduce({ type: 'retry', modelKey, downloadId }),
    remove: modelKey => reduce({ type: 'remove', modelKey }),
  };
});
