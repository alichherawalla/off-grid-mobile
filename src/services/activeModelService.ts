/**
 * ActiveModelService - Singleton for managing active models throughout the app
 * THIS IS THE ONLY PLACE MODELS SHOULD BE LOADED/UNLOADED FROM
 * All other code should use this service, never call llmService/onnxImageGeneratorService directly
 */

import { Platform } from 'react-native';
import { llmService } from './llm';
import { localDreamGeneratorService as onnxImageGeneratorService } from './localDreamGenerator';
import { modelManager } from './modelManager';
import { hardwareService } from './hardware';
import { useAppStore } from '../stores';
import { DownloadedModel, ONNXImageModel } from '../types';
import RNFS from 'react-native-fs';

export type ModelType = 'text' | 'image';

// Memory safety thresholds
// Dynamic budget based on device total RAM
const MEMORY_BUDGET_PERCENT = 0.60; // Use up to 60% of device RAM for models
const MEMORY_WARNING_PERCENT = 0.50; // Warn when exceeding 50% of device RAM
const TEXT_MODEL_OVERHEAD_MULTIPLIER = 1.5; // KV cache, activations, etc.
const IMAGE_MODEL_OVERHEAD_MULTIPLIER = Platform.OS === 'ios' ? 1.5 : 1.8; // Core ML is more efficient than ONNX runtime

// Get dynamic memory budget based on device
const getMemoryBudgetGB = async (): Promise<number> => {
  const deviceInfo = await hardwareService.getDeviceInfo();
  const totalGB = deviceInfo.totalMemory / (1024 * 1024 * 1024);
  return totalGB * MEMORY_BUDGET_PERCENT;
};

const getMemoryWarningThresholdGB = async (): Promise<number> => {
  const deviceInfo = await hardwareService.getDeviceInfo();
  const totalGB = deviceInfo.totalMemory / (1024 * 1024 * 1024);
  return totalGB * MEMORY_WARNING_PERCENT;
};

export type MemoryCheckSeverity = 'safe' | 'warning' | 'critical' | 'blocked';

export interface MemoryCheckResult {
  canLoad: boolean;
  severity: MemoryCheckSeverity;
  availableMemoryGB: number;
  requiredMemoryGB: number;
  currentlyLoadedMemoryGB: number;
  totalRequiredMemoryGB: number;
  remainingAfterLoadGB: number;
  message: string;
}

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
    const imageLoaded = this.loadedImageModelId != null;

    return {
      text: {
        model: textModel,
        isLoaded: llmService.isModelLoaded(),
        isLoading: this.loadingState.text,
      },
      image: {
        model: imageModel,
        isLoaded: imageLoaded,
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
   * Timeout is 2 minutes to allow for slow devices
   */
  async loadTextModel(modelId: string, timeoutMs: number = 120000): Promise<void> {
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

        // Check if this looks like a vision model but is missing mmProjPath
        let mmProjPath = model.mmProjPath;
        if (!mmProjPath) {
          const modelNameLower = model.name.toLowerCase();
          const looksLikeVisionModel = modelNameLower.includes('vl') ||
                                       modelNameLower.includes('vision') ||
                                       modelNameLower.includes('smolvlm');

          if (looksLikeVisionModel) {
            console.log('[ActiveModelService] Vision model detected but no mmProjPath, searching for mmproj file...');
            // Try to find mmproj file in same directory
            const modelDir = model.filePath.substring(0, model.filePath.lastIndexOf('/'));
            try {
              const files = await RNFS.readDir(modelDir);
              const mmProjFile = files.find((f: any) =>
                f.name.toLowerCase().includes('mmproj') && f.name.endsWith('.gguf')
              );
              if (mmProjFile) {
                mmProjPath = mmProjFile.path;
                console.log('[ActiveModelService] Found mmproj file:', mmProjPath);

                // Update the model in the store so ChatScreen sees the mmProjPath
                const { downloadedModels, setDownloadedModels } = useAppStore.getState();
                const updatedModels = downloadedModels.map(m => {
                  if (m.id === modelId) {
                    console.log('[ActiveModelService] Updating store with mmProjPath for:', m.name);
                    return {
                      ...m,
                      mmProjPath: mmProjFile.path,
                      mmProjFileName: mmProjFile.name,
                      mmProjFileSize: typeof mmProjFile.size === 'string' ? parseInt(mmProjFile.size, 10) : mmProjFile.size,
                      isVisionModel: true,
                    };
                  }
                  return m;
                });
                setDownloadedModels(updatedModels);

                // Also persist to storage so it's remembered
                await modelManager.saveModelWithMmproj(modelId, mmProjFile.path, mmProjFile.name, mmProjFile.size);
              } else {
                console.log('[ActiveModelService] No mmproj file found - vision will not work!');
              }
            } catch (e) {
              console.log('[ActiveModelService] Failed to search for mmproj:', e);
            }
          }
        }

        console.log('[ActiveModelService] Using mmProjPath:', mmProjPath || 'NONE');
        const startTime = Date.now();

        // Add timeout to prevent hanging forever
        const loadPromise = llmService.loadModel(model.filePath, mmProjPath);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(
            `Text model loading timed out after ${timeoutMs / 1000}s. ` +
            'Try a smaller model or reduce context length in settings.'
          )), timeoutMs);
        });

        await Promise.race([loadPromise, timeoutPromise]);

        const loadTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[ActiveModelService] Text model loaded in ${loadTime}s:`, modelId);

        this.loadedTextModelId = modelId;
        store.setActiveModelId(modelId);
      } catch (error) {
        console.error('[ActiveModelService] Failed to load text model:', error);
        this.loadedTextModelId = null;
        throw error;
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

    const storeActiveModelId = useAppStore.getState().activeModelId;
    const hasStoreActiveModel = !!storeActiveModelId;
    const hasInternalTracking = !!this.loadedTextModelId;
    const isNativeLoaded = llmService.isModelLoaded();

    console.log('[ActiveModelService] unloadTextModel check - store:', hasStoreActiveModel, 'internal:', hasInternalTracking, 'native:', isNativeLoaded);

    // Only skip if ALL sources say no model is loaded
    if (!hasStoreActiveModel && !hasInternalTracking && !isNativeLoaded) {
      console.log('[ActiveModelService] No text model loaded to unload');
      return;
    }

    this.loadingState.text = true;
    this.notifyListeners();

    try {
      console.log('[ActiveModelService] Unloading text model:', this.loadedTextModelId || storeActiveModelId);

      // Only call native unload if there's actually a model loaded
      if (isNativeLoaded) {
        await llmService.unloadModel();
      }

      // Always clear internal state and store - get fresh reference
      this.loadedTextModelId = null;
      useAppStore.getState().setActiveModelId(null);
      console.log('[ActiveModelService] Text model unloaded, store activeModelId now:', useAppStore.getState().activeModelId);
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
        const loadPromise = onnxImageGeneratorService.loadModel(
          model.modelPath,
          imageThreads,
          model.backend ?? 'auto',
        );
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
    const hasStoreActiveModel = !!store.activeImageModelId;
    const hasInternalTracking = !!this.loadedImageModelId;
    const isNativeLoaded = await onnxImageGeneratorService.isModelLoaded();

    // Only skip if ALL sources say no model is loaded
    if (!hasStoreActiveModel && !hasInternalTracking && !isNativeLoaded) {
      console.log('[ActiveModelService] No image model loaded to unload');
      return;
    }

    this.loadingState.image = true;
    this.notifyListeners();

    try {
      console.log('[ActiveModelService] Unloading image model:', this.loadedImageModelId || store.activeImageModelId);

      // Only call native unload if there's actually a model loaded
      if (isNativeLoaded) {
        await onnxImageGeneratorService.unloadModel();
      }

      // Always clear internal state and store
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
   * Always attempts to unload both model types - the individual unload functions
   * handle checking whether there's actually something to unload
   */
  async unloadAllModels(): Promise<{ textUnloaded: boolean; imageUnloaded: boolean }> {
    const store = useAppStore.getState();
    const results = { textUnloaded: false, imageUnloaded: false };

    // Check all state sources for text model
    const hasTextModel = !!store.activeModelId ||
                         !!this.loadedTextModelId ||
                         llmService.isModelLoaded();

    // Check all state sources for image model
    const hasImageModel = !!store.activeImageModelId ||
                          !!this.loadedImageModelId;

    console.log('[ActiveModelService] unloadAllModels - text:', hasTextModel, 'image:', hasImageModel);

    // Always try to unload both - run sequentially to avoid race conditions
    if (hasTextModel) {
      try {
        await this.unloadTextModel();
        results.textUnloaded = true;
      } catch (e) {
        console.error('[ActiveModelService] Failed to unload text model:', e);
      }
    }

    if (hasImageModel) {
      try {
        await this.unloadImageModel();
        results.imageUnloaded = true;
      } catch (e) {
        console.error('[ActiveModelService] Failed to unload image model:', e);
      }
    }

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
   * Estimate memory required for a specific model
   */
  private estimateModelMemoryGB(model: DownloadedModel | ONNXImageModel, type: ModelType): number {
    if (type === 'text') {
      const textModel = model as DownloadedModel;
      // Text models: file size * overhead for KV cache, activations, etc.
      const sizeGB = (textModel.fileSize || 0) / (1024 * 1024 * 1024);
      return sizeGB * TEXT_MODEL_OVERHEAD_MULTIPLIER;
    } else {
      const imageModel = model as ONNXImageModel;
      // Image models: file size * overhead for ONNX runtime, intermediate tensors
      const sizeGB = (imageModel.size || 0) / (1024 * 1024 * 1024);
      return sizeGB * IMAGE_MODEL_OVERHEAD_MULTIPLIER;
    }
  }

  /**
   * Get memory currently used by loaded models
   */
  private getCurrentlyLoadedMemoryGB(): number {
    const store = useAppStore.getState();
    let totalGB = 0;

    // Only count models that are actually loaded (not just selected)
    if (this.loadedTextModelId && llmService.isModelLoaded()) {
      const textModel = store.downloadedModels.find(m => m.id === this.loadedTextModelId);
      if (textModel) {
        totalGB += this.estimateModelMemoryGB(textModel, 'text');
      }
    }

    if (this.loadedImageModelId) {
      const imageModel = store.downloadedImageModels.find(m => m.id === this.loadedImageModelId);
      if (imageModel) {
        totalGB += this.estimateModelMemoryGB(imageModel, 'image');
      }
    }

    return totalGB;
  }

  /**
   * Check if there's enough memory to load a model
   * Uses a dynamic memory budget (60% of device RAM) since system "available" memory is misleading
   */
  async checkMemoryForModel(
    modelId: string,
    modelType: ModelType,
  ): Promise<MemoryCheckResult> {
    const store = useAppStore.getState();

    // Get dynamic budget based on device RAM
    const memoryBudgetGB = await getMemoryBudgetGB();
    const warningThresholdGB = await getMemoryWarningThresholdGB();

    // Find the model
    let model: DownloadedModel | ONNXImageModel | undefined;

    if (modelType === 'text') {
      model = store.downloadedModels.find(m => m.id === modelId);
    } else {
      model = store.downloadedImageModels.find(m => m.id === modelId);
    }

    if (!model) {
      return {
        canLoad: false,
        severity: 'blocked',
        availableMemoryGB: 0,
        requiredMemoryGB: 0,
        currentlyLoadedMemoryGB: 0,
        totalRequiredMemoryGB: 0,
        remainingAfterLoadGB: 0,
        message: 'Model not found',
      };
    }

    // Calculate memory requirements for the new model
    const requiredMemoryGB = this.estimateModelMemoryGB(model, modelType);

    // Get memory currently used by OTHER loaded models (not the one being replaced)
    let currentlyLoadedMemoryGB = 0;

    // If loading a text model, count image model memory (if any)
    if (modelType === 'text' && this.loadedImageModelId) {
      const imageModel = store.downloadedImageModels.find(m => m.id === this.loadedImageModelId);
      if (imageModel) {
        currentlyLoadedMemoryGB += this.estimateModelMemoryGB(imageModel, 'image');
      }
    }

    // If loading an image model, count text model memory (if any)
    if (modelType === 'image' && this.loadedTextModelId && llmService.isModelLoaded()) {
      const textModel = store.downloadedModels.find(m => m.id === this.loadedTextModelId);
      if (textModel) {
        currentlyLoadedMemoryGB += this.estimateModelMemoryGB(textModel, 'text');
      }
    }

    // Total memory needed: new model + other loaded models
    const totalRequiredMemoryGB = requiredMemoryGB + currentlyLoadedMemoryGB;

    // How much budget remains after loading
    const remainingBudgetGB = memoryBudgetGB - totalRequiredMemoryGB;

    // Determine severity based on dynamic budget
    let severity: MemoryCheckSeverity;
    let canLoad: boolean;
    let message: string;

    const modelName = 'name' in model ? model.name : modelId;
    const requiredStr = requiredMemoryGB.toFixed(1);
    const totalStr = totalRequiredMemoryGB.toFixed(1);
    const budgetStr = memoryBudgetGB.toFixed(1);

    if (totalRequiredMemoryGB > memoryBudgetGB) {
      // Critical: would exceed memory budget (60% of device RAM)
      severity = 'critical';
      canLoad = false;
      if (currentlyLoadedMemoryGB > 0) {
        message = `Cannot load ${modelName} (~${requiredStr} GB) while other models are loaded. ` +
          `Total would be ~${totalStr} GB, exceeding your device's ~${budgetStr} GB safe limit (60% of RAM). ` +
          `Unload the other model first, or choose a smaller model.`;
      } else {
        message = `${modelName} requires ~${requiredStr} GB which exceeds your device's ~${budgetStr} GB safe limit (60% of RAM). ` +
          `This model is too large for your device. Choose a smaller model.`;
      }
    } else if (totalRequiredMemoryGB > warningThresholdGB) {
      // Warning: exceeding 50% of RAM
      severity = 'warning';
      canLoad = true;
      message = `Loading ${modelName} will use ~${requiredStr} GB. ` +
        `Total model memory will be ~${totalStr} GB (over 50% of your RAM). ` +
        `The app may become slow. Continue anyway?`;
    } else {
      // Safe to load
      severity = 'safe';
      canLoad = true;
      message = `${modelName} requires ~${requiredStr} GB. Safe to load.`;
    }

    // Log for debugging
    console.log(`[ActiveModelService] Memory check for ${modelId}:`, {
      requiredGB: requiredMemoryGB.toFixed(2),
      otherModelsGB: currentlyLoadedMemoryGB.toFixed(2),
      totalGB: totalRequiredMemoryGB.toFixed(2),
      budgetGB: memoryBudgetGB.toFixed(2),
      severity,
      canLoad,
    });

    return {
      canLoad,
      severity,
      availableMemoryGB: memoryBudgetGB - currentlyLoadedMemoryGB,
      requiredMemoryGB,
      currentlyLoadedMemoryGB,
      totalRequiredMemoryGB,
      remainingAfterLoadGB: remainingBudgetGB,
      message,
    };
  }

  /**
   * Check memory for loading both a text and image model together
   * Useful for checking if dual-model operation is feasible
   */
  async checkMemoryForDualModel(
    textModelId: string | null,
    imageModelId: string | null,
  ): Promise<MemoryCheckResult> {
    const store = useAppStore.getState();

    // Get dynamic budget based on device RAM
    const memoryBudgetGB = await getMemoryBudgetGB();
    const warningThresholdGB = await getMemoryWarningThresholdGB();

    let totalRequiredGB = 0;
    const modelNames: string[] = [];

    if (textModelId) {
      const textModel = store.downloadedModels.find(m => m.id === textModelId);
      if (textModel) {
        totalRequiredGB += this.estimateModelMemoryGB(textModel, 'text');
        modelNames.push(textModel.name);
      }
    }

    if (imageModelId) {
      const imageModel = store.downloadedImageModels.find(m => m.id === imageModelId);
      if (imageModel) {
        totalRequiredGB += this.estimateModelMemoryGB(imageModel, 'image');
        modelNames.push(imageModel.name);
      }
    }

    const remainingBudgetGB = memoryBudgetGB - totalRequiredGB;

    let severity: MemoryCheckSeverity;
    let canLoad: boolean;
    let message: string;

    const namesStr = modelNames.join(' + ');
    const requiredStr = totalRequiredGB.toFixed(1);
    const budgetStr = memoryBudgetGB.toFixed(1);

    if (totalRequiredGB > memoryBudgetGB) {
      severity = 'critical';
      canLoad = false;
      message = `Cannot load both models. ` +
        `${namesStr} would require ~${requiredStr} GB, exceeding your device's ~${budgetStr} GB safe limit (60% of RAM).`;
    } else if (totalRequiredGB > warningThresholdGB) {
      severity = 'warning';
      canLoad = true;
      message = `Loading ${namesStr} will use ~${requiredStr} GB (over 50% of RAM). ` +
        `Performance may be affected.`;
    } else {
      severity = 'safe';
      canLoad = true;
      message = `${namesStr} will use ~${requiredStr} GB. Safe to load.`;
    }

    return {
      canLoad,
      severity,
      availableMemoryGB: memoryBudgetGB,
      requiredMemoryGB: totalRequiredGB,
      currentlyLoadedMemoryGB: 0,
      totalRequiredMemoryGB: totalRequiredGB,
      remainingAfterLoadGB: remainingBudgetGB,
      message,
    };
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
    const store = useAppStore.getState();
    // Check text model
    const textModelLoaded = llmService.isModelLoaded();
    const textModelPath = llmService.getLoadedModelPath();

    if (!textModelLoaded) {
      this.loadedTextModelId = null;
    } else if (!this.loadedTextModelId && store.activeModelId) {
      this.loadedTextModelId = store.activeModelId;
    }

    // Check image model
    const imageModelLoaded = await onnxImageGeneratorService.isModelLoaded();

    if (!imageModelLoaded) {
      this.loadedImageModelId = null;
      this.loadedImageModelThreads = null;
    } else if (!this.loadedImageModelId && store.activeImageModelId) {
      this.loadedImageModelId = store.activeImageModelId;
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
