import { useEffect } from 'react';
import { useDownloadStore, isActiveStatus } from '../stores/downloadStore';
import { ModelKey } from '../utils/modelKey';
import {
  cancelProjectedDownload,
  retryProjectedDownload,
  subscribeToDownloadProjection,
} from '../services/downloadEventProjection';

/**
 * Lightweight hook for App root — registers native download event listeners only.
 * Has NO store subscription, so download progress never re-renders the root
 * component and the entire navigation tree.
 *
 * Screens that need to read download state should use useDownloads() directly.
 */
export function useDownloadListeners() {
  useEffect(() => {
    return subscribeToDownloadProjection();
  }, []);
}

export function useDownloads() {
  const cancel = (modelKey: ModelKey) => cancelProjectedDownload(modelKey);
  const retry = (modelKey: ModelKey, startDownload: () => Promise<string>) =>
    retryProjectedDownload(modelKey, startDownload);

  const downloads = useDownloadStore(state => state.downloads);

  return {
    downloads,
    // Use the shared classifier so this never drifts from every other surface — the
    // inline list omitted 'retrying'/'waiting_for_network', which isActiveStatus counts.
    active: Object.values(downloads).filter(d => isActiveStatus(d.status)),
    failed: Object.values(downloads).filter(d => d.status === 'failed'),
    completed: Object.values(downloads).filter(d => d.status === 'completed'),
    cancel,
    retry,
  };
}
