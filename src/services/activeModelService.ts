/**
 * ActiveModelService - Singleton for managing active models throughout the app
 * THIS IS THE ONLY PLACE MODELS SHOULD BE LOADED/UNLOADED FROM
 * All other code should use this service, never call llmService/onnxImageGeneratorService directly
 */

import { llmService } from './llm';
import { onnxImageGeneratorService } from './onnxImageGenerator';
import { modelManager } from './modelManager';
import { hardwareService } from './hardware';
import { useAppStore } from '../stores';
import { DownloadedModel, ONNXImageModel } from '../types';

export type ModelType = 'text' | 'image';

export interface ActiveModelInfo {
  text: {
    model: DownloadedModel | null;
    isLoaded: boolean;
    isLoading: boolean;
  };
  image: {
    model: ONNXImageModel | null;
    isLoaded: boolean;
    isLoading: boolean;
  };
}

export interface ResourceUsage {
  memoryUsed: number;
  memoryTotal: number;
  memoryAvailable: number;
  memoryUsagePercent: number;
  estimatedModelMemory: number; // Estimated memory used by loaded models (from file sizes)
}

type ModelChangeListener = (info: ActiveModelInfo) => void;

class ActiveModelService {
  private listeners: Set<ModelChangeListener> = new Set();
  private loadingState = {
    text: false,
    image: false,
  };
  // Track what's actually loaded to prevent duplicate loads
  private loadedTextModelId: string | null = null;
  private loadedImageModelId: string | null = null;
  private loadedImageModelThreads: number | null = null;
  // Promises to prevent concurrent load attempts
  private textLoadPromise: Promise<void> | null = null;
  private imageLoadPromise: Promise<void> | null = null;

  /**
   * Get current active model info
   */
  getActiveModels(): ActiveModelInfo {
    const store = useAppStore.getState();
    const textModel = store.downloadedModels.find(m => m.id === store.activeModelId) || null;
    const imageModel = store.downloadedImageModels.find(m => m.id === store.activeImageModelId) || null;

    return {
      text: {
        model: textModel,
        isLoaded: llmService.isModelLoaded(),
        isLoading: this.loadingState.text,
      },
      image: {
        model: imageModel,
        isLoaded: !!store.activeImageModelId,
        isLoading: this.loadingState.image,
      },
    };
  }

  /**
   * Check if any model is currently loaded
   */
  hasAnyModelLoaded(): boolean {
    const info = this.getActiveModels();
    return info.text.isLoaded || info.image.isLoaded;
  }

  /**
   * Load a text model - THIS IS THE ONLY PLACE TEXT MODELS SHOULD BE LOADED
   * Guards against duplicate loading and concurrent load attempts
   */
  async loadTextModel(modelId: string): Promise<void> {
    // Already loaded this exact model - no-op
    if (this.loadedTextModelId === modelId && llmService.isModelLoaded()) {
      console.log('[ActiveModelService] Text model already loaded:', modelId);
      return;
    }

    // If already loading, wait for that to complete
    if (this.textLoadPromise) {
      console.log('[ActiveModelService] Text model load already in progress, waiting...');
      await this.textLoadPromise;
      // Check if the completed load was for our model
      if (this.loadedTextModelId === modelId) {
        return;
      }
    }

    const store = useAppStore.getState();
    const model = store.downloadedModels.find(m => m.id === modelId);
    if (!model) throw new Error('Model not found');

    this.loadingState.text = true;
    this.notifyListeners();

    // Create and track the load promise
    this.textLoadPromise = (async () => {
      try {
        // Unload existing model first if different
        if (this.loadedTextModelId && this.loadedTextModelId !== modelId) {
          console.log('[ActiveModelService] Unloading previous text model:', this.loadedTextModelId);
          await llmService.unloadModel();
          this.loadedTextModelId = null;
        }

        console.log('[ActiveModelService] Loading text model:', modelId);
        await llmService.loadModel(model.filePath, model.mmProjPath);
        this.loadedTextModelId = modelId;
        store.setActiveModelId(modelId);
        console.log('[ActiveModelService] Text model loaded successfully:', modelId);
      } finally {
        this.loadingState.text = false;
        this.textLoadPromise = null;
        this.notifyListeners();
      }
    })();

    await this.textLoadPromise;
  }

  /**
   * Unload the current text model
   */
  async unloadTextModel(): Promise<void> {
    // Wait for any pending load to complete first
    if (this.textLoadPromise) {
      await this.textLoadPromise;
    }

    if (!this.loadedTextModelId && !llmService.isModelLoaded()) {
      console.log('[ActiveModelService] No text model loaded to unload');
      return;
    }

    this.loadingState.text = true;
    this.notifyListeners();

    try {
      console.log('[ActiveModelService] Unloading text model:', this.loadedTextModelId);
      await llmService.unloadModel();
      this.loadedTextModelId = null;
      useAppStore.getState().setActiveModelId(null);
      console.log('[ActiveModelService] Text model unloaded');
    } finally {
      this.loadingState.text = false;
      this.notifyListeners();
    }
  }

  /**
   * Load an image model - THIS IS THE ONLY PLACE IMAGE MODELS SHOULD BE LOADED
   * Guards against duplicate loading and concurrent load attempts
   * Timeout is 3 minutes to allow for first-time optimization (subsequent loads are faster)
   */
  async loadImageModel(modelId: string, timeoutMs: number = 180000): Promise<void> {
    const store = useAppStore.getState();
    const imageThreads = store.settings?.imageThreads ?? 4;

    const needsThreadReload =
      this.loadedImageModelId === modelId && this.loadedImageModelThreads !== imageThreads;

    // Already loaded this exact model - no-op
    if (this.loadedImageModelId === modelId) {
      const isLoaded = await onnxImageGeneratorService.isModelLoaded();
      if (isLoaded && !needsThreadReload) {
        console.log('[ActiveModelService] Image model already loaded:', modelId);
        return;
      }
    }

    // If already loading, wait for that to complete
    if (this.imageLoadPromise) {
      console.log('[ActiveModelService] Image model load already in progress, waiting...');
      await this.imageLoadPromise;
      // Check if the completed load was for our model
      if (this.loadedImageModelId === modelId && this.loadedImageModelThreads === imageThreads) {
        return;
      }
    }

    const model = store.downloadedImageModels.find(m => m.id === modelId);
    if (!model) throw new Error('Model not found');

    this.loadingState.image = true;
    this.notifyListeners();

    // Create and track the load promise
    this.imageLoadPromise = (async () => {
      try {
        // Unload existing model first if different
        if (this.loadedImageModelId && (this.loadedImageModelId !== modelId || needsThreadReload)) {
          console.log('[ActiveModelService] Unloading previous image model:', this.loadedImageModelId);
          await onnxImageGeneratorService.unloadModel();
          this.loadedImageModelId = null;
          this.loadedImageModelThreads = null;
        }

        console.log('[ActiveModelService] Loading image model:', modelId);

        // Add timeout to prevent hanging forever
        const loadPromise = onnxImageGeneratorService.loadModel(model.modelPath, imageThreads);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Image model loading timed out')), timeoutMs);
        });

        await Promise.race([loadPromise, timeoutPromise]);
        this.loadedImageModelId = modelId;
        this.loadedImageModelThreads = imageThreads;
        store.setActiveImageModelId(modelId);
        console.log('[ActiveModelService] Image model loaded successfully:', modelId);
      } catch (error) {
        console.error('[ActiveModelService] Failed to load image model:', error);
        this.loadedImageModelId = null;
        this.loadedImageModelThreads = null;
        throw error;
      } finally {
        this.loadingState.image = false;
        this.imageLoadPromise = null;
        this.notifyListeners();
      }
    })();

    await this.imageLoadPromise;
  }

  /**
   * Unload the current image model
   */
  async unloadImageModel(): Promise<void> {
    // Wait for any pending load to complete first
    if (this.imageLoadPromise) {
      await this.imageLoadPromise;
    }

    const store = useAppStore.getState();
    const hasSelectedImageModel = !!store.activeImageModelId;
    const isImageModelLoaded = await onnxImageGeneratorService.isModelLoaded();

    if (!this.loadedImageModelId && !hasSelectedImageModel && !isImageModelLoaded) {
      console.log('[ActiveModelService] No image model loaded to unload');
      return;
    }

    this.loadingState.image = true;
    this.notifyListeners();

    try {
      if (isImageModelLoaded) {
        console.log('[ActiveModelService] Unloading image model:', this.loadedImageModelId);
        await onnxImageGeneratorService.unloadModel();
      }
      this.loadedImageModelId = null;
      this.loadedImageModelThreads = null;
      store.setActiveImageModelId(null);
      console.log('[ActiveModelService] Image model unloaded');
    } finally {
      this.loadingState.image = false;
      this.notifyListeners();
    }
  }

  /**
   * Unload all models (eject all)
   */
  async unloadAllModels(): Promise<{ textUnloaded: boolean; imageUnloaded: boolean }> {
    const info = this.getActiveModels();
    const results = { textUnloaded: false, imageUnloaded: false };

    const promises: Promise<void>[] = [];

    if (info.text.isLoaded) {
      promises.push(
        this.unloadTextModel().then(() => {
          results.textUnloaded = true;
        })
      );
    }

    if (info.image.isLoaded) {
      promises.push(
        this.unloadImageModel().then(() => {
          results.imageUnloaded = true;
        })
      );
    }

    await Promise.all(promises);
    return results;
  }

  /**
   * Get current resource usage with estimated model memory
   */
  async getResourceUsage(): Promise<ResourceUsage> {
    const info = await hardwareService.refreshMemoryInfo();
    const usagePercent = ((info.usedMemory / info.totalMemory) * 100);

    // Calculate estimated model memory from file sizes of loaded models
    const estimatedModelMemory = this.getEstimatedModelMemory();

    return {
      memoryUsed: info.usedMemory,
      memoryTotal: info.totalMemory,
      memoryAvailable: info.availableMemory,
      memoryUsagePercent: usagePercent,
      estimatedModelMemory,
    };
  }

  /**
   * Estimate memory used by loaded models based on file sizes
   * Note: Actual memory may be higher due to KV cache, activations, etc.
   */
  private getEstimatedModelMemory(): number {
    const store = useAppStore.getState();
    let totalMemory = 0;

    // Text model memory (file size + ~20% overhead for KV cache/buffers)
    if (store.activeModelId) {
      const textModel = store.downloadedModels.find(m => m.id === store.activeModelId);
      if (textModel?.fileSize) {
        totalMemory += textModel.fileSize * 1.2; // 20% overhead
      }
    }

    // Image model memory (file size + ~30% overhead for ONNX runtime)
    if (store.activeImageModelId) {
      const imageModel = store.downloadedImageModels.find(m => m.id === store.activeImageModelId);
      if (imageModel?.size) {
        totalMemory += imageModel.size * 1.3; // 30% overhead
      }
    }

    return totalMemory;
  }

  /**
   * Clear KV cache to improve performance after many messages
   */
  async clearTextModelCache(): Promise<void> {
    if (llmService.isModelLoaded()) {
      await llmService.clearKVCache(false);
    }
  }

  /**
   * Check if the service's internal state matches the actual native state
   * This is useful after app restart when persisted store may be out of sync
   */
  async syncWithNativeState(): Promise<void> {
    // Check text model
    const textModelLoaded = llmService.isModelLoaded();
    const textModelPath = llmService.getLoadedModelPath();

    if (!textModelLoaded) {
      this.loadedTextModelId = null;
    }

    // Check image model
    const imageModelLoaded = await onnxImageGeneratorService.isModelLoaded();

    if (!imageModelLoaded) {
      this.loadedImageModelId = null;
    }

    console.log('[ActiveModelService] Synced with native state - Text:', textModelLoaded, 'Image:', imageModelLoaded);
  }

  /**
   * Get the currently loaded model IDs (from this service's tracking)
   */
  getLoadedModelIds(): { textModelId: string | null; imageModelId: string | null } {
    return {
      textModelId: this.loadedTextModelId,
      imageModelId: this.loadedImageModelId,
    };
  }

  /**
   * Get LLM performance stats (tokens/sec)
   */
  getPerformanceStats() {
    return llmService.getPerformanceStats();
  }

  /**
   * Subscribe to model changes
   */
  subscribe(listener: ModelChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const info = this.getActiveModels();
    this.listeners.forEach(listener => listener(info));
  }
}

export const activeModelService = new ActiveModelService();
