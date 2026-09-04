import { useCallback, useSyncExternalStore } from 'react';
import type { ModelsSnapshot } from '@offgrid/application';
import { applicationFacade } from '../services/applicationFacade';

const selectDownloads = (snapshot: ModelsSnapshot) => snapshot.downloads;

/** The one Mobile React projection of facade-owned model downloads. */
export function useModelDownloadsProjection(): ModelsSnapshot['downloads'] {
  const models = applicationFacade().models;
  const getSnapshot = useCallback(
    () => selectDownloads(models.snapshot()),
    [models],
  );
  const subscribe = useCallback(
    (notify: () => void) => models.watch(selectDownloads, notify),
    [models],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Subscribe one card to one facade-owned row, not to the complete download list. */
export function useModelDownloadEntry(modelType: string, modelId: string) {
  const models = applicationFacade().models;
  const select = useCallback(
    (snapshot: ModelsSnapshot) => snapshot.downloads.find(
      row => row.modelType === modelType && row.modelId === modelId,
    ),
    [modelId, modelType],
  );
  const getSnapshot = useCallback(() => select(models.snapshot()), [models, select]);
  const subscribe = useCallback(
    (notify: () => void) => models.watch(select, notify),
    [models, select],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
