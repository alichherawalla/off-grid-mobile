import RNFS from 'react-native-fs';
import { statFile } from '../utils/fileStat';
import { unzip } from 'react-native-zip-archive';
import { modelLibrary } from './modelServices/bootstrap/modelLibraryBootstrap';
import { coordinatedDownloads as backgroundDownloadService } from './modelServices/coordinatedDownloadBridge';
import { resolveCoreMLModelDir } from '../utils/coreMLModelUtils';
import { ONNXImageModel } from '../types';
import {
  DownloadEntry,
} from '../stores/downloadStore';
import { ImageDownloadDeps, registerAndNotify, proceedWithDownload } from './imageDownloadActions';
import { imageDescriptorFromMetadata } from './imageDescriptor';
import { validateImageModelDir, ensureImageExtractionComplete } from '../utils/imageModelIntegrity';
import logger from '../utils/logger';
import {
  imageDownloadRecoveryAction,
  isImageArchiveReady,
  parseImageDownloadMetadata,
  type ImageDownloadMetadata,
} from '@offgrid/models';
import {
  failImageDownloadRecord,
  removeImageDownloadRecord,
} from './adapters/downloads/imageDownloadWorkflowAdapter';

type ResumeCtx = { entry: DownloadEntry; modelId: string; metadata: ImageDownloadMetadata; deps: ImageDownloadDeps };

function getExpectedZipBytes(entry: DownloadEntry): number {
  return entry.totalBytes || entry.combinedTotalBytes || 0;
}

async function validateModelDir(modelDir: string, backend?: string): Promise<boolean> {
  if (!(await RNFS.exists(modelDir))) return false;
  try {
    const dirItems = await RNFS.readDir(modelDir);
    if (dirItems.length === 0) {
      return false;
    }
    // For mnn/qnn, "has files" is not enough — a partial extraction (missing pos_emb.bin
    // / a *.mnn.weight) must count as INVALID so resume cleans it up and re-extracts,
    // rather than registering a broken model that crashes at generation time.
    if (backend === 'mnn' || backend === 'qnn') {
      const { complete } = await validateImageModelDir(modelDir, backend);
      return complete;
    }
    return true;
  } catch {
    return false;
  }
}

async function validateZipArtifact(zipPath: string, expectedBytes: number): Promise<boolean> {
  const exists = await RNFS.exists(zipPath);
  if (!exists) return false;

  const actualSize = (await statFile(zipPath))?.size ?? 0;
  let header: string | undefined;
  try {
    header = await RNFS.read(zipPath, 4, 0, 'ascii');
  } catch {
    // RNFS.read() can be flaky on some bridges. Size validation is the stronger
    // signal here, so treat header-read failure as inconclusive rather than fatal.
  }
  return isImageArchiveReady({ exists, actualBytes: actualSize, expectedBytes, header });
}

async function cleanupInvalidArtifact(path: string): Promise<void> {
  try {
    await RNFS.unlink(path);
  } catch {
    // Best-effort cleanup only.
  }
}

/** The completed bytes are unrecoverable — the native staging was purged (iOS temp reaping on builds
 *  before durable staging, or the user cleared storage) and neither a valid zip nor an extracted dir
 *  survives on disk. There is nothing to finalize, so re-download from scratch through the normal
 *  flow (which reuses the existing failed store row via retryEntry) instead of dead-ending on the same
 *  "no such file" on every retry. Reconstructs the zip descriptor from the entry's persisted metadata. */
async function reDownloadFromMetadata(ctx: ResumeCtx): Promise<void> {
  const { modelId, metadata, deps } = ctx;
  if (!metadata.imageModelDownloadUrl) {
    // No URL to re-fetch from. Surface a clear, honest failure rather than a stale native error.
    failImageDownloadRecord(
      ctx.entry.downloadId,
      'Download could not be re-downloaded. Remove it and download again.',
    );
    return;
  }
  logger.log(`[ImageDownload] resumeImageDownload zip - staged bytes gone, re-downloading ${modelId}`);
  await proceedWithDownload(imageDescriptorFromMetadata(modelId, metadata), deps);
}

async function resumeZipDownload(ctx: ResumeCtx): Promise<void> {
  const { entry, modelId, metadata, deps } = ctx;
  const imageModelsDir = modelLibrary.getImageModelsDirectory();
  const modelDir = `${imageModelsDir}/${modelId}`;
  const zipPath = `${imageModelsDir}/${entry.fileName}`;
  const isCoreml = metadata.imageModelBackend === 'coreml';
  const expectedZipBytes = getExpectedZipBytes(entry);

  const buildModel = async (dir: string): Promise<ONNXImageModel> => {
    const resolvedDir = isCoreml ? await resolveCoreMLModelDir(dir) : dir;
    return {
      id: modelId, name: metadata.imageModelName, description: metadata.imageModelDescription,
      modelPath: resolvedDir, downloadedAt: new Date().toISOString(),
      size: metadata.imageModelSize, style: metadata.imageModelStyle,
      backend: metadata.imageModelBackend, attentionVariant: metadata.imageModelAttentionVariant,
    };
  };

  const extractAndRegister = async (): Promise<void> => {
    if (!(await RNFS.exists(modelDir))) await RNFS.mkdir(modelDir);
    await RNFS.writeFile(`${modelDir}/_zip_name`, entry.fileName, 'utf8').catch(() => {});
    try {
      await unzip(zipPath, modelDir);
      await ensureImageExtractionComplete({ backend: metadata.imageModelBackend, modelDir, zipPath, modelId });
    } catch (error) {
      await RNFS.unlink(modelDir).catch(() => {});
      throw error;
    }
    await RNFS.writeFile(`${modelDir}/_ready`, '', 'utf8').catch(() => {});
    await RNFS.unlink(zipPath).catch(() => {});
    await registerAndNotify(deps, { imageModel: await buildModel(modelDir), modelName: metadata.imageModelName });
  };

  const modelDirExists = await RNFS.exists(modelDir);
  const zipExists = await RNFS.exists(zipPath);
  const modelDirValid = await validateModelDir(modelDir, metadata.imageModelBackend);
  const zipValid = await validateZipArtifact(zipPath, expectedZipBytes);

  if (modelDirExists && !modelDirValid) {
    await cleanupInvalidArtifact(modelDir);
  }
  if (zipExists && !zipValid) {
    await cleanupInvalidArtifact(zipPath);
  }

  const existingModels = modelDirValid ? await modelLibrary.getDownloadedImageModels() : [];
  const initialAction = imageDownloadRecoveryAction({
    kind: 'zip',
    modelDirectoryValid: modelDirValid,
    archiveValid: zipValid,
    alreadyRegistered: existingModels.some(m => m.id === modelId),
    canRestart: Boolean(metadata.imageModelDownloadUrl),
  });

  if (initialAction === 'remove-stale') {
    logger.log(`[ImageDownload] resumeImageDownload zip - already registered, removing stale entry ${modelId}`);
    removeImageDownloadRecord(modelId);
    return;
  }
  if (initialAction === 'register-directory') {
    logger.log(`[ImageDownload] resumeImageDownload zip - model dir exists, registering ${modelId}`);
    await registerAndNotify(deps, { imageModel: await buildModel(modelDir), modelName: metadata.imageModelName });
    return;
  }
  if (initialAction === 'extract-archive') {
    logger.log(`[ImageDownload] resumeImageDownload zip - zip found, unzipping ${modelId}`);
    await extractAndRegister();
    return;
  }

  if (!(await RNFS.exists(imageModelsDir))) await RNFS.mkdir(imageModelsDir);
  try {
    await backgroundDownloadService.moveCompletedDownload(entry.downloadId, zipPath);
  } catch (error: any) {
    const recoveredModelDirValid = await validateModelDir(modelDir, metadata.imageModelBackend);
    const recoveredZipValid = await validateZipArtifact(zipPath, expectedZipBytes);
    const recoveryAction = imageDownloadRecoveryAction({
      kind: 'zip',
      modelDirectoryValid: recoveredModelDirValid,
      archiveValid: recoveredZipValid,
      nativeMoveFailed: true,
      canRestart: Boolean(metadata.imageModelDownloadUrl),
    });
    if (recoveryAction === 'register-directory') {
      await registerAndNotify(deps, { imageModel: await buildModel(modelDir), modelName: metadata.imageModelName });
      return;
    }
    if (recoveryAction === 'restart-transfer') {
      logger.warn(`[ImageDownload] resumeImageDownload zip - completed bytes unrecoverable (${error?.message || error}) — re-downloading ${modelId}`);
      await reDownloadFromMetadata(ctx);
      return;
    }
    if (recoveryAction === 'fail-missing-files') throw error;
  }
  logger.log(`[ImageDownload] resumeImageDownload zip - moved from WorkManager, unzipping ${modelId}`);
  await extractAndRegister();
}

async function resumeMultifileDownload(ctx: ResumeCtx): Promise<void> {
  const { entry, modelId, metadata, deps } = ctx;
  const modelDir = `${modelLibrary.getImageModelsDirectory()}/${modelId}`;
  const modelDirExists = await RNFS.exists(modelDir);
  const action = imageDownloadRecoveryAction({
    kind: 'multifile', modelDirectoryValid: modelDirExists, archiveValid: false,
  });
  if (action === 'fail-missing-files') {
    logger.warn(`[ImageDownload] resumeImageDownload multifile - model dir missing, marking failed ${modelId}`);
    failImageDownloadRecord(entry.downloadId, 'Download files missing. Please retry.');
    return;
  }
  const imageModel: ONNXImageModel = {
    id: modelId, name: metadata.imageModelName, description: metadata.imageModelDescription,
    modelPath: modelDir, downloadedAt: new Date().toISOString(),
    size: metadata.imageModelSize, style: metadata.imageModelStyle,
    backend: metadata.imageModelBackend,
  };
  logger.log(`[ImageDownload] resumeImageDownload multifile - registering ${modelId}`);
  await registerAndNotify(deps, { imageModel, modelName: metadata.imageModelName });
}

export async function resumeImageDownload(entry: DownloadEntry, deps: ImageDownloadDeps): Promise<void> {
  const modelId = entry.modelId.replace('image:', '');
  logger.log(`[ImageDownload] resumeImageDownload modelId=${modelId} downloadId=${entry.downloadId}`);

  const metadata = parseImageDownloadMetadata(entry.metadataJson);

  if (!metadata?.imageDownloadType) {
    logger.warn(`[ImageDownload] resumeImageDownload no metadata for ${modelId} - marking failed`);
    failImageDownloadRecord(entry.downloadId, 'Could not resume: missing download metadata');
    return;
  }

  try {
    if (metadata.imageDownloadType === 'zip') {
      await resumeZipDownload({ entry, modelId, metadata, deps });
    } else if (metadata.imageDownloadType === 'multifile') {
      await resumeMultifileDownload({ entry, modelId, metadata, deps });
    }
  } catch (error: any) {
    logger.error(`[ImageDownload] resumeImageDownload failed for ${modelId}`, error?.message);
    failImageDownloadRecord(entry.downloadId, error?.message || 'Could not resume download after restart');
  }
}
