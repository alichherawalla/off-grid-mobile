import RNFS from 'react-native-fs';
import logger from '../../../utils/logger';
import { DownloadedModel, ModelFile, BackgroundDownloadInfo, ONNXImageModel, PersistedDownloadInfo } from '../../../types';
import { APP_CONFIG } from '../../../constants';
import { useAppStore } from '../../../stores';
import { coordinatedDownloads as backgroundDownloadService } from '../coordinatedDownloadBridge';
import {
  BackgroundDownloadMetadataCallback,
  BackgroundDownloadContext,
  DownloadProgressCallback,
  DownloadCompleteCallback,
  DownloadErrorCallback,
} from '../../adapters/models/library/types';
import {
  saveModelsList,
  saveImageModelsList,
  loadDownloadedModels,
  loadDownloadedImageModels,
} from '../../adapters/models/library/modelRegistryStorageAdapter';
import type { TransferredModelManifest } from '@offgrid/sync';
import { registerTransferredModelFile } from '../../adapters/models/library/transferAdmissionAdapter';
import {
  performBackgroundDownload,
  watchBackgroundDownload,
  syncCompletedBackgroundDownloads,
  getOrphanedTextFiles,
  getOrphanedImageDirs,
  mmProjLocalName,
} from '../../adapters/models/library/downloadArtifactAdapter';
import { syncCompletedImageDownloads as syncCompletedImageDownloadsHelper } from '../../adapters/models/library/imageDownloadRecoveryAdapter';
import { restoreInProgressDownloads } from '../../adapters/models/library/downloadRestoreAdapter';
import {
  deleteOrphanedFile as scanDeleteOrphanedFile,
  cleanupMMProjEntries as scanCleanupMMProjEntries,
  scanForUntrackedImageModels as scanUntrackedImage,
  scanForUntrackedTextModels as scanUntrackedText,
  reconcileFinishedImageDownloads as reconcileImageDownloads,
  isMMProjFile,
} from '../../adapters/models/library/modelScanAdapter';
import {
  importLocalModel as scanImportLocalModel,
  type ImportLocalModelOpts,
} from '../../adapters/models/library/localModelImportAdapter';
import { determineCredibility } from '../../adapters/models/library/modelRegistryStorageAdapter';
import {
  isSafeImageModelId,
  ModelLibraryRegistryService,
  resolveStoredModelPath,
  type VisionRepairOutcome,
} from '@offgrid/models';
import * as visionRepair from '../../adapters/models/library/visionRepairAdapter';
import type { RepairOpts, VisionRepairContext } from '../../adapters/models/library/visionRepairAdapter';
import { resolveOwnedDocumentPath } from '../../../utils/resolveDocumentPath';

class ModelLibraryBootstrap {
  private readonly modelsDir: string;
  private readonly imageModelsDir: string;
  private readonly registry: ModelLibraryRegistryService<DownloadedModel, ONNXImageModel>;
  private backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null = null;
  private readonly backgroundDownloadContext: Map<string, BackgroundDownloadContext> = new Map();

  constructor() {
    this.modelsDir = `${RNFS.DocumentDirectoryPath}/${APP_CONFIG.modelStorageDir}`;
    this.imageModelsDir = `${RNFS.DocumentDirectoryPath}/image_models`;
    this.registry = new ModelLibraryRegistryService({
      listText: () => loadDownloadedModels(this.modelsDir).catch(() => []),
      saveText: saveModelsList,
      listImages: () => loadDownloadedImageModels(this.imageModelsDir).catch(() => []),
      saveImages: saveImageModelsList,
      resolveOwnedTextPath: path => resolveOwnedDocumentPath(path, this.modelsDir),
      imageRoot: modelId => isSafeImageModelId(modelId)
        ? `${this.imageModelsDir}/${modelId}`
        : null,
      exists: path => RNFS.exists(path),
      remove: path => RNFS.unlink(path),
      freeSpace: async () => (await RNFS.getFSInfo()).freeSpace,
    });
  }

  private resolveStoredPath(p: string, d: string) { return resolveStoredModelPath(p, d); }
  private determineCredibility(a: string) { return determineCredibility(a); }
  private isMMProjFile(f: string) { return isMMProjFile(f); }

  async initialize(): Promise<void> {
    if (!(await RNFS.exists(this.modelsDir))) await RNFS.mkdir(this.modelsDir);
    if (!(await RNFS.exists(this.imageModelsDir))) await RNFS.mkdir(this.imageModelsDir);
    const exclude = (p: string) => backgroundDownloadService.excludeFromBackup(p);
    await Promise.all([exclude(this.modelsDir), exclude(this.imageModelsDir),
      exclude(`${RNFS.DocumentDirectoryPath}/${APP_CONFIG.whisperStorageDir}`)]);
  }

  /**
   * What the projector lifecycle needs from the registry. Every re-entrant call routes back through
   * this object's own methods, so the manager stays the single owner of the model list.
   */
  private visionContext(): VisionRepairContext {
    return {
      modelsDir: this.modelsDir,
      initialize: () => this.initialize(),
      getDownloadedModels: () => this.getDownloadedModels(),
      saveModelWithMmproj: (id, path) => this.saveModelWithMmproj(id, path),
      linkOrphanMmProj: () => this.linkOrphanMmProj(),
      repairMmProj: (target, opts) => this.repairMmProj(target.modelId, target.file, opts),
    };
  }

  async linkOrphanMmProj(): Promise<void> {
    return visionRepair.linkOrphanMmProj(this.visionContext());
  }

  async getDownloadedModels(): Promise<DownloadedModel[]> {
    return this.registry.listText();
  }

  async deleteModel(modelId: string): Promise<void> {
    await this.registry.deleteText(modelId);
  }

  async getModelPath(modelId: string): Promise<string | null> {
    return this.registry.textPath(modelId);
  }

  async getStorageUsed(): Promise<number> {
    return this.registry.textStorageUsed();
  }

  async getAvailableStorage(): Promise<number> {
    return this.registry.availableStorage();
  }

  async getOrphanedFiles(): Promise<Array<{ name: string; path: string; size: number }>> {
    await this.initialize();
    try {
      const textOrphans = await getOrphanedTextFiles(this.modelsDir, () => this.getDownloadedModels());
      const imageOrphans = await getOrphanedImageDirs(this.imageModelsDir, () => this.getDownloadedImageModels());
      return [...textOrphans, ...imageOrphans];
    } catch {
      return [];
    }
  }

  async deleteOrphanedFile(filePath: string): Promise<void> {
    await scanDeleteOrphanedFile(filePath);
  }

  setBackgroundDownloadMetadataCallback(callback: BackgroundDownloadMetadataCallback): void {
    this.backgroundDownloadMetadataCallback = callback;
  }

  isBackgroundDownloadSupported(): boolean {
    return backgroundDownloadService.isAvailable();
  }

  async downloadModelBackground(
    modelId: string,
    file: ModelFile,
    onProgress?: DownloadProgressCallback,
  ): Promise<BackgroundDownloadInfo> {
    if (!this.isBackgroundDownloadSupported()) {
      throw new Error('Background downloads not supported on this platform');
    }
    await this.initialize();
    return performBackgroundDownload({
      modelId,
      file,
      modelsDir: this.modelsDir,
      backgroundDownloadContext: this.backgroundDownloadContext,
      backgroundDownloadMetadataCallback: this.backgroundDownloadMetadataCallback,
      onProgress,
    });
  }

  watchDownload(
    downloadId: string,
    onComplete?: DownloadCompleteCallback,
    onError?: DownloadErrorCallback,
  ): void {
    watchBackgroundDownload({
      downloadId,
      modelsDir: this.modelsDir,
      backgroundDownloadContext: this.backgroundDownloadContext,
      backgroundDownloadMetadataCallback: this.backgroundDownloadMetadataCallback,
      onComplete,
      onError,
    });
  }

  // Called after retrying a failed mmproj sidecar. The mmproj error handler
  // sets ctx.mmProjCompleted=true and nulls ctx.mmProjLocalPath so finalization
  // can proceed as text-only. If the user then retries and the native mmproj
  // download restarts, these flags must be reset so watchBackgroundDownload
  // registers a fresh onComplete listener and tryFinalize waits for the sidecar.
  resetMmProjForRetry(downloadId: string): void {
    const ctx = this.backgroundDownloadContext.get(downloadId);
    if (!ctx || !('file' in ctx) || !ctx.mmProjDownloadId) return;
    ctx.mmProjCompleted = false;
    ctx.mmProjCompleteHandled = false;
    if (!ctx.mmProjLocalPath && ctx.file.mmProjFile) {
      ctx.mmProjLocalPath = `${this.modelsDir}/${mmProjLocalName(ctx.file.name, ctx.file.mmProjFile?.name)}`;
    }
  }

  private async cleanupCancelledTextArtifacts(ctx: Extract<BackgroundDownloadContext, { file: ModelFile }>): Promise<void> {
    const cleanupTargets = [ctx.localPath, ctx.mmProjLocalPath].filter((path): path is string => !!path);

    await Promise.all(cleanupTargets.map(async targetPath => {
      try {
        const exists = await RNFS.exists(targetPath);
        if (!exists) return;
        await RNFS.unlink(targetPath);
        logger.warn(`[ModelManagerDownload] removed cancelled artifact ${targetPath}`);
      } catch (error) {
        logger.warn(`[ModelManagerDownload] failed to remove cancelled artifact ${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  }

  async cancelBackgroundDownload(downloadId: string): Promise<void> {
    if (!this.isBackgroundDownloadSupported()) {
      throw new Error('Background downloads not supported on this platform');
    }
    const ctx = this.backgroundDownloadContext.get(downloadId);
    if (ctx && 'file' in ctx && ctx.mmProjDownloadId) {
      await backgroundDownloadService.cancelDownload(ctx.mmProjDownloadId).catch(() => {});
    }

    await backgroundDownloadService.cancelDownload(downloadId);
    if (ctx && 'file' in ctx) {
      await this.cleanupCancelledTextArtifacts(ctx);
    }
    this.backgroundDownloadMetadataCallback?.(downloadId, null);
  }

  async syncBackgroundDownloads(
    persistedDownloads: Record<string, PersistedDownloadInfo>,
    clearDownloadCallback: (downloadId: string) => void,
  ): Promise<DownloadedModel[]> {
    if (!this.isBackgroundDownloadSupported()) return [];
    await this.initialize();
    return syncCompletedBackgroundDownloads({ persistedDownloads, modelsDir: this.modelsDir, clearDownloadCallback });
  }
  async syncCompletedImageDownloads(
    persistedDownloads: Record<string, PersistedDownloadInfo>,
    clearDownloadCallback: (downloadId: string) => void,
  ): Promise<ONNXImageModel[]> {
    if (!this.isBackgroundDownloadSupported()) return [];
    await this.initialize();
    return syncCompletedImageDownloadsHelper({
      imageModelsDir: this.imageModelsDir,
      persistedDownloads,
      clearDownloadCallback,
      getDownloadedImageModels: () => this.getDownloadedImageModels(),
      addDownloadedImageModel: (model) => this.addDownloadedImageModel(model),
    });
  }

  async restoreInProgressDownloads(
    onProgress?: DownloadProgressCallback,
  ): Promise<string[]> {
    if (!this.isBackgroundDownloadSupported()) return [];
    await this.initialize();
    return restoreInProgressDownloads({
      modelsDir: this.modelsDir,
      backgroundDownloadContext: this.backgroundDownloadContext,
      backgroundDownloadMetadataCallback: this.backgroundDownloadMetadataCallback,
      onProgress,
    });
  }

  async getActiveBackgroundDownloads(): Promise<BackgroundDownloadInfo[]> {
    if (!this.isBackgroundDownloadSupported()) return [];
    return backgroundDownloadService.getActiveDownloads();
  }
  startBackgroundDownloadPolling(): void {
    if (this.isBackgroundDownloadSupported()) backgroundDownloadService.startProgressPolling();
  }

  stopBackgroundDownloadPolling(): void {
    if (this.isBackgroundDownloadSupported()) backgroundDownloadService.stopProgressPolling();
  }
  /** @see visionRepairService.repairVision - the one rule every surface repairs a model through. */
  async repairVision(
    model: DownloadedModel,
    opts?: RepairOpts,
  ): Promise<VisionRepairOutcome> {
    return visionRepair.repairVision(this.visionContext(), model, opts);
  }

  async repairMmProj(modelId: string, file: ModelFile, opts?: RepairOpts): Promise<void> {
    return visionRepair.repairMmProj(this.visionContext(), { modelId, file }, opts);
  }

  async markVisionModel(modelId: string): Promise<boolean> {
    return visionRepair.markVisionModel(this.visionContext(), modelId);
  }

  async saveModelWithMmproj(modelId: string, mmProjPath: string): Promise<void> {
    return visionRepair.saveModelWithMmproj(this.visionContext(), modelId, mmProjPath);
  }

  async clearMmProjLink(modelId: string): Promise<void> {
    return visionRepair.clearMmProjLink(this.visionContext(), modelId);
  }

  async cleanupMMProjEntries(): Promise<number> {
    return scanCleanupMMProjEntries(this.modelsDir);
  }

  async importLocalModel(opts: Omit<ImportLocalModelOpts, 'modelsDir'>): Promise<DownloadedModel> {
    await this.initialize();
    return scanImportLocalModel({ ...opts, modelsDir: this.modelsDir });
  }

  getModelsDirectory(): string {
    return this.modelsDir;
  }

  async registerTransferredModel(manifest: TransferredModelManifest): Promise<DownloadedModel> {
    const model = await registerTransferredModelFile(manifest, this.modelsDir);
    useAppStore.getState().setDownloadedModels(await this.getDownloadedModels());
    return model;
  }

  async getDownloadedImageModels(): Promise<ONNXImageModel[]> {
    return this.registry.listImages();
  }

  async addDownloadedImageModel(model: ONNXImageModel): Promise<void> {
    await this.registry.upsertImage(model);
  }

  async deleteImageModel(modelId: string): Promise<void> {
    await this.registry.deleteImage(modelId);
  }

  async getImageModelPath(modelId: string): Promise<string | null> {
    return this.registry.imagePath(modelId);
  }

  async getImageModelsStorageUsed(): Promise<number> {
    return this.registry.imageStorageUsed();
  }

  getImageModelsDirectory(): string {
    return this.imageModelsDir;
  }

  async scanForUntrackedImageModels(): Promise<ONNXImageModel[]> {
    await this.initialize();
    return scanUntrackedImage({
      imageModelsDir: this.imageModelsDir,
      getImageModels: () => this.getDownloadedImageModels(),
      addImageModel: (model) => this.addDownloadedImageModel(model),
    });
  }

  async reconcileFinishedImageDownloads(activeModelIds: Set<string>): Promise<ONNXImageModel[]> {
    await this.initialize();
    return reconcileImageDownloads({
      imageModelsDir: this.imageModelsDir,
      getImageModels: () => this.getDownloadedImageModels(),
      addImageModel: (model) => this.addDownloadedImageModel(model),
      activeModelIds,
    });
  }

  async scanForUntrackedTextModels(): Promise<DownloadedModel[]> {
    await this.initialize();
    return scanUntrackedText(this.modelsDir, () => this.getDownloadedModels());
  }

  async refreshModelLists(): Promise<{ textModels: DownloadedModel[]; imageModels: ONNXImageModel[] }> {
    await this.scanForUntrackedTextModels();
    await this.scanForUntrackedImageModels();
    return {
      textModels: await this.getDownloadedModels(),
      imageModels: await this.getDownloadedImageModels(),
    };
  }
}

export const modelLibrary = new ModelLibraryBootstrap();
