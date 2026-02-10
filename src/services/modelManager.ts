import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DownloadedModel, DownloadProgress, ModelFile, ModelCredibility, BackgroundDownloadInfo, ONNXImageModel } from '../types';
import { APP_CONFIG, LMSTUDIO_AUTHORS, OFFICIAL_MODEL_AUTHORS, VERIFIED_QUANTIZERS } from '../constants';
import { huggingFaceService } from './huggingface';
import { backgroundDownloadService } from './backgroundDownloadService';

const MODELS_STORAGE_KEY = '@local_llm/downloaded_models';
const IMAGE_MODELS_STORAGE_KEY = '@local_llm/downloaded_image_models';

type DownloadProgressCallback = (progress: DownloadProgress) => void;
type DownloadCompleteCallback = (model: DownloadedModel) => void;
type DownloadErrorCallback = (error: Error) => void;

// Callback for background download metadata persistence
type BackgroundDownloadMetadataCallback = (
  downloadId: number,
  info: {
    modelId: string;
    fileName: string;
    quantization: string;
    author: string;
    totalBytes: number;
    mmProjFileName?: string;
    mmProjLocalPath?: string | null;
  } | null
) => void;

class ModelManager {
  private modelsDir: string;
  private imageModelsDir: string;
  private downloadJobs: Map<string, { jobId: number; cancel: () => void }> = new Map();
  private backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null = null;

  constructor() {
    this.modelsDir = `${RNFS.DocumentDirectoryPath}/${APP_CONFIG.modelStorageDir}`;
    this.imageModelsDir = `${RNFS.DocumentDirectoryPath}/image_models`;
  }

  /**
   * Re-resolve a stored absolute path against the current base directory.
   * Handles iOS simulator sandbox UUID changes where the Documents path changes
   * between app reinstalls but model files are preserved via AsyncStorage.
   * Returns the re-resolved path, or null if the stored path doesn't match the expected pattern.
   */
  private resolveStoredPath(storedPath: string, currentBaseDir: string): string | null {
    // Extract the relative part after the known directory name
    // e.g. storedPath = "/old-uuid/Documents/image_models/model_name"
    //      currentBaseDir = "/new-uuid/Documents/image_models"
    // We want to extract "model_name" and prepend currentBaseDir

    // Find the base directory name (last component of currentBaseDir)
    const baseDirName = currentBaseDir.substring(currentBaseDir.lastIndexOf('/') + 1);
    const marker = `/${baseDirName}/`;
    const markerIndex = storedPath.indexOf(marker);

    if (markerIndex === -1) return null;

    const relativePart = storedPath.substring(markerIndex + marker.length);
    if (!relativePart) return null;

    return `${currentBaseDir}/${relativePart}`;
  }

  async initialize(): Promise<void> {
    // Ensure models directory exists
    const exists = await RNFS.exists(this.modelsDir);
    if (!exists) {
      await RNFS.mkdir(this.modelsDir);
    }
    // Ensure image models directory exists
    const imageModelsExists = await RNFS.exists(this.imageModelsDir);
    if (!imageModelsExists) {
      await RNFS.mkdir(this.imageModelsDir);
    }
  }

  async getDownloadedModels(): Promise<DownloadedModel[]> {
    try {
      const stored = await AsyncStorage.getItem(MODELS_STORAGE_KEY);
      if (!stored) return [];

      const models: DownloadedModel[] = JSON.parse(stored);

      // Verify files still exist (re-resolve paths for sandbox UUID changes on iOS simulator)
      const validModels: DownloadedModel[] = [];
      let pathsUpdated = false;
      for (const model of models) {
        let exists = await RNFS.exists(model.filePath);
        if (!exists) {
          // Try re-resolving against current DocumentDirectoryPath (handles iOS sandbox UUID changes)
          const resolvedPath = this.resolveStoredPath(model.filePath, this.modelsDir);
          if (resolvedPath && resolvedPath !== model.filePath) {
            exists = await RNFS.exists(resolvedPath);
            if (exists) {
              console.log(`[ModelManager] Re-resolved text model path: ${model.filePath} -> ${resolvedPath}`);
              model.filePath = resolvedPath;
              pathsUpdated = true;
            }
          }
        }
        if (exists) {
          // Also re-resolve mmProjPath if present
          if (model.mmProjPath) {
            const mmExists = await RNFS.exists(model.mmProjPath);
            if (!mmExists) {
              const resolvedMmPath = this.resolveStoredPath(model.mmProjPath, this.modelsDir);
              if (resolvedMmPath && resolvedMmPath !== model.mmProjPath && await RNFS.exists(resolvedMmPath)) {
                console.log(`[ModelManager] Re-resolved mmProj path: ${model.mmProjPath} -> ${resolvedMmPath}`);
                model.mmProjPath = resolvedMmPath;
                pathsUpdated = true;
              }
            }
          }
          validModels.push(model);
        } else {
          console.warn(`[ModelManager] Removing text model "${model.id}" — path not found: ${model.filePath}`);
        }
      }

      // Update storage if we removed any invalid entries or updated paths
      if (validModels.length !== models.length || pathsUpdated) {
        await this.saveModelsList(validModels);
      }

      return validModels;
    } catch (error) {
      console.error('Error loading downloaded models:', error);
      return [];
    }
  }

  async downloadModel(
    modelId: string,
    file: ModelFile,
    onProgress?: DownloadProgressCallback,
    onComplete?: DownloadCompleteCallback,
    onError?: DownloadErrorCallback
  ): Promise<void> {
    const downloadKey = `${modelId}/${file.name}`;

    // Check if already downloading
    if (this.downloadJobs.has(downloadKey)) {
      throw new Error('Model is already being downloaded');
    }

    try {
      await this.initialize();

      console.log('[ModelManager] downloadModel called for:', modelId);
      console.log('[ModelManager] file.name:', file.name);
      console.log('[ModelManager] file.mmProjFile:', file.mmProjFile ? file.mmProjFile.name : 'NONE');

      const localPath = `${this.modelsDir}/${file.name}`;
      const mmProjLocalPath = file.mmProjFile
        ? `${this.modelsDir}/${file.mmProjFile.name}`
        : null;

      // Calculate combined size for progress tracking
      const totalSize = file.size + (file.mmProjFile?.size || 0);

      let mainBytesDownloaded = 0;
      let mmProjBytesDownloaded = 0;

      // Check if files already exist
      const mainExists = await RNFS.exists(localPath);
      const mmProjExists = mmProjLocalPath ? await RNFS.exists(mmProjLocalPath) : true;

      if (mainExists && mmProjExists) {
        // All files already downloaded, just add to list
        const model = await this.addDownloadedModel(
          modelId,
          file,
          localPath,
          mmProjLocalPath || undefined,
          file.mmProjFile
        );
        onComplete?.(model);
        return;
      }

      // Download main model file if needed
      if (!mainExists) {
        const downloadUrl = huggingFaceService.getDownloadUrl(modelId, file.name);

        const downloadResult = RNFS.downloadFile({
          fromUrl: downloadUrl,
          toFile: localPath,
          background: true,
          discretionary: true,
          cacheable: false,
          progressInterval: 500,
          progressDivider: 1,
          begin: (res) => {
            console.log('Main model download started:', res);
          },
          progress: (res) => {
            mainBytesDownloaded = res.bytesWritten;
            const progress: DownloadProgress = {
              modelId,
              fileName: file.name,
              bytesDownloaded: mainBytesDownloaded + mmProjBytesDownloaded,
              totalBytes: totalSize,
              progress: (mainBytesDownloaded + mmProjBytesDownloaded) / totalSize,
            };
            onProgress?.(progress);
          },
        });

        // Store the job for cancellation
        this.downloadJobs.set(downloadKey, {
          jobId: downloadResult.jobId,
          cancel: () => RNFS.stopDownload(downloadResult.jobId),
        });

        const result = await downloadResult.promise;

        if (result.statusCode !== 200) {
          this.downloadJobs.delete(downloadKey);
          await RNFS.unlink(localPath).catch(() => { });
          throw new Error(`Main model download failed with status ${result.statusCode}`);
        }

        mainBytesDownloaded = file.size;
      } else {
        mainBytesDownloaded = file.size;
      }

      // Download mmproj file if needed
      if (file.mmProjFile && mmProjLocalPath && !mmProjExists) {
        const mmProjDownloadKey = `${modelId}/${file.mmProjFile.name}`;

        const mmProjDownloadResult = RNFS.downloadFile({
          fromUrl: file.mmProjFile.downloadUrl,
          toFile: mmProjLocalPath,
          background: true,
          discretionary: true,
          cacheable: false,
          progressInterval: 500,
          progressDivider: 1,
          begin: (res) => {
            console.log('MMProj download started:', res);
          },
          progress: (res) => {
            mmProjBytesDownloaded = res.bytesWritten;
            const progress: DownloadProgress = {
              modelId,
              fileName: file.mmProjFile!.name,
              bytesDownloaded: mainBytesDownloaded + mmProjBytesDownloaded,
              totalBytes: totalSize,
              progress: (mainBytesDownloaded + mmProjBytesDownloaded) / totalSize,
            };
            onProgress?.(progress);
          },
        });

        // Update job for mmproj cancellation
        this.downloadJobs.set(mmProjDownloadKey, {
          jobId: mmProjDownloadResult.jobId,
          cancel: () => RNFS.stopDownload(mmProjDownloadResult.jobId),
        });

        const mmProjResult = await mmProjDownloadResult.promise;
        this.downloadJobs.delete(mmProjDownloadKey);

        if (mmProjResult.statusCode !== 200) {
          await RNFS.unlink(mmProjLocalPath).catch(() => { });
          // Don't fail the whole download - just log and continue without mmproj
          console.warn(`MMProj download failed with status ${mmProjResult.statusCode}`);
        }
      }

      // Remove from active jobs
      this.downloadJobs.delete(downloadKey);

      // Check if mmproj was successfully downloaded
      const mmProjFileExists = mmProjLocalPath ? await RNFS.exists(mmProjLocalPath) : false;
      const finalMmProjPath = mmProjLocalPath && mmProjFileExists ? mmProjLocalPath : undefined;

      const model = await this.addDownloadedModel(
        modelId,
        file,
        localPath,
        finalMmProjPath,
        finalMmProjPath ? file.mmProjFile : undefined
      );
      onComplete?.(model);
    } catch (error) {
      this.downloadJobs.delete(downloadKey);
      onError?.(error as Error);
      throw error;
    }
  }

  async cancelDownload(modelId: string, fileName: string): Promise<void> {
    const downloadKey = `${modelId}/${fileName}`;
    const job = this.downloadJobs.get(downloadKey);

    if (job) {
      job.cancel();
      this.downloadJobs.delete(downloadKey);

      // Clean up partial file
      const localPath = `${this.modelsDir}/${fileName}`;
      await RNFS.unlink(localPath).catch(() => { });
    }
  }

  async deleteModel(modelId: string): Promise<void> {
    const models = await this.getDownloadedModels();
    const model = models.find(m => m.id === modelId);

    if (!model) {
      throw new Error('Model not found');
    }

    // Delete the main model file
    await RNFS.unlink(model.filePath);

    // Delete the mmproj file if it exists
    if (model.mmProjPath) {
      await RNFS.unlink(model.mmProjPath).catch(() => {
        console.log('MMProj file already deleted or not found');
      });
    }

    // Update the stored list
    const updatedModels = models.filter(m => m.id !== modelId);
    await this.saveModelsList(updatedModels);
  }

  async getModelPath(modelId: string): Promise<string | null> {
    const models = await this.getDownloadedModels();
    const model = models.find(m => m.id === modelId);
    return model?.filePath || null;
  }

  async getStorageUsed(): Promise<number> {
    const models = await this.getDownloadedModels();
    return models.reduce((total, model) => {
      return total + model.fileSize + (model.mmProjFileSize || 0);
    }, 0);
  }

  async getAvailableStorage(): Promise<number> {
    const freeSpace = await RNFS.getFSInfo();
    return freeSpace.freeSpace;
  }

  /**
   * Find files/directories on disk that aren't tracked in model registries.
   * Scans both the text models directory (for untracked files) and
   * the image models directory (for untracked directories).
   */
  async getOrphanedFiles(): Promise<Array<{ name: string; path: string; size: number }>> {
    await this.initialize();
    const orphaned: Array<{ name: string; path: string; size: number }> = [];

    try {
      // Scan text models directory for untracked files
      const modelsDirExists = await RNFS.exists(this.modelsDir);
      if (modelsDirExists) {
        const files = await RNFS.readDir(this.modelsDir);
        const models = await this.getDownloadedModels();

        // Get all tracked file paths (including mmproj)
        const trackedPaths = new Set<string>();
        for (const model of models) {
          trackedPaths.add(model.filePath);
          if (model.mmProjPath) {
            trackedPaths.add(model.mmProjPath);
          }
        }

        // Find any files not in tracked list (not just .gguf)
        for (const file of files) {
          if (file.isFile() && !trackedPaths.has(file.path)) {
            orphaned.push({
              name: file.name,
              path: file.path,
              size: typeof file.size === 'string' ? parseInt(file.size, 10) : file.size,
            });
          }
        }
      }

      // Scan image models directory for untracked directories
      const imageDirExists = await RNFS.exists(this.imageModelsDir);
      if (imageDirExists) {
        const items = await RNFS.readDir(this.imageModelsDir);
        const imageModels = await this.getDownloadedImageModels();
        const trackedImagePaths = new Set(imageModels.map(m => m.modelPath));

        for (const item of items) {
          if (!trackedImagePaths.has(item.path)) {
            let totalSize = 0;
            if (item.isDirectory()) {
              try {
                const dirFiles = await RNFS.readDir(item.path);
                for (const f of dirFiles) {
                  if (f.isFile()) {
                    totalSize += typeof f.size === 'string' ? parseInt(f.size, 10) : f.size;
                  }
                }
              } catch {
                // Can't read directory, use 0
              }
            } else {
              totalSize = typeof item.size === 'string' ? parseInt(item.size, 10) : item.size;
            }
            orphaned.push({
              name: item.name,
              path: item.path,
              size: totalSize,
            });
          }
        }
      }
    } catch (error) {
      console.error('[ModelManager] Error scanning for orphaned files:', error);
    }

    return orphaned;
  }

  /**
   * Delete an orphaned file or directory from disk.
   */
  async deleteOrphanedFile(filePath: string): Promise<void> {
    try {
      const exists = await RNFS.exists(filePath);
      if (exists) {
        await RNFS.unlink(filePath);
        console.log('[ModelManager] Deleted orphaned file/directory:', filePath);
      }
    } catch (error) {
      console.error('[ModelManager] Failed to delete orphaned file:', error);
      throw error;
    }
  }

  isDownloading(modelId: string, fileName: string): boolean {
    return this.downloadJobs.has(`${modelId}/${fileName}`);
  }

  /**
   * Set callback for persisting background download metadata to app store
   */
  setBackgroundDownloadMetadataCallback(callback: BackgroundDownloadMetadataCallback): void {
    this.backgroundDownloadMetadataCallback = callback;
  }

  /**
   * Check if background downloads are supported (Android only)
   */
  isBackgroundDownloadSupported(): boolean {
    return backgroundDownloadService.isAvailable();
  }

  /**
   * Start a background download using Android's DownloadManager.
   * The download will continue even if the app is killed.
   */
  async downloadModelBackground(
    modelId: string,
    file: ModelFile,
    onProgress?: DownloadProgressCallback,
    onComplete?: DownloadCompleteCallback,
    onError?: DownloadErrorCallback
  ): Promise<BackgroundDownloadInfo> {
    if (!this.isBackgroundDownloadSupported()) {
      throw new Error('Background downloads not supported on this platform');
    }

    await this.initialize();

    const localPath = `${this.modelsDir}/${file.name}`;
    const mmProjLocalPath = file.mmProjFile
      ? `${this.modelsDir}/${file.mmProjFile.name}`
      : null;

    console.log('[ModelManager] Background download - mmProjFile:', file.mmProjFile?.name || 'NONE');

    // Check if files already exist
    const mainExists = await RNFS.exists(localPath);
    const mmProjExists = mmProjLocalPath ? await RNFS.exists(mmProjLocalPath) : true;

    if (mainExists && mmProjExists) {
      const model = await this.addDownloadedModel(
        modelId,
        file,
        localPath,
        mmProjLocalPath || undefined,
        file.mmProjFile
      );
      onComplete?.(model);
      return {
        downloadId: -1,
        fileName: file.name,
        modelId,
        status: 'completed',
        bytesDownloaded: file.size + (file.mmProjFile?.size || 0),
        totalBytes: file.size + (file.mmProjFile?.size || 0),
        startedAt: Date.now(),
        completedAt: Date.now(),
      };
    }

    // Calculate combined total for progress tracking
    const mmProjSize = file.mmProjFile?.size || 0;
    const combinedTotalBytes = file.size + mmProjSize;
    let mmProjDownloaded = mmProjExists ? mmProjSize : 0;

    // Download mmproj file first if needed (foreground with progress)
    if (file.mmProjFile && mmProjLocalPath && !mmProjExists) {
      console.log('[ModelManager] Downloading mmproj file first:', file.mmProjFile.name);
      try {
        const mmProjDownloadResult = RNFS.downloadFile({
          fromUrl: file.mmProjFile.downloadUrl,
          toFile: mmProjLocalPath,
          background: false,
          cacheable: false,
          progressInterval: 500,
          progress: (res) => {
            mmProjDownloaded = res.bytesWritten;
            const progress: DownloadProgress = {
              modelId,
              fileName: `${file.mmProjFile!.name} (vision)`,
              bytesDownloaded: mmProjDownloaded,
              totalBytes: combinedTotalBytes,
              progress: mmProjDownloaded / combinedTotalBytes,
            };
            onProgress?.(progress);
          },
        });
        await mmProjDownloadResult.promise;
        mmProjDownloaded = mmProjSize;
        console.log('[ModelManager] mmproj download complete');
      } catch (mmProjError) {
        console.error('[ModelManager] mmproj download failed:', mmProjError);
        // Continue without mmproj - vision won't work but model will still be usable
      }
    }

    const downloadUrl = huggingFaceService.getDownloadUrl(modelId, file.name);
    const author = modelId.split('/')[0] || 'Unknown';

    // Start background download for main model
    const downloadInfo = await backgroundDownloadService.startDownload({
      url: downloadUrl,
      fileName: file.name,
      modelId,
      title: `Downloading ${file.name}`,
      description: `${modelId} - ${file.quantization}`,
      totalBytes: file.size,
    });

    // Persist metadata for app store (include mmproj info)
    this.backgroundDownloadMetadataCallback?.(downloadInfo.downloadId, {
      modelId,
      fileName: file.name,
      quantization: file.quantization,
      author,
      totalBytes: combinedTotalBytes,
      mmProjFileName: file.mmProjFile?.name,
      mmProjLocalPath: mmProjLocalPath,
    });

    // Set up event listeners - report combined progress
    const removeProgressListener = backgroundDownloadService.onProgress(
      downloadInfo.downloadId,
      (event) => {
        const combinedDownloaded = mmProjDownloaded + event.bytesDownloaded;
        const progressPercent = combinedTotalBytes > 0 ? (combinedDownloaded / combinedTotalBytes * 100).toFixed(1) : 0;
        // Log at 95%+ to avoid spam
        if (Number(progressPercent) >= 95) {
          console.log(`[ModelManager] Download progress: ${progressPercent}%, status: ${event.status}, bytes: ${combinedDownloaded}/${combinedTotalBytes}`);
        }
        const progress: DownloadProgress = {
          modelId,
          fileName: file.name,
          bytesDownloaded: combinedDownloaded,
          totalBytes: combinedTotalBytes,
          progress: combinedTotalBytes > 0 ? combinedDownloaded / combinedTotalBytes : 0,
        };
        onProgress?.(progress);
      }
    );

    const removeCompleteListener = backgroundDownloadService.onComplete(
      downloadInfo.downloadId,
      async (event) => {
        console.log('[ModelManager] DownloadComplete event received:', event.downloadId, event.fileName);
        removeProgressListener();
        removeCompleteListener();
        removeErrorListener();

        try {
          console.log('[ModelManager] Moving completed download to:', localPath);
          // Move file to models directory
          const finalPath = await backgroundDownloadService.moveCompletedDownload(
            event.downloadId,
            localPath
          );
          console.log('[ModelManager] File moved to:', finalPath);

          // Check if mmproj was downloaded
          const mmProjFileExists = mmProjLocalPath ? await RNFS.exists(mmProjLocalPath) : false;
          const finalMmProjPath = mmProjLocalPath && mmProjFileExists ? mmProjLocalPath : undefined;

          console.log('[ModelManager] Background download complete, mmProjPath:', finalMmProjPath || 'NONE');

          // Add to downloaded models list with mmproj info
          const model = await this.addDownloadedModel(
            modelId,
            file,
            finalPath,
            finalMmProjPath,
            finalMmProjPath ? file.mmProjFile : undefined
          );

          // Clear metadata
          this.backgroundDownloadMetadataCallback?.(event.downloadId, null);

          onComplete?.(model);
        } catch (error) {
          console.error('Error finalizing background download:', error);
          onError?.(error as Error);
        }
      }
    );

    const removeErrorListener = backgroundDownloadService.onError(
      downloadInfo.downloadId,
      (event) => {
        console.log('[ModelManager] DownloadError event received:', event.downloadId, event.reason);
        removeProgressListener();
        removeCompleteListener();
        removeErrorListener();

        // Clear metadata
        this.backgroundDownloadMetadataCallback?.(event.downloadId, null);

        onError?.(new Error(event.reason || 'Download failed'));
      }
    );

    // Start polling after listeners are attached
    backgroundDownloadService.startProgressPolling();

    return downloadInfo;
  }

  /**
   * Cancel a background download
   */
  async cancelBackgroundDownload(downloadId: number): Promise<void> {
    if (!this.isBackgroundDownloadSupported()) {
      throw new Error('Background downloads not supported on this platform');
    }

    await backgroundDownloadService.cancelDownload(downloadId);
    this.backgroundDownloadMetadataCallback?.(downloadId, null);
  }

  /**
   * Sync background downloads completed while app was dead.
   * Call this on app startup.
   */
  async syncBackgroundDownloads(
    persistedDownloads: Record<number, {
      modelId: string;
      fileName: string;
      quantization: string;
      author: string;
      totalBytes: number;
    }>,
    clearDownloadCallback: (downloadId: number) => void
  ): Promise<DownloadedModel[]> {
    if (!this.isBackgroundDownloadSupported()) {
      return [];
    }

    await this.initialize();

    const completedModels: DownloadedModel[] = [];
    const activeDownloads = await backgroundDownloadService.getActiveDownloads();

    for (const download of activeDownloads) {
      const metadata = persistedDownloads[download.downloadId];
      if (!metadata) {
        continue;
      }

      if (download.status === 'completed') {
        try {
          const localPath = `${this.modelsDir}/${metadata.fileName}`;

          // Move file to models directory
          await backgroundDownloadService.moveCompletedDownload(
            download.downloadId,
            localPath
          );

          // Create model file info for addDownloadedModel
          const fileInfo: ModelFile = {
            name: metadata.fileName,
            size: metadata.totalBytes,
            quantization: metadata.quantization,
            downloadUrl: '',
          };

          const model = await this.addDownloadedModel(
            metadata.modelId,
            fileInfo,
            localPath
          );

          completedModels.push(model);
          clearDownloadCallback(download.downloadId);
        } catch (error) {
          console.error('Error syncing completed download:', error);
        }
      } else if (download.status === 'failed') {
        // Clear failed downloads
        clearDownloadCallback(download.downloadId);
      }
      // Running/pending downloads are left as-is for the UI to track
    }

    return completedModels;
  }

  /**
   * Get active background downloads with their current status
   */
  async getActiveBackgroundDownloads(): Promise<BackgroundDownloadInfo[]> {
    if (!this.isBackgroundDownloadSupported()) {
      return [];
    }

    return await backgroundDownloadService.getActiveDownloads();
  }

  /**
   * Start or resume polling for background download progress
   */
  startBackgroundDownloadPolling(): void {
    if (this.isBackgroundDownloadSupported()) {
      backgroundDownloadService.startProgressPolling();
    }
  }

  /**
   * Stop polling for background download progress
   */
  stopBackgroundDownloadPolling(): void {
    if (this.isBackgroundDownloadSupported()) {
      backgroundDownloadService.stopProgressPolling();
    }
  }

  private determineCredibility(author: string): ModelCredibility {
    // Check if from LM Studio community (highest credibility for GGUF)
    if (LMSTUDIO_AUTHORS.includes(author)) {
      return {
        source: 'lmstudio',
        isOfficial: false,
        isVerifiedQuantizer: true,
        verifiedBy: 'LM Studio',
      };
    }

    // Check if from official model creator
    if (OFFICIAL_MODEL_AUTHORS[author]) {
      return {
        source: 'official',
        isOfficial: true,
        isVerifiedQuantizer: false,
        verifiedBy: OFFICIAL_MODEL_AUTHORS[author],
      };
    }

    // Check if from verified quantizer
    if (VERIFIED_QUANTIZERS[author]) {
      return {
        source: 'verified-quantizer',
        isOfficial: false,
        isVerifiedQuantizer: true,
        verifiedBy: VERIFIED_QUANTIZERS[author],
      };
    }

    // Community/unknown source
    return {
      source: 'community',
      isOfficial: false,
      isVerifiedQuantizer: false,
    };
  }

  private async addDownloadedModel(
    modelId: string,
    file: ModelFile,
    localPath: string,
    mmProjPath?: string,
    mmProjFile?: { name: string; size: number }
  ): Promise<DownloadedModel> {
    const stat = await RNFS.stat(localPath);
    const author = modelId.split('/')[0] || 'Unknown';

    const model: DownloadedModel = {
      id: `${modelId}/${file.name}`,
      name: modelId.split('/').pop() || modelId,
      author,
      filePath: localPath,
      fileName: file.name,
      fileSize: typeof stat.size === 'string' ? parseInt(stat.size, 10) : stat.size,
      quantization: file.quantization,
      downloadedAt: new Date().toISOString(),
      credibility: this.determineCredibility(author),
      // Vision model support
      isVisionModel: !!mmProjPath,
      mmProjPath,
      mmProjFileName: mmProjFile?.name,
      mmProjFileSize: mmProjFile?.size,
    };

    const models = await this.getDownloadedModels();

    // Check if already in list
    const existingIndex = models.findIndex(m => m.id === model.id);
    if (existingIndex >= 0) {
      models[existingIndex] = model;
    } else {
      models.push(model);
    }

    await this.saveModelsList(models);
    return model;
  }

  private async saveModelsList(models: DownloadedModel[]): Promise<void> {
    await AsyncStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(models));
  }

  /**
   * Update a model's mmproj info and persist to storage.
   * Called when activeModelService discovers an mmproj file at runtime.
   */
  async saveModelWithMmproj(modelId: string, mmProjPath: string, mmProjFileName: string, mmProjFileSize: number | string): Promise<void> {
    const models = await this.getDownloadedModels();
    const updatedModels = models.map(m => {
      if (m.id === modelId) {
        return {
          ...m,
          mmProjPath,
          mmProjFileName,
          mmProjFileSize: typeof mmProjFileSize === 'string' ? parseInt(mmProjFileSize, 10) : mmProjFileSize,
          isVisionModel: true,
        };
      }
      return m;
    });
    await this.saveModelsList(updatedModels);
    console.log('[ModelManager] Saved mmproj info for model:', modelId);
  }

  /**
   * Check if a filename looks like an mmproj/projector file (not a standalone model)
   */
  private isMMProjFile(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    return lower.includes('mmproj') ||
      lower.includes('projector') ||
      (lower.includes('clip') && lower.endsWith('.gguf'));
  }

  /**
   * Clean up any mmproj files that were incorrectly added as standalone models,
   * and link orphaned mmproj files with their parent vision models.
   * Call this on app startup to fix any legacy data.
   */
  async cleanupMMProjEntries(): Promise<number> {
    const models = await this.getDownloadedModels();

    // First, remove mmproj entries from the model list
    const cleanedModels = models.filter(m => !this.isMMProjFile(m.fileName));
    const removedCount = models.length - cleanedModels.length;

    if (removedCount > 0) {
      console.log(`[ModelManager] Removing ${removedCount} mmproj entries from model list`);
    }

    // Now, scan for orphaned mmproj files and link them with parent models
    try {
      const dirExists = await RNFS.exists(this.modelsDir);
      if (dirExists) {
        const files = await RNFS.readDir(this.modelsDir);
        const mmProjFiles = files.filter(f => f.isFile() && this.isMMProjFile(f.name));

        console.log(`[ModelManager] Found ${mmProjFiles.length} mmproj files on disk`);

        // For each vision model without an mmProjPath, try to find a matching mmproj
        for (const model of cleanedModels) {
          if (model.mmProjPath) {
            // Already has mmproj linked
            continue;
          }

          // Check if this model name suggests it's a vision model
          const modelNameLower = model.name.toLowerCase();
          const fileNameLower = model.fileName.toLowerCase();
          const looksLikeVision = modelNameLower.includes('vl') ||
            modelNameLower.includes('vision') ||
            modelNameLower.includes('smolvlm') ||
            fileNameLower.includes('vl') ||
            fileNameLower.includes('vision');

          console.log(`[ModelManager] Checking model "${model.name}" (${model.fileName}) - looksLikeVision: ${looksLikeVision}`);

          if (!looksLikeVision) {
            continue;
          }

          // Try to find a matching mmproj file
          // Extract base model name for matching (e.g., "Qwen3VL-2B-Instruct" from "Qwen3VL-2B-Instruct-Q4_K_M.gguf")
          const baseNameMatch = model.fileName.match(/^(.+?)[-_](?:Q\d|q\d|F\d|f\d)/i);
          const baseName = baseNameMatch ? baseNameMatch[1].toLowerCase() : model.fileName.toLowerCase().replace('.gguf', '');

          console.log(`[ModelManager] Looking for mmproj match - baseName: "${baseName}"`);

          for (const mmProjFile of mmProjFiles) {
            const mmProjLower = mmProjFile.name.toLowerCase();
            const noSeparators = baseName.replace(/-/g, '').replace(/_/g, '');
            console.log(`[ModelManager] Comparing with mmproj "${mmProjFile.name}" - checking "${noSeparators}" or "${baseName}"`);

            // Check if the mmproj file name contains the base model name
            if (mmProjLower.includes(noSeparators) || mmProjLower.includes(baseName)) {
              console.log(`[ModelManager] ✓ Linking mmproj "${mmProjFile.name}" with model "${model.name}"`);
              model.mmProjPath = mmProjFile.path;
              model.mmProjFileName = mmProjFile.name;
              model.mmProjFileSize = typeof mmProjFile.size === 'string' ? parseInt(mmProjFile.size, 10) : mmProjFile.size;
              model.isVisionModel = true;
              break;
            } else {
              console.log(`[ModelManager] ✗ No match`);
            }
          }
        }
      }
    } catch (error) {
      console.error('[ModelManager] Error scanning for mmproj files:', error);
    }

    await this.saveModelsList(cleanedModels);
    return removedCount;
  }

  // ============== Image Model Management ==============

  /**
   * Get all downloaded ONNX image models
   */
  async getDownloadedImageModels(): Promise<ONNXImageModel[]> {
    try {
      const stored = await AsyncStorage.getItem(IMAGE_MODELS_STORAGE_KEY);
      if (!stored) return [];

      const models: ONNXImageModel[] = JSON.parse(stored);

      // Verify model directories still exist (re-resolve paths for sandbox UUID changes on iOS simulator)
      const validModels: ONNXImageModel[] = [];
      let pathsUpdated = false;
      for (const model of models) {
        let exists = await RNFS.exists(model.modelPath);
        if (!exists) {
          // Try re-resolving against current DocumentDirectoryPath (handles iOS sandbox UUID changes)
          const resolvedPath = this.resolveStoredPath(model.modelPath, this.imageModelsDir);
          if (resolvedPath && resolvedPath !== model.modelPath) {
            exists = await RNFS.exists(resolvedPath);
            if (exists) {
              console.log(`[ModelManager] Re-resolved image model path: ${model.modelPath} -> ${resolvedPath}`);
              model.modelPath = resolvedPath;
              pathsUpdated = true;
            }
          }
        }
        if (exists) {
          validModels.push(model);
        } else {
          console.warn(`[ModelManager] Removing image model "${model.id}" — path not found: ${model.modelPath}`);
        }
      }

      // Update storage if we removed any invalid entries or updated paths
      if (validModels.length !== models.length || pathsUpdated) {
        await this.saveImageModelsList(validModels);
      }

      return validModels;
    } catch (error) {
      console.error('Error loading downloaded image models:', error);
      return [];
    }
  }

  /**
   * Add a downloaded image model to the registry
   */
  async addDownloadedImageModel(model: ONNXImageModel): Promise<void> {
    const models = await this.getDownloadedImageModels();

    // Check if already exists
    const existingIndex = models.findIndex(m => m.id === model.id);
    if (existingIndex >= 0) {
      models[existingIndex] = model;
    } else {
      models.push(model);
    }

    await this.saveImageModelsList(models);
  }

  /**
   * Delete an image model and its files
   */
  async deleteImageModel(modelId: string): Promise<void> {
    const models = await this.getDownloadedImageModels();
    const model = models.find(m => m.id === modelId);

    if (!model) {
      throw new Error('Image model not found');
    }

    // Delete the model directory
    if (await RNFS.exists(model.modelPath)) {
      await RNFS.unlink(model.modelPath);
    }

    // Update the stored list
    const updatedModels = models.filter(m => m.id !== modelId);
    await this.saveImageModelsList(updatedModels);
  }

  /**
   * Get path for an image model
   */
  async getImageModelPath(modelId: string): Promise<string | null> {
    const models = await this.getDownloadedImageModels();
    const model = models.find(m => m.id === modelId);
    return model?.modelPath || null;
  }

  /**
   * Get storage used by image models
   */
  async getImageModelsStorageUsed(): Promise<number> {
    const models = await this.getDownloadedImageModels();
    return models.reduce((total, model) => total + model.size, 0);
  }

  /**
   * Get the directory where image models are stored
   */
  getImageModelsDirectory(): string {
    return this.imageModelsDir;
  }

  private async saveImageModelsList(models: ONNXImageModel[]): Promise<void> {
    await AsyncStorage.setItem(IMAGE_MODELS_STORAGE_KEY, JSON.stringify(models));
  }

  /**
   * Scan the image models directory for untracked models.
   * This is useful when a download completed but the app was killed before
   * the model was added to the registry.
   * Returns any newly discovered models that were added to the registry.
   */
  async scanForUntrackedImageModels(): Promise<ONNXImageModel[]> {
    await this.initialize();

    const discoveredModels: ONNXImageModel[] = [];
    const registeredModels = await this.getDownloadedImageModels();
    const registeredPaths = new Set(registeredModels.map(m => m.modelPath));

    try {
      // Check if image models directory exists
      const dirExists = await RNFS.exists(this.imageModelsDir);
      if (!dirExists) {
        return [];
      }

      // List all items in the image models directory
      const items = await RNFS.readDir(this.imageModelsDir);

      for (const item of items) {
        // Skip if not a directory or already registered
        if (!item.isDirectory() || registeredPaths.has(item.path)) {
          continue;
        }

        // Check if this looks like a valid model directory
        // LocalDream models typically have a specific structure
        const modelDirName = item.name;
        const modelPath = item.path;

        // Try to get directory size
        let totalSize = 0;
        try {
          const modelFiles = await RNFS.readDir(modelPath);
          for (const file of modelFiles) {
            if (file.isFile()) {
              const fileSize = typeof file.size === 'string' ? parseInt(file.size, 10) : file.size;
              totalSize += fileSize;
            }
          }
        } catch {
          // Skip if we can't read the directory
          continue;
        }

        // Only add if it has some content
        if (totalSize > 0) {
          // Determine backend based on directory name patterns
          const backend: 'mnn' | 'qnn' | 'auto' = modelDirName.includes('qnn') || modelDirName.includes('8gen')
            ? 'qnn'
            : modelDirName.includes('mnn')
              ? 'mnn'
              : 'auto';

          const newModel: ONNXImageModel = {
            id: `recovered_${modelDirName}_${Date.now()}`,
            name: modelDirName.replace(/_/g, ' ').replace(/\.(zip|tar|gz)$/i, ''),
            modelPath,
            size: totalSize,
            downloadedAt: new Date().toISOString(),
            backend,
          };

          await this.addDownloadedImageModel(newModel);
          discoveredModels.push(newModel);
          console.log('[ModelManager] Discovered untracked image model:', newModel.name);
        }
      }
    } catch (error) {
      console.error('[ModelManager] Error scanning for untracked models:', error);
    }

    return discoveredModels;
  }

  /**
   * Scan the text models directory for untracked GGUF files.
   * Returns any newly discovered models that were added to the registry.
   */
  async scanForUntrackedTextModels(): Promise<DownloadedModel[]> {
    await this.initialize();

    const discoveredModels: DownloadedModel[] = [];
    const registeredModels = await this.getDownloadedModels();
    const registeredPaths = new Set(registeredModels.map(m => m.filePath));

    try {
      // Check if models directory exists
      const dirExists = await RNFS.exists(this.modelsDir);
      if (!dirExists) {
        return [];
      }

      // List all files in the models directory
      const items = await RNFS.readDir(this.modelsDir);

      for (const item of items) {
        // Skip if not a file, not a GGUF, already registered, or is an mmproj file
        const lowerName = item.name.toLowerCase();
        const isMMProj = lowerName.includes('mmproj') || lowerName.includes('projector') ||
          (lowerName.includes('clip') && lowerName.endsWith('.gguf'));
        if (!item.isFile() || !item.name.endsWith('.gguf') || registeredPaths.has(item.path) || isMMProj) {
          continue;
        }

        const fileSize = typeof item.size === 'string' ? parseInt(item.size, 10) : item.size;

        // Skip tiny files (< 1MB) — likely partial/failed downloads, not valid models
        if (fileSize < 1_000_000) {
          console.log(`[ModelManager] Skipping tiny file as likely partial download: ${item.name} (${fileSize} bytes)`);
          continue;
        }

        // Try to parse quantization from filename
        const quantMatch = item.name.match(/[_-](Q\d+[_\w]*|f16|f32)/i);
        const quantization = quantMatch ? quantMatch[1].toUpperCase() : 'Unknown';

        const newModel: DownloadedModel = {
          id: `recovered_${item.name}_${Date.now()}`,
          name: item.name.replace(/\.gguf$/i, '').replace(/[_-]Q\d+.*/i, ''),
          author: 'Unknown',
          filePath: item.path,
          fileName: item.name,
          fileSize,
          quantization,
          downloadedAt: new Date().toISOString(),
          credibility: {
            source: 'community',
            isOfficial: false,
            isVerifiedQuantizer: false,
          },
        };

        // Add to registry
        const models = await this.getDownloadedModels();
        models.push(newModel);
        await this.saveModelsList(models);

        discoveredModels.push(newModel);
        console.log('[ModelManager] Discovered untracked text model:', newModel.name);
      }
    } catch (error) {
      console.error('[ModelManager] Error scanning for untracked text models:', error);
    }

    return discoveredModels;
  }

  /**
   * Force refresh of model lists by scanning file system.
   * Call this when models may have been added externally.
   */
  async refreshModelLists(): Promise<{ textModels: DownloadedModel[]; imageModels: ONNXImageModel[] }> {
    // Scan for untracked models first
    await this.scanForUntrackedTextModels();
    await this.scanForUntrackedImageModels();

    // Then return the full lists
    return {
      textModels: await this.getDownloadedModels(),
      imageModels: await this.getDownloadedImageModels(),
    };
  }
}

export const modelManager = new ModelManager();
