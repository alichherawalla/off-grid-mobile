/** Standalone async image download handlers. Mobile performs file/native work and sends
 * lifecycle intent to the Shared projection controller through the stable image:<id> key. */
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { showAlert } from '../utils/alertState';
import { modelLibrary, hardwareService, backgroundDownloadService } from '../services';
import { resolveCoreMLModelDir, downloadCoreMLTokenizerFiles } from '../utils/coreMLModelUtils';
import { getUserFacingDownloadMessage } from '../utils/downloadErrors';
import { ONNXImageModel } from '../types';
import {
  isActiveStatus,
  modelDownloadProjection,
  useDownloadStore,
} from '../stores/downloadStore';
import { makeImageModelKey } from '../utils/modelKey';
import { ImageModelDescriptor, ImageDownloadDeps } from './imageModelDownloadTypes';
import { getQnnWarningMessage, showQnnWarningAlert } from './imageDownloadQnn';
import { ensureImageExtractionComplete } from '../utils/imageModelIntegrity';
import logger from '../utils/logger';
import {
  downloadSequentialImageFiles,
  type ImageMultifileRuntime,
  type ImageMultifileSpec,
} from './adapters/downloads/sequentialImageFileAdapter';

// ImageDownloadDeps now lives in ./types (so imageDownloadQnn can import it without cycling back
// here). Re-exported for existing importers.
export type { ImageDownloadDeps } from './imageModelDownloadTypes';

interface ImageMetadata {
  imageDownloadType: 'zip' | 'multifile';
  imageModelName: string;
  imageModelDescription: string;
  imageModelSize: number;
  imageModelStyle?: string;
  imageModelBackend?: 'mnn' | 'qnn' | 'coreml';
  imageModelRepo?: string;
  imageModelAttentionVariant?: string;
  imageModelDownloadUrl?: string;
  imageModelHuggingFaceFiles?: { path: string; size: number }[];
  imageModelCoremlFiles?: { path: string; relativePath: string; size: number; downloadUrl: string }[];
}

const activeMultifileDownloads = new Map<string, ImageMultifileRuntime>();
const USER_CANCELLED_ERROR = 'user_cancelled';

/** Build a synthetic downloadId for multi-file flows that don't go through WorkManager. */
function makeMultifileId(modelId: string): string {
  return `image-multi:${modelId}`;
}

function startMultifileRuntime(modelId: string): ImageMultifileRuntime {
  const runtime: ImageMultifileRuntime = { controller: new AbortController() };
  activeMultifileDownloads.set(modelId, runtime);
  return runtime;
}

function clearMultifileRuntime(modelId: string) {
  activeMultifileDownloads.delete(modelId);
}

function isCancelledError(error: unknown): boolean {
  // Local assertNotCancelled sentinel OR the cross-service `.cancelled` convention
  // backgroundDownloadService raises for a user-cancelled active/queued download.
  if (!(error instanceof Error)) return false;
  return error.message === USER_CANCELLED_ERROR
    || (error as Error & { cancelled?: boolean }).cancelled === true;
}

function assertNotCancelled(modelId: string, runtime: ImageMultifileRuntime) {
  const stillVisible = !!useDownloadStore.getState().downloads[makeImageModelKey(modelId)];
  if (runtime.controller.signal.aborted || !stillVisible) {
    if (!runtime.controller.signal.aborted) runtime.controller.abort();
    throw new Error(USER_CANCELLED_ERROR);
  }
}

export async function cancelSyntheticImageDownload(modelId: string): Promise<void> {
  const runtime = activeMultifileDownloads.get(modelId);
  if (!runtime) return;
  runtime.controller.abort();
  // Drop a part still waiting for a slot NOW — it has no native downloadId yet, so
  // cancelDownload can't reach it (else it promotes, briefly starts, then cancels).
  // The queue key is the part's modelId param, == makeImageModelKey(modelId).
  backgroundDownloadService.cancelQueued(makeImageModelKey(modelId));
  if (runtime.currentDownloadId) {
    await backgroundDownloadService.cancelDownload(runtime.currentDownloadId).catch(() => {});
  }
}

async function ensureDirectory(path: string): Promise<void> {
  if (!(await RNFS.exists(path))) await RNFS.mkdir(path);
}

async function cleanupImageModelDir(modelId: string): Promise<void> {
  try {
    const dir = `${modelLibrary.getImageModelsDirectory()}/${modelId}`;
    if (await RNFS.exists(dir)) await RNFS.unlink(dir);
  } catch {
    /* ignore cleanup errors */
  }
}

function setMultifileFailed(syntheticId: string, deps: ImageDownloadDeps, message?: string): void {
  deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(message)));
  modelDownloadProjection.reportStatus(syntheticId, 'failed', {
    message: message || 'Multi-file download failed',
  });
}

async function downloadSequentialFiles(opts: {
  modelInfo: ImageModelDescriptor;
  runtime: ImageMultifileRuntime;
  syntheticId: string;
  modelDir: string;
  files: ImageMultifileSpec[];
}): Promise<void> {
  const { modelInfo, runtime, syntheticId, modelDir, files } = opts;
  await downloadSequentialImageFiles({
    modelId: modelInfo.id,
    runtime,
    modelDir,
    files,
    transfers: backgroundDownloadService,
    isCancelled: () =>
      !useDownloadStore.getState().downloads[makeImageModelKey(modelInfo.id)],
    onProgress: (bytes, total) =>
      modelDownloadProjection.reportProgress(syntheticId, bytes, total, Date.now()),
  });
}

/** Remove the entry from the store. Use after register-and-notify or on error. */
function removeStoreEntry(modelId: string) {
  modelDownloadProjection.remove(makeImageModelKey(modelId));
}

/** Build the registerable ONNXImageModel — one definition so the zip / on-disk /
 *  multifile branches can't drift. */
function buildImageModel(modelInfo: ImageModelDescriptor, modelPath: string): ONNXImageModel {
  return {
    id: modelInfo.id, name: modelInfo.name, description: modelInfo.description,
    modelPath, downloadedAt: new Date().toISOString(), size: modelInfo.size,
    style: modelInfo.style, backend: modelInfo.backend, attentionVariant: modelInfo.attentionVariant,
  };
}

/** Register a downloaded image model, activate if first, then cleanup + alert. */
export async function registerAndNotify(
  deps: ImageDownloadDeps,
  opts: { imageModel: ONNXImageModel; modelName: string },
) {
  const { imageModel, modelName } = opts;
  await modelLibrary.addDownloadedImageModel(imageModel);
  deps.addDownloadedImageModel(imageModel);
  // Auto-load the first image model unless onboarding is still active (Step 13 needs
  // activeImageModelId null).
  if (!deps.activeImageModelId && deps.triedImageGen) {
    await deps.selectActiveImageModel(imageModel);
  }
  removeStoreEntry(imageModel.id);
  deps.setAlertState(showAlert('Success', `${modelName} downloaded successfully!`));
}

/** Add (or refuse-add) an image entry to the store. Returns true if a new entry was created. */
function addImageEntry(opts: {
  modelId: string;
  downloadId: string;
  fileName: string;
  totalBytes: number;
  metadata: ImageMetadata;
}): boolean {
  const { modelId, downloadId, fileName, totalBytes, metadata } = opts;
  const modelKey = makeImageModelKey(modelId);
  const existing = useDownloadStore.getState().downloads[modelKey];
  if (existing && isActiveStatus(existing.status)) return false;
  if (existing) {
    // Failed/etc. entry from a prior attempt - reuse logical record.
    modelDownloadProjection.retry(modelKey, downloadId);
    return true;
  }
  modelDownloadProjection.admit({
    modelKey,
    downloadId,
    modelId: `image:${modelId}`,
    fileName,
    quantization: '',
    modelType: 'image',
    status: 'pending',
    bytesDownloaded: 0,
    totalBytes,
    combinedTotalBytes: totalBytes,
    progress: 0,
    createdAt: Date.now(),
    metadataJson: JSON.stringify(metadata),
  });
  return true;
}

/** Wire complete + error listeners for a zip-style download. */
function wireZipListeners(
  ctx: { downloadId: string; modelId: string; deps: ImageDownloadDeps },
  onCompleteWork: () => Promise<void>,
) {
  const { downloadId, deps } = ctx;
  const unsubComplete = backgroundDownloadService.onComplete(downloadId, async () => {
    unsubComplete(); unsubError();
    try { await onCompleteWork(); } catch (e: any) {
      deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(e?.message || 'Failed to process model')));
      modelDownloadProjection.reportStatus(downloadId, 'failed', { message: e?.message || 'Failed to process model' });
    }
  });
  const unsubError = backgroundDownloadService.onError(downloadId, (ev) => {
    unsubComplete(); unsubError();
    deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(ev.reason)));
    // useDownloads at app root has already routed this to setStatus('failed').
    // Keep the entry visible so the user can retry/remove. No removeStoreEntry here.
  });
}

/** HuggingFace multi-file download. Each file goes through downloadFileTo sequentially. */
export async function downloadHuggingFaceModel(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  if (!modelInfo.huggingFaceRepo || !modelInfo.huggingFaceFiles) {
    deps.setAlertState(showAlert('Error', 'Invalid HuggingFace model configuration'));
    return;
  }
  const syntheticId = makeMultifileId(modelInfo.id);
  const created = addImageEntry({
    modelId: modelInfo.id,
    downloadId: syntheticId,
    fileName: modelInfo.id,
    totalBytes: modelInfo.size,
    metadata: {
      imageDownloadType: 'multifile',
      imageModelName: modelInfo.name,
      imageModelDescription: modelInfo.description,
      imageModelSize: modelInfo.size,
      imageModelStyle: modelInfo.style,
      imageModelBackend: modelInfo.backend,
      imageModelRepo: modelInfo.huggingFaceRepo,
      imageModelHuggingFaceFiles: modelInfo.huggingFaceFiles,
    },
  });
  if (!created) return;
  const runtime = startMultifileRuntime(modelInfo.id);
  try {
    const imageModelsDir = modelLibrary.getImageModelsDirectory();
    const modelDir = `${imageModelsDir}/${modelInfo.id}`;
    await ensureDirectory(imageModelsDir);
    await ensureDirectory(modelDir);

    const files = modelInfo.huggingFaceFiles.map((file) => ({
      relativePath: file.path,
      size: file.size,
      url: `https://huggingface.co/${modelInfo.huggingFaceRepo}/resolve/main/${file.path}`,
    }));
    await downloadSequentialFiles({ modelInfo, runtime, syntheticId, modelDir, files });
    assertNotCancelled(modelInfo.id, runtime);
    modelDownloadProjection.beginProcessing(syntheticId);
    assertNotCancelled(modelInfo.id, runtime);
    await RNFS.writeFile(`${modelDir}/_ready`, '', 'utf8').catch(() => {});
    await registerAndNotify(deps, { imageModel: buildImageModel(modelInfo, modelDir), modelName: modelInfo.name });
  } catch (error: any) {
    if (isCancelledError(error)) {
      await cleanupImageModelDir(modelInfo.id);
      return;
    }
    setMultifileFailed(syntheticId, deps, error?.message);
    await cleanupImageModelDir(modelInfo.id);
  } finally {
    clearMultifileRuntime(modelInfo.id);
  }
}

/** CoreML multi-file download (one file per blob in coremlFiles). */
export async function downloadCoreMLMultiFile(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  if (!modelInfo.coremlFiles || modelInfo.coremlFiles.length === 0) return;

  const syntheticId = makeMultifileId(modelInfo.id);
  const created = addImageEntry({
    modelId: modelInfo.id,
    downloadId: syntheticId,
    fileName: modelInfo.id,
    totalBytes: modelInfo.size,
    metadata: {
      imageDownloadType: 'multifile',
      imageModelName: modelInfo.name,
      imageModelDescription: modelInfo.description,
      imageModelSize: modelInfo.size,
      imageModelStyle: modelInfo.style,
      imageModelBackend: modelInfo.backend,
      imageModelRepo: modelInfo.repo,
      imageModelAttentionVariant: modelInfo.attentionVariant,
      imageModelCoremlFiles: modelInfo.coremlFiles,
    },
  });
  if (!created) return;
  const runtime = startMultifileRuntime(modelInfo.id);

  try {
    const imageModelsDir = modelLibrary.getImageModelsDirectory();
    const modelDir = `${imageModelsDir}/${modelInfo.id}`;
    await ensureDirectory(imageModelsDir);
    await ensureDirectory(modelDir);

    const files = modelInfo.coremlFiles.map(f => ({ relativePath: f.relativePath, size: f.size, url: f.downloadUrl }));
    await downloadSequentialFiles({ modelInfo, runtime, syntheticId, modelDir, files });
    assertNotCancelled(modelInfo.id, runtime);
    modelDownloadProjection.beginProcessing(syntheticId);
    assertNotCancelled(modelInfo.id, runtime);
    await RNFS.writeFile(`${modelDir}/_ready`, '', 'utf8').catch(() => {});
    const resolvedModelDir = await resolveCoreMLModelDir(modelDir);
    await registerAndNotify(deps, { imageModel: buildImageModel(modelInfo, resolvedModelDir), modelName: modelInfo.name });
    if (modelInfo.repo) downloadCoreMLTokenizerFiles(resolvedModelDir, modelInfo.repo).catch(() => {});
  } catch (error: any) {
    await cleanupImageModelDir(modelInfo.id);
    if (isCancelledError(error)) return;
    deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(error?.message)));
    modelDownloadProjection.reportStatus(syntheticId, 'failed', {
      message: error?.message || 'CoreML download failed',
    });
  } finally {
    clearMultifileRuntime(modelInfo.id);
  }
}

export async function proceedWithDownload(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  deps.setAlertState({ ...showAlert('Download Started', 'Keep app open while image model processes'), closeLabel: '' });
  if (modelInfo.huggingFaceRepo && modelInfo.huggingFaceFiles) {
    await downloadHuggingFaceModel(modelInfo, deps);
    return;
  }
  if (modelInfo.coremlFiles && modelInfo.coremlFiles.length > 0) {
    await downloadCoreMLMultiFile(modelInfo, deps);
    return;
  }

  // Zip flow: native WorkManager downloads; useDownloads routes progress; we wire completion.
  const fileName = `${modelInfo.id}.zip`;
  const metadata: ImageMetadata = {
    imageDownloadType: 'zip',
    imageModelName: modelInfo.name,
    imageModelDescription: modelInfo.description,
    imageModelSize: modelInfo.size,
    imageModelStyle: modelInfo.style,
    imageModelBackend: modelInfo.backend,
    imageModelAttentionVariant: modelInfo.attentionVariant,
    imageModelDownloadUrl: modelInfo.downloadUrl,
  };
  const modelKey = makeImageModelKey(modelInfo.id);
  const existing = useDownloadStore.getState().downloads[modelKey];
  if (existing && isActiveStatus(existing.status)) return;

  // Guard: if files already exist on disk, register without re-downloading.
  const imageModelsDir = modelLibrary.getImageModelsDirectory();
  const modelDir = `${imageModelsDir}/${modelInfo.id}`;
  if (await RNFS.exists(modelDir)) {
    const resolvedModelDir = modelInfo.backend === 'coreml' ? await resolveCoreMLModelDir(modelDir) : modelDir;
    logger.log(`[ImageDownload] proceedWithDownload zip - files exist on disk, registering directly modelId=${modelInfo.id}`);
    await registerAndNotify(deps, { imageModel: buildImageModel(modelInfo, resolvedModelDir), modelName: modelInfo.name });
    return;
  }

  // Publish a QUEUED row IMMEDIATELY, before awaiting the (slot-limited) native start (same
  // pattern as text) — else a queued image download has no store entry until a slot frees.
  const placeholderId = `queued:${modelKey}`; // reconciled to the real id on start
  const created = addImageEntry({
    modelId: modelInfo.id,
    downloadId: placeholderId,
    fileName,
    totalBytes: modelInfo.size,
    metadata,
  });
  if (!created) return; // an active entry already owns this key (coalesced double-tap)
  try {
    const downloadInfo = await backgroundDownloadService.startDownload({
      url: modelInfo.downloadUrl, fileName, modelId: `image:${modelInfo.id}`,
      modelKey,
      modelType: 'image',
      totalBytes: modelInfo.size,
      metadataJson: JSON.stringify(metadata),
    });
    // Reconcile the queued placeholder row to the real native downloadId so progress /
    // complete / error events (routed via downloadIdIndex) reach this entry.
    modelDownloadProjection.retry(modelKey, downloadInfo.downloadId);
    wireZipListeners({ downloadId: downloadInfo.downloadId, modelId: modelInfo.id, deps }, async () => {
      const zipPath = `${imageModelsDir}/${fileName}`;
      try {
        modelDownloadProjection.beginProcessing(downloadInfo.downloadId);
        if (!(await RNFS.exists(imageModelsDir))) await RNFS.mkdir(imageModelsDir);
        const t0 = Date.now();
        await backgroundDownloadService.moveCompletedDownload(downloadInfo.downloadId, zipPath);
        logger.log(`[ImageDownload] moveCompletedDownload took ${Date.now() - t0}ms modelId=${modelInfo.id}`);
        if (!(await RNFS.exists(modelDir))) await RNFS.mkdir(modelDir);
        await RNFS.writeFile(`${modelDir}/_zip_name`, fileName, 'utf8').catch(() => {});
        const t1 = Date.now();
        await unzip(zipPath, modelDir);
        logger.log(`[ImageDownload] unzip took ${Date.now() - t1}ms modelId=${modelInfo.id}`);
        // A partial unzip must NEVER be marked _ready (see ensureImageExtractionComplete).
        await ensureImageExtractionComplete({ backend: modelInfo.backend, modelDir, zipPath, modelId: modelInfo.id });
        const resolvedModelDir = modelInfo.backend === 'coreml' ? await resolveCoreMLModelDir(modelDir) : modelDir;
        await RNFS.writeFile(`${modelDir}/_ready`, '', 'utf8').catch(() => {});
        await RNFS.unlink(zipPath).catch(() => {});
        await registerAndNotify(deps, { imageModel: buildImageModel(modelInfo, resolvedModelDir), modelName: modelInfo.name });
      } catch (e) {
        await RNFS.unlink(zipPath).catch(() => {});
        await RNFS.unlink(modelDir).catch(() => {});
        throw e;
      }
    });
    backgroundDownloadService.startProgressPolling();
  } catch (error: any) {
    // Cancelled while still queued (no slot) rejects with `.cancelled` — a user
    // cancellation, not a failure: drop the placeholder row quietly.
    if (isCancelledError(error)) {
      removeStoreEntry(modelInfo.id);
      return;
    }
    // Native start failed: fail the placeholder row so the card/Manager offer retry.
    modelDownloadProjection.reportStatus(placeholderId, 'failed', { message: error?.message || 'Download failed' });
    deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(error?.message)));
  }
}

export async function handleDownloadImageModel(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  if (modelInfo.backend === 'qnn' && Platform.OS === 'android') {
    const socInfo = await hardwareService.getSoCInfo();
    const warningMessage = getQnnWarningMessage(modelInfo, socInfo);
    if (warningMessage) {
      showQnnWarningAlert({
        warningMessage,
        hasNPU: socInfo.hasNPU,
        modelInfo,
        onDownloadAnyway: () => {
          proceedWithDownload(modelInfo, deps).catch(() => {});
        },
      }, deps);
      return;
    }
  }
  await proceedWithDownload(modelInfo, deps);
}
