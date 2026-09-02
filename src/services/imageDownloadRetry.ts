import { parseImageDownloadMetadata } from '@offgrid/models';
import { useAppStore } from '../stores';
import type { DownloadEntry } from '../stores/downloadStore';
import type { AlertState } from '../utils/alertState';
import { executeMobileImageDownload } from './adapters/downloads/imageDownloadApplicationAdapter';
import { selectMobileModel } from './modelServices';

export function parseEntryMetadata(entry: DownloadEntry): Record<string, unknown> | null {
  const metadata = parseImageDownloadMetadata(entry.metadataJson);
  return metadata ? { ...metadata } : null;
}

export async function retryImageDownload(
  entry: DownloadEntry | undefined,
  setAlertState: (state: AlertState) => void,
): Promise<void> {
  if (!entry) return;
  const state = useAppStore.getState();
  await executeMobileImageDownload({
    type: 'retry', entry, platformCanResume: false,
  }, {
    addDownloadedImageModel: state.addDownloadedImageModel,
    activeImageModelId: state.activeImageModelId,
    selectActiveImageModel: model => selectMobileModel({
      source: 'local', hostId: model.backend ?? 'image-runtime', modality: 'image', modelId: model.id,
    }),
    setAlertState,
    triedImageGen: state.onboardingChecklist.triedImageGen,
  });
}
