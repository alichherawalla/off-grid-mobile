import RNFS from 'react-native-fs';
import {
  WHISPER_MODELS,
  createWhisperManagedArtifact,
  whisperArtifactIdentity,
  type ManagedArtifactPorts,
} from '@offgrid/models';
import logger from '../utils/logger';
import { modelDownloadApplication } from './composition/downloads';
import { modelDownloadProjection } from '../stores/downloadStore';
import {
  coordinatedDownloads as backgroundDownloadService,
} from './modelServices/coordinatedDownloadBridge';
import * as whisperModelFiles from './whisperModelFiles';

interface DownloadedWhisperModel {
  modelId: string;
  fileName: string;
  sizeBytes: number;
  filePath: string;
}

/** Native and UI ports for the Shared-owned Whisper download workflow. */
const whisperPorts: ManagedArtifactPorts = {
  now: () => Date.now(),
  ensureDirectory: () => whisperModelFiles.ensureModelsDirExists(),
  exists: path => RNFS.exists(path),
  remove: path => RNFS.unlink(path),
  validate: path => whisperModelFiles.validateModelFile(path),
  start: input => {
    const transfer = backgroundDownloadService.downloadFileTo({
      params: input.request,
      destPath: input.destination,
      onProgress: input.onProgress,
      silent: true,
    });
    return {
      downloadId: transfer.downloadIdPromise,
      completion: transfer.promise,
    };
  },
  cancel: id => backgroundDownloadService.cancelDownload(id),
  projectAdmitted: entry => modelDownloadProjection.admit(entry),
  projectTransfer: (modelKey, downloadId) =>
    modelDownloadProjection.retry(modelKey, downloadId),
  projectRemoved: modelKey => modelDownloadProjection.remove(modelKey),
  observe: event => {
    if (event.type === 'started') logger.log(`[Whisper] Downloading ${event.logicalId}...`);
    else if (event.type === 'completed') logger.log(`[Whisper] Downloaded ${event.logicalId}`);
    else if (event.type === 'cancelled') logger.log(`[Whisper] Download cancelled: ${event.logicalId}`);
    else if (event.type === 'failed') logger.error('[Whisper] Download failed:', event.error);
    else logger.error('[Whisper] Artifact validation failed:', event.error);
  },
};

const whisperDownloadApplication = modelDownloadApplication();

/** Mobile adapter. Shared owns admission, cancellation, cleanup, and delete races. */
class WhisperDownloadAdapter {
  async downloadModel(
    modelId: string,
    onProgress?: (progress: number) => void,
  ): Promise<string> {
    const model = WHISPER_MODELS.find(candidate => candidate.id === modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    return whisperDownloadApplication.downloadManagedArtifact(
      createWhisperManagedArtifact(model, whisperModelFiles.getModelPath(modelId)),
      whisperPorts,
      onProgress,
    );
  }

  listDownloadedModels(): Promise<DownloadedWhisperModel[]> {
    return whisperModelFiles.listDownloadedModels();
  }

  async deleteModel(modelId: string): Promise<void> {
    await whisperDownloadApplication.deleteManagedArtifact({
      logicalId: modelId,
      modelKey: whisperArtifactIdentity(modelId).modelKey,
      destination: whisperModelFiles.getModelPath(modelId),
      ports: whisperPorts,
    });
  }
}

/** Compatibility constructor for the runtime service and focused adapter tests. */
export const WhisperModelDownloads = WhisperDownloadAdapter;
