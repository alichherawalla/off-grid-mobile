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
  info: { modelId: string; fileName: string; quantization: string; author: string; totalBytes: number } | null
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

      // Verify files still exist
      const validModels: DownloadedModel[] = [];
      for (const model of models) {
        const exists = await RNFS.exists(model.filePath);
        if (exists) {
          validModels.push(model);
        }
      }

      // Update storage if we removed any invalid entries
      if (validModels.length !== models.length) {
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
          await RNFS.unlink(localPath).catch(() => {});
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
          await RNFS.unlink(mmProjLocalPath).catch(() => {});
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
      await RNFS.unlink(localPath).catch(() => {});
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

    // Check if file already exists
    const exists = await RNFS.exists(localPath);
    if (exists) {
      const model = await this.addDownloadedModel(modelId, file, localPath);
      onComplete?.(model);
      return {
        downloadId: -1,
        fileName: file.name,
        modelId,
        status: 'completed',
        bytesDownloaded: file.size,
        totalBytes: file.size,
        startedAt: Date.now(),
        completedAt: Date.now(),
      };
    }

    const downloadUrl = huggingFaceService.getDownloadUrl(modelId, file.name);
    const author = modelId.split('/')[0] || 'Unknown';

    // Start background download
    const downloadInfo = await backgroundDownloadService.startDownload({
      url: downloadUrl,
      fileName: file.name,
      modelId,
      title: `Downloading ${file.name}`,
      description: `${modelId} - ${file.quantization}`,
      totalBytes: file.size,
    });

    // Persist metadata for app store
    this.backgroundDownloadMetadataCallback?.(downloadInfo.downloadId, {
      modelId,
      fileName: file.name,
      quantization: file.quantization,
      author,
      totalBytes: file.size,
    });

    // Set up event listeners
    const removeProgressListener = backgroundDownloadService.onProgress(
      downloadInfo.downloadId,
      (event) => {
        const progress: DownloadProgress = {
          modelId,
          fileName: file.name,
          bytesDownloaded: event.bytesDownloaded,
          totalBytes: event.totalBytes || file.size,
          progress: event.totalBytes > 0 ? event.bytesDownloaded / event.totalBytes : 0,
        };
        onProgress?.(progress);
      }
    );

    const removeCompleteListener = backgroundDownloadService.onComplete(
      downloadInfo.downloadId,
      async (event) => {
        removeProgressListener();
        removeCompleteListener();
        removeErrorListener();

        try {
          // Move file to models directory
          const finalPath = await backgroundDownloadService.moveCompletedDownload(
            event.downloadId,
            localPath
          );

          // Add to downloaded models list
          const model = await this.addDownloadedModel(modelId, file, finalPath);

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
        removeProgressListener();
        removeCompleteListener();
        removeErrorListener();

        // Clear metadata
        this.backgroundDownloadMetadataCallback?.(event.downloadId, null);

        onError?.(new Error(event.reason || 'Download failed'));
      }
    );

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

  // ============== Image Model Management ==============

  /**
   * Get all downloaded ONNX image models
   */
  async getDownloadedImageModels(): Promise<ONNXImageModel[]> {
    try {
      const stored = await AsyncStorage.getItem(IMAGE_MODELS_STORAGE_KEY);
      if (!stored) return [];

      const models: ONNXImageModel[] = JSON.parse(stored);

      // Verify model directories still exist
      const validModels: ONNXImageModel[] = [];
      for (const model of models) {
        const exists = await RNFS.exists(model.modelPath);
        if (exists) {
          validModels.push(model);
        }
      }

      // Update storage if we removed any invalid entries
      if (validModels.length !== models.length) {
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
}

export const modelManager = new ModelManager();
