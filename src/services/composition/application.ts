/** Mobile composition root. Shared owns the application and domain behavior; this file supplies I/O. */
import { createOffGridApplication } from '@offgrid/application';
import { generateId } from '../../utils/generateId';
import { mobileRagEmbeddings, mobileRagExtraction, mobileRagStore, prepareMobileRagDocument } from '../adapters/rag/mobileRagPorts';
import { mobileWorkspace } from '../modelServices/workspace';

export const mobileApplication = createOffGridApplication({
  models: { workspace: mobileWorkspace },
  rag: {
    store: mobileRagStore,
    embeddings: mobileRagEmbeddings,
    extraction: mobileRagExtraction,
    prepareDocument: prepareMobileRagDocument,
  },
  newId: generateId,
});

let starting: ReturnType<typeof mobileApplication.start> | null = null;

export function startMobileApplication(): ReturnType<typeof mobileApplication.start> {
  starting ??= mobileApplication.start();
  return starting;
}

export function stopMobileApplication(): void {
  mobileApplication.stop().catch(() => undefined);
  starting = null;
}
