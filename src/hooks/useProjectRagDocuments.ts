import { useEffect, useState } from 'react';
import type { RagDocument } from '@offgrid/application';
import logger from '../utils/logger';
import { applicationFacade } from '../services/applicationFacade';
import { useRagProjection } from './useApplicationProjection';

/** Load one bounded project read model, then keep rendering its reactive projection. */
export function useProjectRagDocuments(
  projectId: string,
): readonly RagDocument[] {
  const documents = useRagProjection().documents;
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadedProjectId(null);
    applicationFacade()
      .rag.loadProjectDocuments(projectId)
      .then(() => {
        if (active) setLoadedProjectId(projectId);
      })
      .catch(error => {
        logger.error(
          `[RAG] Failed to load documents for project ${projectId}`,
          error,
        );
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  return loadedProjectId === projectId
    ? documents.filter(document => document.projectId === projectId)
    : [];
}
