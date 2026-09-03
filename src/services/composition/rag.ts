// Composition root: the shared RAG service over Mobile's store, embedding, and extraction ports.
import { RagService } from '@offgrid/rag';
import { once } from './once';

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports1 = (): typeof import('../adapters/rag/mobileRagPorts') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../adapters/rag/mobileRagPorts') as typeof import('../adapters/rag/mobileRagPorts');

export const sharedRag = once(() => {
  const ports = ports1();
  return new RagService({
    store: ports.mobileRagStore,
    embeddings: ports.mobileRagEmbeddings,
    extraction: ports.mobileRagExtraction,
    prepareDocument: ports.prepareMobileRagDocument,
  });
});
