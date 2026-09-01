import RNFS from 'react-native-fs';
import type { ModelArtifactManifest, ModelDownloadHandle } from '@offgrid/models';
import { modelProjectorLocalName } from '@offgrid/models';
import type { BackgroundDownloadInfo, DownloadedModel, ModelFile } from '../../../../types';
import { huggingFaceService } from '../../../huggingface';
import { coordinatedDownloads } from '../../../modelServices/coordinatedDownloadBridge';
import { useDownloadStore } from '../../../../stores/downloadStore';
import { makeModelKey } from '../../../../utils/modelKey';
import logger from '../../../../utils/logger';
import { buildDownloadedModel, persistDownloadedModel } from './modelRegistryStorageAdapter';
import type {
  BackgroundDownloadContext,
  BackgroundDownloadMetadataCallback,
  DownloadCompleteCallback,
  DownloadErrorCallback,
  DownloadProgressCallback,
} from './types';

export const mmProjLocalName = modelProjectorLocalName;

const operationId = (modelId: string, fileName: string) =>
  `mobile:text:${makeModelKey(modelId, fileName)}`;
const projectorProjectionId = (id: string) => `${id}:projector`;
const documentRelativePath = (path: string) => {
  const prefix = `${RNFS.DocumentDirectoryPath}/`;
  if (!path.startsWith(prefix)) throw new Error(`Model path is outside app storage: ${path}`);
  return path.slice(prefix.length);
};

function textManifest(input: {
  modelId: string;
  file: ModelFile;
  modelsDir: string;
  includePrimary: boolean;
  includeProjector: boolean;
}): ModelArtifactManifest {
  const { modelId, file, modelsDir, includePrimary, includeProjector } = input;
  const id = operationId(modelId, file.name);
  const artifacts: ModelArtifactManifest['artifacts'] = [];
  if (includeProjector && file.mmProjFile) {
    const localName = mmProjLocalName(file.name, file.mmProjFile.name);
    artifacts.push({
      id: `${id}:projector-artifact`, name: file.mmProjFile.name,
      localName: documentRelativePath(`${modelsDir}/${localName}`),
      url: file.mmProjFile.downloadUrl, sizeBytes: file.mmProjFile.size,
      sha256: file.mmProjFile.sha256, role: 'mmproj', required: false,
    });
  }
  if (includePrimary) artifacts.push({
    id: `${id}:primary-artifact`, name: file.name,
    localName: documentRelativePath(`${modelsDir}/${file.name}`),
    url: file.downloadUrl || huggingFaceService.getDownloadUrl(modelId, file.name),
    sizeBytes: file.size, sha256: file.sha256, role: 'primary', required: true,
  });
  return {
    id, modelId, kind: 'text', revision: 'mobile', artifacts,
    metadata: {
      owner: 'mobile-text', file,
      localPath: `${modelsDir}/${file.name}`,
      mmProjLocalPath: file.mmProjFile
        ? `${modelsDir}/${mmProjLocalName(file.name, file.mmProjFile.name)}`
        : null,
    },
  };
}

function attachProjection(input: {
  handle: ModelDownloadHandle;
  id: string;
  modelId: string;
  file: ModelFile;
  onProgress?: DownloadProgressCallback;
}): () => void {
  const { handle, id, modelId, file, onProgress } = input;
  const projectorId = `${id}:projector-artifact`;
  return handle.subscribe(event => {
    const store = useDownloadStore.getState();
    if (event.type === 'progress') {
      if (event.artifactId === projectorId) {
        store.updateMmProjProgress(projectorProjectionId(id), event.bytesDownloaded);
      } else store.updateProgress(id, event.bytesDownloaded, event.totalBytes);
      const entry = useDownloadStore.getState().downloads[makeModelKey(modelId, file.name)];
      if (entry) onProgress?.({
        downloadId: id, modelId, fileName: file.name,
        bytesDownloaded: entry.bytesDownloaded + (entry.mmProjBytesDownloaded ?? 0),
        totalBytes: entry.combinedTotalBytes, progress: entry.progress,
      });
    }
    if (event.type === 'failed' && event.artifactId === projectorId) {
      store.setStatus(projectorProjectionId(id), 'failed', { message: event.error });
    }
  });
}

function addProjection(input: {
  id: string;
  modelId: string;
  file: ModelFile;
  includeProjector: boolean;
  primaryAlreadyPresent: boolean;
  projectorAlreadyPresent: boolean;
}): void {
  const { id, modelId, file, includeProjector, primaryAlreadyPresent, projectorAlreadyPresent } = input;
  const modelKey = makeModelKey(modelId, file.name);
  const store = useDownloadStore.getState();
  const existing = store.downloads[modelKey];
  if (existing) store.retryEntry(modelKey, id);
  else store.add({
    modelKey, downloadId: id, modelId, fileName: file.name,
    quantization: file.quantization ?? '', modelType: 'text', status: 'pending',
    bytesDownloaded: primaryAlreadyPresent ? file.size : 0, totalBytes: file.size,
    combinedTotalBytes: file.size + (file.mmProjFile?.size ?? 0),
    mmProjBytesDownloaded: projectorAlreadyPresent ? file.mmProjFile?.size ?? 0 : 0,
    progress: 0, createdAt: Date.now(),
    metadataJson: JSON.stringify({
      downloadUrl: file.downloadUrl,
      mmProjDownloadUrl: file.mmProjFile?.downloadUrl,
      mmProjFileName: file.mmProjFile?.name,
      mmProjFileSize: file.mmProjFile?.size,
      mmProjSha256: file.mmProjFile?.sha256,
    }),
  });
  if (includeProjector) store.setMmProjDownloadId(modelKey, projectorProjectionId(id));
}

export interface PerformBackgroundDownloadOpts {
  modelId: string;
  file: ModelFile;
  modelsDir: string;
  backgroundDownloadContext: Map<string, BackgroundDownloadContext>;
  backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null;
  onProgress?: DownloadProgressCallback;
}

export async function performBackgroundDownload(
  opts: PerformBackgroundDownloadOpts,
): Promise<BackgroundDownloadInfo> {
  const { modelId, file, modelsDir, backgroundDownloadContext, onProgress } = opts;
  const localPath = `${modelsDir}/${file.name}`;
  const mmProjLocalPath = file.mmProjFile
    ? `${modelsDir}/${mmProjLocalName(file.name, file.mmProjFile.name)}`
    : null;
  const primaryPresent = await RNFS.exists(localPath);
  const projectorPresent = !mmProjLocalPath || await RNFS.exists(mmProjLocalPath);
  const totalBytes = file.size + (file.mmProjFile?.size ?? 0);
  if (primaryPresent && projectorPresent) {
    const model = await buildDownloadedModel({
      modelId, file, resolvedLocalPath: localPath, mmProjPath: mmProjLocalPath ?? undefined,
    });
    const id = `already-downloaded:${makeModelKey(modelId, file.name)}`;
    backgroundDownloadContext.set(id, { model, error: null });
    return { downloadId: id, fileName: file.name, modelId, status: 'completed',
      bytesDownloaded: totalBytes, totalBytes, startedAt: Date.now() };
  }
  const manifest = textManifest({
    modelId, file, modelsDir, includePrimary: !primaryPresent,
    includeProjector: Boolean(file.mmProjFile && !projectorPresent),
  });
  const { downloadId, handle } = coordinatedDownloads.startManifest(manifest);
  addProjection({ id: downloadId, modelId, file,
    includeProjector: Boolean(file.mmProjFile && !projectorPresent),
    primaryAlreadyPresent: primaryPresent, projectorAlreadyPresent: projectorPresent });
  const unsubscribe = attachProjection({ handle, id: downloadId, modelId, file, onProgress });
  backgroundDownloadContext.set(downloadId, {
    operation: handle, modelId, file, localPath, mmProjLocalPath,
    projectorArtifactId: file.mmProjFile ? `${downloadId}:projector-artifact` : undefined,
    unsubscribe,
  });
  return { downloadId, fileName: file.name, modelId, status: 'pending',
    bytesDownloaded: projectorPresent ? file.mmProjFile?.size ?? 0 : 0,
    totalBytes, startedAt: Date.now() };
}

export interface WatchDownloadOpts {
  downloadId: string;
  modelsDir: string;
  backgroundDownloadContext: Map<string, BackgroundDownloadContext>;
  backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null;
  onComplete?: DownloadCompleteCallback;
  onError?: DownloadErrorCallback;
}

async function finalizeOperation(
  ctx: Extract<BackgroundDownloadContext, { operation: ModelDownloadHandle }>,
  modelsDir: string,
): Promise<DownloadedModel> {
  const result = await ctx.operation.completion;
  if (!result.success) throw new Error(result.error ?? 'Download failed');
  const projectorExists = ctx.mmProjLocalPath ? await RNFS.exists(ctx.mmProjLocalPath) : false;
  const model = await buildDownloadedModel({
    modelId: ctx.modelId, file: ctx.file, resolvedLocalPath: ctx.localPath,
    mmProjPath: projectorExists ? ctx.mmProjLocalPath ?? undefined : undefined,
    expectedMmProjFileName: !projectorExists ? ctx.file.mmProjFile?.name : undefined,
  });
  await persistDownloadedModel(model, modelsDir);
  return model;
}

export function watchBackgroundDownload(opts: WatchDownloadOpts): void {
  const { downloadId, modelsDir, backgroundDownloadContext,
    backgroundDownloadMetadataCallback, onComplete, onError } = opts;
  const ctx = backgroundDownloadContext.get(downloadId);
  if (!ctx) return;
  if ('model' in ctx) {
    backgroundDownloadContext.delete(downloadId);
    if (ctx.model) {
      persistDownloadedModel(ctx.model, modelsDir)
        .then(() => onComplete?.(ctx.model as DownloadedModel))
        .catch(error => onError?.(error instanceof Error ? error : new Error(String(error))));
    }
    else if (ctx.error) onError?.(ctx.error);
    return;
  }
  if (!('operation' in ctx) || ctx.watching) return;
  ctx.watching = true;
  useDownloadStore.getState().setProcessing(downloadId);
  finalizeOperation(ctx, modelsDir).then(model => {
    ctx.unsubscribe();
    backgroundDownloadContext.delete(downloadId);
    useDownloadStore.getState().remove(makeModelKey(ctx.modelId, ctx.file.name));
    backgroundDownloadMetadataCallback?.(downloadId, null);
    onComplete?.(model);
  }).catch(error => {
    ctx.unsubscribe();
    ctx.watching = false;
    const failure = error instanceof Error ? error : new Error(String(error));
    useDownloadStore.getState().setStatus(downloadId, 'failed', { message: failure.message });
    logger.error('[ModelDownload] shared text operation failed', failure.message);
    onError?.(failure);
  });
}

export interface MmProjRepairDownloadOpts {
  modelId: string;
  file: ModelFile;
  modelsDir: string;
  onProgress?: DownloadProgressCallback;
  onDownloadIdReady?: (id: string) => void;
}

export async function performMmProjRepairDownload(opts: MmProjRepairDownloadOpts): Promise<string> {
  const { modelId, file, modelsDir, onProgress, onDownloadIdReady } = opts;
  if (!file.mmProjFile) throw new Error('Model file has no associated mmproj');
  const localPath = `${modelsDir}/${file.name}`;
  if (!(await RNFS.exists(localPath))) throw new Error('Model file is missing');
  const projectorPath = `${modelsDir}/${mmProjLocalName(file.name, file.mmProjFile.name)}`;
  if (await RNFS.exists(projectorPath)) await RNFS.unlink(projectorPath);
  const context = new Map<string, BackgroundDownloadContext>();
  const info = await performBackgroundDownload({
    modelId, file, modelsDir, backgroundDownloadContext: context,
    backgroundDownloadMetadataCallback: null, onProgress,
  });
  onDownloadIdReady?.(info.downloadId);
  const ctx = context.get(info.downloadId);
  if (!ctx || !('operation' in ctx)) throw new Error('Projector operation was not created');
  const result = await ctx.operation.completion;
  ctx.unsubscribe();
  useDownloadStore.getState().remove(makeModelKey(modelId, file.name));
  if (!result.success || !(await RNFS.exists(projectorPath))) {
    throw new Error(result.error ?? 'Projector download failed');
  }
  return projectorPath;
}

export {
  getOrphanedTextFiles,
  getOrphanedImageDirs,
  syncCompletedBackgroundDownloads,
} from './downloadRecoveryAdapter';
