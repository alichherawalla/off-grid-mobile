import { useSyncExternalStore } from 'react';
import { modelResidencyManager } from './residencyBootstrap';

/** Shared knows when a model of this modality is loading or unloading; this only subscribes. */
export function useModelResidencyBusy(modality: string): boolean {
  return useSyncExternalStore(
    listener => modelResidencyManager.subscribe(listener),
    () => modelResidencyManager.isBusy(modality),
    () => false,
  );
}
