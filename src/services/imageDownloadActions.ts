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
import { ImageModelDescriptor, ImageDownloadDeps } from './imageModelDownloadTypes';
import { getQnnWarningMessage, showQnnWarningAlert } from './imageDownloadQnn';
import { ensureImageExtractionComplete } from '../utils/imageModelIntegrity';
import logger from '../utils/logger';
import {
  downloadSequentialImageFiles,
  type ImageMultifileSpec,
} from './adapters/downloads/sequentialImageFileAdapter';
import {
  shouldActivateFirstImageModel,
  type DownloadOperationOwner,
  type ImageDownloadPlan,
} from '@offgrid/models';
import {
  attachImageTransfer,
  beginImageDownload,
  beginImageDownloadProcessing,
  cancelOwnedImageDownload,
  completeImageDownload,
  failImageDownload,
  isActiveImageDownload,
  mobileImageDownloadPlan,
  removeImageDownloadRecord,
  reportImageDownloadProgress,
} from './adapters/downloads/imageDownloadWorkflowAdapter';

// ImageDownloadDeps now lives in ./types (so imageDownloadQnn can import it without cycling back
// here). Re-exported for existing importers.
export type { ImageDownloadDeps } from './imageModelDownloadTypes';

const USER_CANCELLED_ERROR = 'user_cancelled';

function isCancelledError(error: unknown): boolean {
  // Local assertNotCancelled sentinel OR the cross-service `.cancelled` convention
  // backgroundDownloadService raises for a user-cancelled active/queued download.
  if (!(error instanceof Error)) return false;
  return error.message === USER_CANCELLED_ERROR
    || (error as Error & { cancelled?: boolean }).cancelled === true;
}

function assertNotCancelled(owner: DownloadOperationOwner) {
  if (owner.signal.aborted || !isActiveImageDownload(owner)) throw new Error(USER_CANCELLED_ERROR);
}

export async function cancelSyntheticImageDownload(modelId: string): Promise<void> {
  await cancelOwnedImageDownload(modelId, backgroundDownloadService);
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

function setMultifileFailed(owner: DownloadOperationOwner, deps: ImageDownloadDeps, message?: string): void {
  deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(message)));
  failImageDownload(owner, message || 'Multi-file download failed');
}

async function downloadSequentialFiles(opts: {
  modelInfo: ImageModelDescriptor;
  owner: DownloadOperationOwner;
  modelDir: string;
  files: ImageMultifileSpec[];
}): Promise<void> {
  const { modelInfo, owner, modelDir, files } = opts;
  await downloadSequentialImageFiles({
    modelId: modelInfo.id,
    signal: owner.signal,
    modelDir,
    files,
    transfers: backgroundDownloadService,
    isCancelled: () => owner.signal.aborted || !isActiveImageDownload(owner),
    onTransferStarted: id => attachImageTransfer(
      owner, id, downloadId => backgroundDownloadService.cancelDownload(downloadId),
    ),
    onProgress: (bytes, total) =>
      reportImageDownloadProgress(owner, bytes, total),
  });
}

/** Remove the entry from the store. Use after register-and-notify or on error. */
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
  opts: { imageModel: ONNXImageModel; modelName: string; owner?: DownloadOperationOwner },
) {
  const { imageModel, modelName } = opts;
  await modelLibrary.addDownloadedImageModel(imageModel);
  deps.addDownloadedImageModel(imageModel);
  // Auto-load the first image model unless onboarding is still active (Step 13 needs
  // activeImageModelId null).
  if (shouldActivateFirstImageModel({
    hasActiveModel: Boolean(deps.activeImageModelId),
    imageOnboardingComplete: deps.triedImageGen,
  })) {
    await deps.selectActiveImageModel(imageModel);
  }
  if (opts.owner) completeImageDownload(opts.owner);
  else removeImageDownloadRecord(imageModel.id);
  deps.setAlertState(showAlert('Success', `${modelName} downloaded successfully!`));
}

/** Wire complete + error listeners for a zip-style download. */
function wireZipListeners(
  ctx: { downloadId: string; modelId: string; deps: ImageDownloadDeps; owner: DownloadOperationOwner },
  onCompleteWork: () => Promise<void>,
) {
  const { downloadId, deps, owner } = ctx;
  const unsubComplete = backgroundDownloadService.onComplete(downloadId, async () => {
    unsubComplete(); unsubError();
    try { await onCompleteWork(); } catch (e: any) {
      deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(e?.message || 'Failed to process model')));
      failImageDownload(owner, e?.message || 'Failed to process model');
    }
  });
  const unsubError = backgroundDownloadService.onError(downloadId, (ev) => {
    unsubComplete(); unsubError();
    deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(ev.reason)));
    failImageDownload(owner, ev.reason || 'Download failed');
  });
}

/** HuggingFace multi-file download. Each file goes through downloadFileTo sequentially. */
export async function downloadHuggingFaceModel(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
  suppliedPlan?: ImageDownloadPlan,
): Promise<void> {
  if (!modelInfo.huggingFaceRepo || !modelInfo.huggingFaceFiles) {
    deps.setAlertState(showAlert('Error', 'Invalid HuggingFace model configuration'));
    return;
  }
  const plan = suppliedPlan ?? mobileImageDownloadPlan(modelInfo);
  const owner = beginImageDownload(plan);
  if (!owner) return;
  try {
    const imageModelsDir = modelLibrary.getImageModelsDirectory();
    const modelDir = `${imageModelsDir}/${modelInfo.id}`;
    await ensureDirectory(imageModelsDir);
    await ensureDirectory(modelDir);

    await downloadSequentialFiles({ modelInfo, owner, modelDir, files: [...plan.artifacts] });
    assertNotCancelled(owner);
    beginImageDownloadProcessing(owner);
    assertNotCancelled(owner);
    await RNFS.writeFile(`${modelDir}/_ready`, '', 'utf8').catch(() => {});
    await registerAndNotify(deps, {
      imageModel: buildImageModel(modelInfo, modelDir), modelName: modelInfo.name, owner,
    });
  } catch (error: any) {
    if (isCancelledError(error)) {
      await cleanupImageModelDir(modelInfo.id);
      return;
    }
    setMultifileFailed(owner, deps, error?.message);
    await cleanupImageModelDir(modelInfo.id);
  }
}

/** CoreML multi-file download (one file per blob in coremlFiles). */
export async function downloadCoreMLMultiFile(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
  suppliedPlan?: ImageDownloadPlan,
): Promise<void> {
  if (!modelInfo.coremlFiles || modelInfo.coremlFiles.length === 0) return;

  const plan = suppliedPlan ?? mobileImageDownloadPlan(modelInfo);
  const owner = beginImageDownload(plan);
  if (!owner) return;

  try {
    const imageModelsDir = modelLibrary.getImageModelsDirectory();
    const modelDir = `${imageModelsDir}/${modelInfo.id}`;
    await ensureDirectory(imageModelsDir);
    await ensureDirectory(modelDir);

    await downloadSequentialFiles({ modelInfo, owner, modelDir, files: [...plan.artifacts] });
    assertNotCancelled(owner);
    beginImageDownloadProcessing(owner);
    assertNotCancelled(owner);
    await RNFS.writeFile(`${modelDir}/_ready`, '', 'utf8').catch(() => {});
    const resolvedModelDir = await resolveCoreMLModelDir(modelDir);
    await registerAndNotify(deps, {
      imageModel: buildImageModel(modelInfo, resolvedModelDir), modelName: modelInfo.name, owner,
    });
    if (modelInfo.repo) downloadCoreMLTokenizerFiles(resolvedModelDir, modelInfo.repo).catch(() => {});
  } catch (error: any) {
    await cleanupImageModelDir(modelInfo.id);
    if (isCancelledError(error)) return;
    deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(error?.message)));
    failImageDownload(owner, error?.message || 'CoreML download failed');
  }
}

export async function proceedWithDownload(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  deps.setAlertState({ ...showAlert('Download Started', 'Keep app open while image model processes'), closeLabel: '' });
  const plan = mobileImageDownloadPlan(modelInfo);
  if (plan.kind === 'huggingface') {
    await downloadHuggingFaceModel(modelInfo, deps, plan);
    return;
  }
  if (plan.kind === 'coreml') {
    await downloadCoreMLMultiFile(modelInfo, deps, plan);
    return;
  }

  // Zip flow: native WorkManager downloads; useDownloads routes progress; we wire completion.
  const fileName = plan.fileName;
  const modelKey = plan.modelKey;

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
  const owner = beginImageDownload(plan);
  if (!owner) return;
  try {
    const downloadInfo = await backgroundDownloadService.startDownload({
      url: modelInfo.downloadUrl, fileName, modelId: `image:${modelInfo.id}`,
      modelKey,
      modelType: 'image',
      totalBytes: modelInfo.size,
      metadataJson: plan.metadataJson,
    });
    // Reconcile the queued placeholder row to the real native downloadId so progress /
    // complete / error events (routed via downloadIdIndex) reach this entry.
    attachImageTransfer(
      owner,
      downloadInfo.downloadId,
      downloadId => backgroundDownloadService.cancelDownload(downloadId),
    );
    wireZipListeners({ downloadId: downloadInfo.downloadId, modelId: modelInfo.id, deps, owner }, async () => {
      const zipPath = `${imageModelsDir}/${fileName}`;
      try {
        beginImageDownloadProcessing(owner);
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
        await registerAndNotify(deps, {
          imageModel: buildImageModel(modelInfo, resolvedModelDir), modelName: modelInfo.name, owner,
        });
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
      completeImageDownload(owner);
      return;
    }
    // Native start failed: fail the placeholder row so the card/Manager offer retry.
    failImageDownload(owner, error?.message || 'Download failed');
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
