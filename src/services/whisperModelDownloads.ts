import RNFS from 'react-native-fs';
import logger from '../utils/logger';
import { useDownloadStore } from '../stores/downloadStore';
import { makeModelKey } from '../utils/modelKey';
import { backgroundDownloadService } from './backgroundDownloadService';
import * as whisperModelFiles from './whisperModelFiles';
import { WHISPER_MODELS } from './whisperModels';

export interface DownloadedWhisperModel {
  modelId: string;
  fileName: string;
  sizeBytes: number;
  filePath: string;
}

/** Owns Whisper download queue identity and native-download cleanup. */
export class WhisperModelDownloads {
  private readonly activeDownloadIds = new Map<string, string>();

  async downloadModel(
    modelId: string,
    onProgress?: (progress: number) => void,
  ): Promise<string> {
    const model = WHISPER_MODELS.find(candidate => candidate.id === modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);

    await whisperModelFiles.ensureModelsDirExists();
    const destPath = whisperModelFiles.getModelPath(modelId);
    if (await RNFS.exists(destPath)) return destPath;

    logger.log(
      `[Whisper] Downloading ${model.name} via background download service...`,
    );
    const fileName = `ggml-${modelId}.bin`;
    const totalBytes = model.size * 1024 * 1024;
    const modelKey = makeModelKey(`whisper-${modelId}`, fileName);
    const queuedId = `queued:${modelKey}`;

    // Publish the queue entry before a native concurrency slot opens. All model
    // types then use the same canonical progress store and cancellation identity.
    useDownloadStore.getState().add({
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

    let ownedDownloadId: string | null = null;
    try {
      try {
        const downloadId = await downloadIdPromise;
        ownedDownloadId = downloadId;
        this.activeDownloadIds.set(modelId, downloadId);
        useDownloadStore
          .getState()
          .retryEntry(modelKey, downloadId);
        await promise;
      } catch (error) {
        if ((error as { cancelled?: boolean })?.cancelled) {
          logger.log(`[Whisper] Download cancelled: ${modelId}`);
        } else {
          logger.error('[Whisper] Download failed:', error);
        }
        await RNFS.unlink(destPath).catch(() => {});
        throw error;
      } finally {
        if (this.activeDownloadIds.get(modelId) === ownedDownloadId) {
          this.activeDownloadIds.delete(modelId);
        }
      }

      try {
        await whisperModelFiles.validateModelFile(destPath);
      } catch (validationError) {
        await RNFS.unlink(destPath).catch(error =>
          logger.error(
            '[Whisper] Failed to delete invalid model file:',
            error,
          ),
        );
        const reason =
          validationError instanceof Error
            ? validationError.message
            : 'unknown error';
        throw new Error(`Downloaded model file is invalid: ${reason}`);
      }
    } finally {
      // Completed models are listed from disk. Remove the transient queue row on
      // both success and failure so it cannot duplicate or block a retry.
      useDownloadStore.getState().remove(modelKey);
    }

    logger.log(`[Whisper] Downloaded to ${destPath}`);
    return destPath;
  }

  listDownloadedModels(): Promise<DownloadedWhisperModel[]> {
    return whisperModelFiles.listDownloadedModels();
  }

  async deleteModel(modelId: string): Promise<void> {
    const activeDownloadId = this.activeDownloadIds.get(modelId);
    if (activeDownloadId !== undefined) {
      await backgroundDownloadService
        .cancelDownload(activeDownloadId)
        .catch(() => {});
      this.activeDownloadIds.delete(modelId);
    }

    const path = whisperModelFiles.getModelPath(modelId);
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  }
}
