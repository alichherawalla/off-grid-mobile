/**
 * iOS image-download retry — the ONE retry path that is genuinely UI-coupled (it pops
 * alerts and resumes finalization), so the image DownloadProvider delegates it back
 * here through ModelDownloadService's injected image ops. This module is
 * platform-AGNOSTIC: the Android-vs-iOS retry decision now lives inside
 * imageProvider.retry() (Android resumes the native row directly; iOS routes here).
 * Text / STT retry are owned by their providers too — per CLAUDE.md, retry mechanism
 * selection does not belong in the presentation layer. `parseEntryMetadata` stays
 * because the Download Manager's item mapping uses it.
 */
import type { AlertState } from '../utils/alertState';
import { useAppStore } from '../stores';
import { DownloadEntry } from '../stores/downloadStore';
import { coordinatedDownloads as backgroundDownloadService } from './modelServices/coordinatedDownloadBridge';
import { selectMobileModel } from './modelServices';
import logger from '../utils/logger';
import {
  imageDownloadRetryAction,
  isSyntheticImageDownloadId,
  parseImageDownloadMetadata,
} from '@offgrid/models';
import {
  proceedWithDownload,
  type ImageDownloadDeps,
} from './imageDownloadActions';
import { imageDescriptorFromMetadata } from './imageDescriptor';
import { resumeImageDownload } from './imageDownloadResume';

export function parseEntryMetadata(entry: DownloadEntry): Record<string, any> | null {
  return parseImageDownloadMetadata(entry.metadataJson) ?? null;
}

async function resumeImageFinalization(
  entry: DownloadEntry,
  setAlertState: (state: AlertState) => void,
): Promise<void> {
  const appState = useAppStore.getState();
  await resumeImageDownload(entry, {
    addDownloadedImageModel: appState.addDownloadedImageModel,
    activeImageModelId: appState.activeImageModelId,
    selectActiveImageModel: model => selectMobileModel({
      source: 'local',
      hostId: model.backend ?? 'image-runtime',
      modality: 'image',
      modelId: model.id,
    }),
    setAlertState,
    triedImageGen: appState.onboardingChecklist.triedImageGen,
  });
}

async function retryIosImageDownload(entry: DownloadEntry, setAlertState: (s: AlertState) => void): Promise<void> {
  const meta = parseEntryMetadata(entry);
  if (!meta) return;
  const isZip = meta.imageDownloadType === 'zip';
  if (isZip && !meta.imageModelDownloadUrl) {
    logger.error('[DownloadManager] retryIosImageDownload: missing imageModelDownloadUrl for zip download', { modelId: entry.modelId });
    return;
  }
  // Cancel the stale native row so it doesn't accumulate in the native DB across
  // retries. proceedWithDownload starts a fresh row.
  await backgroundDownloadService.cancelDownload(entry.downloadId).catch(() => {});
  const modelId = entry.modelId.replace('image:', '');
  const appState = useAppStore.getState();
  const deps: ImageDownloadDeps = {
    addDownloadedImageModel: appState.addDownloadedImageModel,
    activeImageModelId: appState.activeImageModelId,
    selectActiveImageModel: model => selectMobileModel({
      source: 'local',
      hostId: model.backend ?? 'image-runtime',
      modality: 'image',
      modelId: model.id,
    }),
    setAlertState,
    triedImageGen: appState.onboardingChecklist.triedImageGen,
  };
  await proceedWithDownload(imageDescriptorFromMetadata(modelId, meta), deps);
}

/**
 * An image download whose bytes are all present (or already 'processing') just needs
 * its post-download finalization re-run, not a fresh download. Returns true when it
 * handled the retry so the caller can stop.
 */
/**
 * Re-run finalization when the bytes are present. Otherwise, restart the download.
 * User feedback goes through the injected alert port; no screen owns this policy.
 * Throws on failure so the caller can mark the row failed.
 */
export async function retryImageDownload(
  entry: DownloadEntry | undefined,
  setAlertState: (s: AlertState) => void,
): Promise<void> {
  logger.log('[DownloadDebug] Image retry requested', { modelKey: entry?.modelKey, modelId: entry?.modelId, status: entry?.status });
  if (!entry) return;
  let nativeMainStatus: string | undefined;
  try {
    const activeRows = await backgroundDownloadService.getActiveDownloads();
    nativeMainStatus = activeRows.find(row => row.downloadId === entry.downloadId)?.status;
  } catch {
    // Best-effort native state check only.
  }
  const action = imageDownloadRetryAction({
    status: entry.status,
    bytesDownloaded: entry.bytesDownloaded,
    totalBytes: entry.combinedTotalBytes || entry.totalBytes,
    nativeStatus: nativeMainStatus,
    platformCanResume: false,
    syntheticTransfer: isSyntheticImageDownloadId(entry.downloadId),
  });
  if (action === 'finalize') await resumeImageFinalization(entry, setAlertState);
  else await retryIosImageDownload(entry, setAlertState);
  backgroundDownloadService.startProgressPolling();
}
