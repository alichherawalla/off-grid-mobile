import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import {
  ImageDownloadApplicationService,
  type ImageDownloadMetadata,
} from '@offgrid/models';
import type { ONNXImageModel, PersistedDownloadInfo } from '../../../../types';
import { coordinatedDownloads } from '../../../modelServices/coordinatedDownloadBridge';
import { downloadCoreMLTokenizerFiles, resolveCoreMLModelDir } from '../../../../utils/coreMLModelUtils';
import { ensureImageExtractionComplete, validateImageModelDir } from '../../../../utils/imageModelIntegrity';
import { statFile } from '../../../../utils/fileStat';

interface SyncCompletedImageDownloadsOpts {
  imageModelsDir: string;
  persistedDownloads: Record<string, PersistedDownloadInfo>;
  clearDownloadCallback: (downloadId: string) => void;
  getDownloadedImageModels: () => Promise<ONNXImageModel[]>;
  addDownloadedImageModel: (model: ONNXImageModel) => Promise<void>;
}

async function removeIfPresent(path: string): Promise<void> {
  if (await RNFS.exists(path)) await RNFS.unlink(path).catch(() => undefined);
}

async function validDirectory(path: string, backend?: string): Promise<boolean> {
  if (!(await RNFS.exists(path))) return false;
  if (backend === 'mnn' || backend === 'qnn') return (await validateImageModelDir(path, backend)).complete;
  return (await RNFS.readDir(path)).length > 0;
}

async function validArchive(path: string, expectedBytes: number): Promise<boolean> {
  if (!(await RNFS.exists(path))) return false;
  const size = (await statFile(path))?.size ?? 0;
  return size > 0 && (expectedBytes <= 0 || Math.abs(size - expectedBytes) / expectedBytes <= 0.001);
}

function metadata(value: PersistedDownloadInfo): ImageDownloadMetadata | null {
  if (!value.modelId.startsWith('image:') || !value.imageDownloadType) return null;
  const backend = value.imageModelBackend;
  if (backend !== undefined && backend !== 'mnn' && backend !== 'qnn' && backend !== 'coreml') return null;
  return {
    imageDownloadType: value.imageDownloadType,
    imageModelName: value.imageModelName ?? value.modelId.replace(/^image:/, ''),
    imageModelDescription: value.imageModelDescription ?? '',
    imageModelSize: value.imageModelSize ?? value.totalBytes ?? 0,
    imageModelStyle: value.imageModelStyle,
    imageModelBackend: backend,
    imageModelRepo: value.imageModelRepo,
  };
}

/** Restart adapter. Shared owns candidate recovery, extraction, registration, and cleanup ordering. */
export async function syncCompletedImageDownloads(
  opts: SyncCompletedImageDownloadsOpts,
): Promise<ONNXImageModel[]> {
  const rows = await coordinatedDownloads.getActiveDownloads();
  const installedIds = new Set((await opts.getDownloadedImageModels()).map(model => model.id));
  const recovered: ONNXImageModel[] = [];
  const application = new ImageDownloadApplicationService<Record<string, never>>({
    lifecycle: {
      begin: () => undefined,
      isActive: () => false,
      signal: () => new AbortController().signal,
      attach: () => undefined,
      progress: () => undefined,
      processing: () => undefined,
      complete: () => undefined,
      fail: () => undefined,
      remove: modelId => {
        const row = rows.find(item => {
          const persisted = opts.persistedDownloads[item.downloadId];
          const candidateId = persisted?.modelId ?? item.modelId;
          return candidateId?.replace(/^image:/, '') === modelId;
        });
        if (row) opts.clearDownloadCallback(row.downloadId);
      },
      failEntry: () => undefined,
    },
    storage: {
      imageModelsDirectory: () => opts.imageModelsDir,
      exists: path => RNFS.exists(path),
      ensureDirectory: async path => { if (!(await RNFS.exists(path))) await RNFS.mkdir(path); },
      remove: removeIfPresent,
      writeMarker: (path, value = '') => RNFS.writeFile(path, value, 'utf8'),
      validateModelDirectory: validDirectory,
      validateArchive: validArchive,
      moveCompletedTransfer: async (id, destination) => {
        await coordinatedDownloads.moveCompletedDownload(id, destination);
      },
      extractArchive: async (archive, destination, input) => {
        await unzip(archive, destination);
        await ensureImageExtractionComplete({
          backend: input.backend as ONNXImageModel['backend'],
          modelDir: destination,
          zipPath: archive,
          modelId: input.modelId,
        });
      },
      resolveModelPath: (directory, backend) =>
        backend === 'coreml' ? resolveCoreMLModelDir(directory) : Promise.resolve(directory),
      prepareRuntimeAssets: async (directory, model) => {
        if (model.backend === 'coreml' && model.repo) await downloadCoreMLTokenizerFiles(directory, model.repo);
      },
    },
    transfers: {
      downloadArtifacts: async () => undefined,
      startArchive: async () => { throw new Error('Restart recovery cannot start a transfer.'); },
      nativeStatus: async id => rows.find(row => row.downloadId === id)?.status,
      cancel: id => coordinatedDownloads.cancelDownload(id),
      resume: id => coordinatedDownloads.retryDownload(id),
      startProgressPolling: () => coordinatedDownloads.startProgressPolling(),
    },
    repository: {
      list: () => opts.getDownloadedImageModels(),
      register: model => opts.addDownloadedImageModel(model as ONNXImageModel),
      publish: model => { recovered.push(model as ONNXImageModel); },
    },
    selection: {
      activeModelId: () => 'hydration-does-not-change-selection',
      onboardingComplete: () => false,
      activate: async () => undefined,
    },
    deviceFacts: async () => ({ platform: 'other' }),
    now: () => new Date().toISOString(),
  });

  for (const row of rows) {
    if (row.status !== 'completed') continue;
    const persisted = opts.persistedDownloads[row.downloadId];
    const parsed = persisted && metadata(persisted);
    if (!persisted || !parsed) continue;
    const recoveredModelId = persisted.modelId.replace(/^image:/, '');
    if (installedIds.has(recoveredModelId)) {
      opts.clearDownloadCallback(row.downloadId);
      continue;
    }
    await application.execute({
      type: 'resume',
      entry: {
        downloadId: row.downloadId,
        modelId: persisted.modelId,
        modelKey: persisted.modelId,
        fileName: persisted.fileName,
        metadataJson: JSON.stringify(parsed),
        status: 'processing',
        bytesDownloaded: row.bytesDownloaded,
        totalBytes: persisted.totalBytes,
      },
    });
  }
  return recovered;
}
