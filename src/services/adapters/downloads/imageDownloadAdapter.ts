/**
 * Image (ONNX/CoreML) download provider. list/remove/reconcile are service-level.
 *
 * The provider owns retry and cancellation decisions. The UI supplies only an alert
 * sink, which is a presentation port. Native transfer and filesystem work stay in
 * Mobile adapters.
 *
 * resumable: zip on Android only; multi-file (synthetic `image-multi:` id, no native
 * row) is never resumable → reconcile strands stranded in-flight as retriable error.
 */
import { Platform } from 'react-native';
import { coordinatedDownloads as backgroundDownloadService } from '../../modelServices/coordinatedDownloadBridge';
import { useAppStore } from '../../../stores';
import { activeLocalModelId } from '../../modelServices/activeRoute';
import { useDownloadStore, isActiveStatus, DownloadEntry } from '../../../stores/downloadStore';
import logger from '../../../utils/logger';
import {
  imageDownloadRetryAction,
  isSyntheticImageDownloadId,
  downloadRetryPolicy,
  mapDownloadStoreStatus,
  uniformDownloadId,
} from '@offgrid/models';
import { startImageModelDownload } from '../../imageModelDownloadOwner';
import { mobileRouteId } from '../../modelServices/mobileRoute';
import { selectMobileRoute } from '../../modelServices/mobileLLMService';
import type { DownloadProvider, ModelDownload } from '../../modelServices/downloadTypes';
import { cancelOwnedImageDownload } from './imageDownloadWorkflowAdapter';
import { retryImageDownload } from '../../imageDownloadRetry';
import type { AlertState } from '../../../utils/alertState';
import { removeMobileLibraryModel } from '../../modelServices/modelLibraryCommands';

/** Presentation port only. The owning provider keeps all control-flow decisions. */
export type ImageDownloadAlertSink = (state: AlertState) => void;
let imageAlertSink: ImageDownloadAlertSink = () => undefined;
export function setImageDownloadAlertSink(sink?: ImageDownloadAlertSink): void {
  imageAlertSink = sink ?? (() => undefined);
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const bareId = (storeModelId: string): string => storeModelId.replace(/^image:/, '');
const modelIdOf = (id: string): string => id.replace(/^image:/, '');
const isMultifile = (e: DownloadEntry): boolean => isSyntheticImageDownloadId(e.downloadId);
const imageEntries = (): DownloadEntry[] =>
  Object.values(useDownloadStore.getState().downloads).filter(e => e.modelType === 'image');
const findEntry = (modelId: string): DownloadEntry | undefined =>
  imageEntries().find(e => bareId(e.modelId) === modelId);

export const imageProvider: DownloadProvider = {
  modelType: 'image',

  async start(request): Promise<void> {
    if (request.modelType !== 'image') throw new Error('Invalid image download request');
    const app = useAppStore.getState();
    await startImageModelDownload(request.model, {
      addDownloadedImageModel: app.addDownloadedImageModel,
      activeImageModelId: activeLocalModelId('image'),
      selectActiveImageModel: model => selectMobileRoute(
        'image',
        mobileRouteId({
          source: 'local',
          hostId: model.backend ?? 'image-runtime',
          modality: 'image',
          modelId: model.id,
        }),
      ),
      setAlertState: () => undefined,
      triedImageGen: app.onboardingChecklist.triedImageGen,
    });
  },

  async list(): Promise<ModelDownload[]> {
    const out: ModelDownload[] = [];
    // Retry is structurally available for image on BOTH platforms (Android resumes
    // the native row here; iOS re-runs the injected re-download/finalization), so the
    // flag is a STABLE constant — it must not depend on imageOps, which are injected
    // by a component effect after the first list (that flip made the affordance flap
    // from dead→live). Matches textProvider's unconditional retry: true.
    for (const e of imageEntries()) {
      const id = bareId(e.modelId);
      // multi-file (no native row) is never resumable; zip resumes on Android.
      const resumable = !isMultifile(e) && Platform.OS === 'android';
      out.push({
        id: uniformDownloadId('image', e.modelId), modelType: 'image', name: e.fileName || id,
        sizeBytes: e.combinedTotalBytes || e.totalBytes, bytesDownloaded: e.bytesDownloaded,
        progress: e.progress, status: mapDownloadStoreStatus(e.status),
        capabilities: { cancel: true, retry: true, remove: true, resumable, determinateProgress: true },
        error: e.errorMessage,
      });
    }
    const inflight = new Set(out.map(d => d.id));
    for (const m of useAppStore.getState().downloadedImageModels) {
      const id = uniformDownloadId('image', m.id);
      if (inflight.has(id)) continue;
      out.push({
        id, modelType: 'image', name: m.name, sizeBytes: m.size, bytesDownloaded: m.size,
        progress: 1, status: 'completed',
        capabilities: { cancel: true, retry: true, remove: true, resumable: false, determinateProgress: true },
        filePath: m.modelPath,
      });
    }
    return out;
  },

  async cancel(id: string): Promise<void> {
    const modelId = modelIdOf(id);
    const entry = findEntry(modelId);
    if (!entry) return;
    if (await cancelOwnedImageDownload(modelId)) return;
    useDownloadStore.getState().remove(entry.modelKey);
    if (isMultifile(entry)) {
      const rows = await backgroundDownloadService.getActiveDownloads().catch(() => []);
      await Promise.all(rows
        .filter(row => row.modelId === `image:${modelId}`)
        .map(row => backgroundDownloadService.cancelDownload(row.downloadId).catch(() => {})));
      return;
    }
    await backgroundDownloadService.cancelDownload(entry.downloadId)
      .catch(err => logger.log(`[DL-SM] image:${modelId} cancel: native cancel failed err=${msg(err)}`));
  },

  async retry(id: string): Promise<void> {
    const modelId = modelIdOf(id);
    const entry = findEntry(modelId);
    if (!entry) return;
    // A zip interrupted MID-TRANSFER resumes natively (UI-free, do it here). But an image whose bytes
    // FINISHED and then failed EXTRACTION (ImageModelIncompleteError — missing unet.bin/clip.weight),
    // or a multi-file download (synthetic `image-multi:` row), has NO live native row to resume:
    // retryDownload throws "Download not found" on EVERY tap (device-confirmed, B6). In those cases
    // fall back to the service recovery path (cancels the stale row, fetches fresh).
    const action = imageDownloadRetryAction({
      status: entry.status,
      bytesDownloaded: entry.bytesDownloaded,
      totalBytes: entry.combinedTotalBytes || entry.totalBytes,
      platformCanResume: Platform.OS === 'android',
      syntheticTransfer: isMultifile(entry),
    });
    if (action === 'resume-native') {
      try {
        useDownloadStore.getState().setStatus(entry.downloadId, 'queued');
        await backgroundDownloadService.retryDownload(entry.downloadId);
        backgroundDownloadService.startProgressPolling();
        return;
      } catch (e) {
        // Native row gone (bytes completed, extraction failed) → re-download from scratch below.
        logger.log(`[DL-SM] image:${modelId} native resume failed (${msg(e)}) — re-downloading from scratch`);
      }
    }
    await retryImageDownload(entry, imageAlertSink);
  },

  async remove(id: string): Promise<void> {
    await removeMobileLibraryModel('image', modelIdOf(id));
  },

  subscribe(onChange: () => void): () => void {
    return useDownloadStore.subscribe(onChange);
  },

  async reconcile(): Promise<void> {
    // Multi-file has no native row (never resumes); iOS zip foreground dies too.
    const store = useDownloadStore.getState();
    for (const e of imageEntries()) {
      if (!isActiveStatus(e.status)) continue;
      const policy = downloadRetryPolicy({
        platformCanResume: Platform.OS === 'android',
        syntheticTransfer: isMultifile(e),
        hasNativeTransfer: Boolean(e.downloadId),
        status: e.status,
      });
      if (policy.relaunch === 'retain-native') continue;
      logger.log(`[DL-SM] image:${bareId(e.modelId)} reconcile: interrupted (multifile/iOS) → failed`);
      store.setStatus(e.downloadId, 'failed', { message: 'Interrupted — app closed. Tap retry.' });
    }
  },
};
