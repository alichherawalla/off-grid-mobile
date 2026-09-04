import { imageDownloadRecovery } from '../composition/model-library';
import type { DownloadEntry } from '../../utils/downloadStatus';
import type { ImageDownloadDeps } from '../imageModelDownloadTypes';
import { useAppStore } from '../../stores/appStore';
import { activeLocalModelId } from './activeRoute';
import { useDownloadStore } from '../../stores/downloadStore';
import { mobileModelCommands } from './modelCommandApplication';
import type { MobileImageDownloadRecovery } from './imageDownloadRecoveryPorts';

export type {
  MobileImageDownloadRecovery,
  MobileImageRecoveryCandidate,
} from './imageDownloadRecoveryPorts';

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
