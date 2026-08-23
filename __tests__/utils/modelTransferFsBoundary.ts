import { createNativeFileSystemBoundary } from '../harness/nativeFileSystem';

/**
 * Compatibility export for the sync suites. The implementation lives at the one native filesystem
 * boundary used by every test family.
 */
export const modelTransferFsBoundary = createNativeFileSystemBoundary();
