import { useSyncExternalStore } from 'react';
import type { ModelsSnapshot, RagSnapshot } from '@offgrid/application';
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
