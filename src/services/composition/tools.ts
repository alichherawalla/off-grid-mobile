// Composition root: shared tool routing over Mobile's embedding ports.
import { PersistentToolEmbeddingCache, ToolRoutingService } from '@offgrid/models';
import { once } from '@offgrid/models';

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports1 = (): typeof import('../modelServices/toolPorts') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/toolPorts') as typeof import('../modelServices/toolPorts');

const ports2 = (): typeof import('../adapters/native/toolEmbeddingAdapter') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../adapters/native/toolEmbeddingAdapter') as typeof import('../adapters/native/toolEmbeddingAdapter');

export const toolRouting = once(() => new ToolRoutingService(ports1().mobileToolRoutingPorts()));

/** The persisted tool-embedding cache over React Native storage. Shared owns identity and eviction. */
export const mobileToolEmbeddingCache = once(() => new PersistentToolEmbeddingCache({
  read: () => ports2().mobileToolEmbeddingStorage.read(),
  write: entries => ports2().mobileToolEmbeddingStorage.write(entries),
}));

export function resetMobileToolEmbeddingCache(): void {
  mobileToolEmbeddingCache().clear();
}
