import type { ImageDownloadRecoveryService } from '@offgrid/models';
import { imageDownloadRecovery } from '../composition/model-library';
import { modelDownloadProjection } from '../../stores/downloadStore';
import type { DownloadEntry } from '../../utils/downloadStatus';
import logger from '../../utils/logger';
import type { ImageDownloadDeps } from '../imageModelDownloadTypes';
import { resumeImageDownload } from '../imageDownloadResume';
import { modelLibrary } from './bootstrap/modelLibraryBootstrap';
import { useAppStore } from '../../stores/appStore';
import { activeLocalModelId } from './activeRoute';
import { useDownloadStore } from '../../stores/downloadStore';
import { mobileModelCommands } from './modelCommandApplication';

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

const recovery = (): MobileImageDownloadRecovery => imageDownloadRecovery();

/** UI lifecycle adapter. Shared owns candidate admission, stale cleanup, and in-flight de-duplication. */
function reconcileMobileImageDownloads(
  entries: readonly DownloadEntry[],
  deps: ImageDownloadDeps,
  signal?: AbortSignal,
): Promise<void> {
  return recovery().reconcile(
    entries.map(entry => ({
      modelKey: entry.modelKey,
      modelId: entry.modelId.replace(/^image:/, ''),
      status: entry.status,
      entry,
      deps,
    })),
    signal,
  );
}

/** Application-bootstrap composition. Recovery must not depend on mounting the Models screen. */
export function reconcileImageDownloadsAtBootstrap(
  signal?: AbortSignal,
): Promise<void> {
  const state = useAppStore.getState();
  return reconcileMobileImageDownloads(
    Object.values(useDownloadStore.getState().downloads).filter(
      entry => entry.modelType === 'image',
    ),
    {
      addDownloadedImageModel: state.addDownloadedImageModel,
      activeImageModelId: activeLocalModelId('image'),
      selectActiveImageModel: model =>
        mobileModelCommands.select(
          {
            source: 'local',
            hostId: model.backend ?? 'image-runtime',
            modality: 'image',
            modelId: model.id,
          },
          { load: false },
        ),
      setAlertState: () => undefined,
      triedImageGen: state.onboardingChecklist.triedImageGen,
    },
    signal,
  );
}
