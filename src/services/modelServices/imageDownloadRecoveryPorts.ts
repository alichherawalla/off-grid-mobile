import type { ImageDownloadRecoveryService } from '@offgrid/models';
import { modelDownloadProjection } from '../../stores/downloadStore';
import type { DownloadEntry } from '../../utils/downloadStatus';
import logger from '../../utils/logger';
import type { ImageDownloadDeps } from '../imageModelDownloadTypes';
import { resumeImageDownload } from '../imageDownloadResume';
import { modelLibrary } from './bootstrap/modelLibraryBootstrap';

export interface MobileImageRecoveryCandidate {
  modelKey: string;
  modelId: string;
  status: string;
  entry: DownloadEntry;
  deps: ImageDownloadDeps;
}

export type MobileImageDownloadRecovery = ImageDownloadRecoveryService<MobileImageRecoveryCandidate>;

/** Library, projection, and resume ports. Shared owns admission and de-duplication. */
export function mobileImageDownloadRecoveryPorts(): ConstructorParameters<typeof ImageDownloadRecoveryService<MobileImageRecoveryCandidate>>[0] {
  return {
    installedModelIds: async () =>
      new Set(
        (await modelLibrary.getDownloadedImageModels()).map(model => model.id),
      ),
    removeProjection: modelKey => {
      modelDownloadProjection.remove(modelKey);
    },
    resume: candidate => resumeImageDownload(candidate.entry, candidate.deps),
    observe(event) {
      if (event.type === 'resume-failed') {
        logger.warn(
          `[ImageDownload] recovery failed model=${event.modelId} error=${event.error}`,
        );
      }
    },
  };
}
