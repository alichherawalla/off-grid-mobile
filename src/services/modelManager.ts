import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DownloadedModel, DownloadProgress, ModelFile, ModelCredibility } from '../types';
import { APP_CONFIG, LMSTUDIO_AUTHORS, OFFICIAL_MODEL_AUTHORS, VERIFIED_QUANTIZERS } from '../constants';
import { huggingFaceService } from './huggingface';

const MODELS_STORAGE_KEY = '@local_llm/downloaded_models';

type DownloadProgressCallback = (progress: DownloadProgress) => void;
type DownloadCompleteCallback = (model: DownloadedModel) => void;
type DownloadErrorCallback = (error: Error) => void;

class ModelManager {
  private modelsDir: string;
  private downloadJobs: Map<string, { jobId: number; cancel: () => void }> = new Map();

  constructor() {
    this.modelsDir = `${RNFS.DocumentDirectoryPath}/${APP_CONFIG.modelStorageDir}`;
  }

  async initialize(): Promise<void> {
    // Ensure models directory exists
    const exists = await RNFS.exists(this.modelsDir);
    if (!exists) {
      await RNFS.mkdir(this.modelsDir);
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

      // Check if file already exists
      const exists = await RNFS.exists(localPath);
      if (exists) {
        // Model already downloaded, just add to list
        const model = await this.addDownloadedModel(modelId, file, localPath);
        onComplete?.(model);
        return;
      }

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
          console.log('Download started:', res);
        },
        progress: (res) => {
          const progress: DownloadProgress = {
            modelId,
            fileName: file.name,
            bytesDownloaded: res.bytesWritten,
            totalBytes: res.contentLength,
            progress: res.bytesWritten / res.contentLength,
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

      // Remove from active jobs
      this.downloadJobs.delete(downloadKey);

      if (result.statusCode === 200) {
        const model = await this.addDownloadedModel(modelId, file, localPath);
        onComplete?.(model);
      } else {
        // Clean up partial download
        await RNFS.unlink(localPath).catch(() => {});
        throw new Error(`Download failed with status ${result.statusCode}`);
      }
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

    // Delete the file
    await RNFS.unlink(model.filePath);

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
    return models.reduce((total, model) => total + model.fileSize, 0);
  }

  async getAvailableStorage(): Promise<number> {
    const freeSpace = await RNFS.getFSInfo();
    return freeSpace.freeSpace;
  }

  isDownloading(modelId: string, fileName: string): boolean {
    return this.downloadJobs.has(`${modelId}/${fileName}`);
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
    localPath: string
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
}

export const modelManager = new ModelManager();
