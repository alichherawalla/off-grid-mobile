import RNFS from 'react-native-fs';
import logger from '../utils/logger';
import { modelDownloadProjection } from '../stores/downloadStore';
import { makeModelKey } from '../utils/modelKey';
import { coordinatedDownloads as backgroundDownloadService } from './modelServices/coordinatedDownloadBridge';
import * as whisperModelFiles from './whisperModelFiles';
import { WHISPER_MODELS } from '@offgrid/models';
import {
  DownloadOperationRegistry,
  type DownloadOperationOwner,
} from '@offgrid/models';

export interface DownloadedWhisperModel {
  modelId: string;
  fileName: string;
  sizeBytes: number;
  filePath: string;
}

interface MissingModelDownloadInput {
  model: (typeof WHISPER_MODELS)[number];
  fileName: string;
  destPath: string;
  owner: DownloadOperationOwner;
  onProgress?: (progress: number) => void;
}

/** Owns Whisper download queue identity and native-download cleanup. */
export class WhisperDownloadAdapter {
  private readonly operations = new DownloadOperationRegistry();

  private async unlinkOwnedFile(
    modelId: string,
    owner: DownloadOperationOwner,
    path: string,
  ): Promise<void> {
    if (!this.operations.isCurrent(owner)) return;
    await RNFS.unlink(path);
  }

  async downloadModel(
    modelId: string,
    onProgress?: (progress: number) => void,
  ): Promise<string> {
    const model = WHISPER_MODELS.find(candidate => candidate.id === modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    const fileName = `ggml-${modelId}.bin`;
    const modelKey = makeModelKey(`whisper-${modelId}`, fileName);
    const owner = this.operations.begin(modelId, modelKey);
    // Ownership exists before the first asynchronous boundary. A delete that
    // arrives during directory or file checks still waits for this exact start.
    try {
      await whisperModelFiles.ensureModelsDirExists();
      const destPath = whisperModelFiles.getModelPath(modelId);
      if (await RNFS.exists(destPath)) return destPath;
      if (owner.cancelRequested) {
        const cancelled = new Error('Download cancelled') as Error & {
          cancelled?: boolean;
        };
        cancelled.cancelled = true;
        throw cancelled;
      }

      return await this.downloadMissingModel({
        model,
        fileName,
        destPath,
        owner,
        onProgress,
      });
    } finally {
      if (this.operations.finish(owner) && owner.published) {
        modelDownloadProjection.remove(owner.modelKey);
      }
    }
  }

  private async downloadMissingModel({
    model,
    fileName,
    destPath,
    owner,
    onProgress,
  }: MissingModelDownloadInput): Promise<string> {
    const modelId = model.id;

    logger.log(
      `[Whisper] Downloading ${model.name} via background download service...`,
    );
    const totalBytes = model.size * 1024 * 1024;
    const { modelKey } = owner;
    const queuedId = `queued:${modelKey}`;

    // Publish the queue entry before a native concurrency slot opens. All model
    // types then use the same canonical progress store and cancellation identity.
    this.operations.markPublished(owner);
    modelDownloadProjection.admit({
      modelKey,
      downloadId: queuedId,
      modelId: `whisper-${modelId}`,
      fileName,
      quantization: '',
      modelType: 'stt',
      status: 'pending',
      bytesDownloaded: 0,
      totalBytes,
      combinedTotalBytes: totalBytes,
      progress: 0,
      createdAt: Date.now(),
    });

    const { downloadIdPromise, promise } =
      backgroundDownloadService.downloadFileTo({
        params: {
          url: model.url,
          fileName,
          modelId: `whisper-${modelId}`,
          modelKey,
          modelType: 'stt',
          totalBytes,
          // Catalog sizes are rounded MB values, not byte-exact checksums.
          metadataJson: JSON.stringify({ skipSizeValidation: true }),
        },
        destPath,
        onProgress: onProgress
          ? (bytesDownloaded, total) => {
              onProgress(total > 0 ? bytesDownloaded / total : 0);
            }
          : undefined,
        silent: true,
      });
    downloadIdPromise.then(
      downloadId => {
        this.operations.attachTransfer(
          owner,
          downloadId,
          id => backgroundDownloadService.cancelDownload(id),
        );
      },
      () => undefined,
    );

    try {
      const downloadId = await downloadIdPromise;
      if (!owner.cancelRequested) {
        modelDownloadProjection.retry(modelKey, downloadId);
      }
      await promise;
    } catch (error) {
      if ((error as { cancelled?: boolean })?.cancelled) {
        logger.log(`[Whisper] Download cancelled: ${modelId}`);
      } else {
        logger.error('[Whisper] Download failed:', error);
      }
      await this.unlinkOwnedFile(modelId, owner, destPath).catch(() => {});
      throw error;
    }

    try {
      await whisperModelFiles.validateModelFile(destPath);
    } catch (validationError) {
      await this.unlinkOwnedFile(modelId, owner, destPath).catch(error =>
        logger.error('[Whisper] Failed to delete invalid model file:', error),
      );
      const reason =
        validationError instanceof Error
          ? validationError.message
          : 'unknown error';
      throw new Error(`Downloaded model file is invalid: ${reason}`);
    }

    logger.log(`[Whisper] Downloaded to ${destPath}`);
    return destPath;
  }

  listDownloadedModels(): Promise<DownloadedWhisperModel[]> {
    return whisperModelFiles.listDownloadedModels();
  }

  async deleteModel(modelId: string): Promise<void> {
    const owner = await this.operations.requestCancel(modelId, {
      cancelQueued: modelKey => backgroundDownloadService
        .cancelDownload(`queued:${modelKey}`),
      cancelTransfer: downloadId => backgroundDownloadService.cancelDownload(downloadId),
    });
    if (owner?.published && !this.operations.hasReplacement(owner)) {
      modelDownloadProjection.remove(owner.modelKey);
    }

    const path = whisperModelFiles.getModelPath(modelId);
    if (await RNFS.exists(path)) {
      if (owner && this.operations.hasReplacement(owner)) return;
      await RNFS.unlink(path);
    }
  }
}

/** Compatibility constructor for the runtime service and focused adapter tests. */
export const WhisperModelDownloads = WhisperDownloadAdapter;
