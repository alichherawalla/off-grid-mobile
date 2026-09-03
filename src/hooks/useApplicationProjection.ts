import { useSyncExternalStore } from 'react';
import type {
  ModelsSnapshot,
  RagSnapshot,
  SyncSnapshot,
} from '@offgrid/application';
import { applicationFacade } from '../services/applicationFacade';

/** Structurally shared, read-only Models projection from the application root. */
export function useModelsProjection(): ModelsSnapshot {
  const models = applicationFacade().models;
  return useSyncExternalStore(
    models.subscribe,
    models.snapshot,
    models.snapshot,
  );
}

/** Structurally shared, read-only RAG projection from the application root. */
export function useRagProjection(): RagSnapshot {
  const rag = applicationFacade().rag;
  return useSyncExternalStore(
    rag.subscribe,
    rag.snapshot,
    rag.snapshot,
  );
}

/** Structurally shared, read-only Sync projection from the application root. */
export function useSyncProjection(): SyncSnapshot {
  const sync = applicationFacade().sync;
  return useSyncExternalStore(sync.subscribe, sync.snapshot, sync.snapshot);
}
