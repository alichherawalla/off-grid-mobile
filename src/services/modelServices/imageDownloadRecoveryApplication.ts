import { ImageDownloadRecoveryService } from '@offgrid/models';
import { modelDownloadProjection } from '../../stores/downloadStore';
import type { DownloadEntry } from '../../utils/downloadStatus';
import logger from '../../utils/logger';
import type { ImageDownloadDeps } from '../imageModelDownloadTypes';
import { resumeImageDownload } from '../imageDownloadResume';
import { modelLibrary } from './bootstrap/modelLibraryBootstrap';

interface MobileImageRecoveryCandidate {
  modelKey: string;
  modelId: string;
  status: string;
  entry: DownloadEntry;
  deps: ImageDownloadDeps;
}

const recovery = new ImageDownloadRecoveryService<MobileImageRecoveryCandidate>({
  installedModelIds: async () => new Set(
    (await modelLibrary.getDownloadedImageModels()).map(model => model.id),
  ),
  removeProjection: modelKey => { modelDownloadProjection.remove(modelKey); },
  resume: candidate => resumeImageDownload(candidate.entry, candidate.deps),
  observe(event) {
    if (event.type === 'resume-failed') {
      logger.warn(`[ImageDownload] recovery failed model=${event.modelId} error=${event.error}`);
    }
  },
});

/** UI lifecycle adapter. Shared owns candidate admission, stale cleanup, and in-flight de-duplication. */
export function reconcileMobileImageDownloads(
  entries: readonly DownloadEntry[],
  deps: ImageDownloadDeps,
  signal?: AbortSignal,
): Promise<void> {
  return recovery.reconcile(entries.map(entry => ({
    modelKey: entry.modelKey,
    modelId: entry.modelId.replace(/^image:/, ''),
    status: entry.status,
    entry,
    deps,
  })), signal);
}
