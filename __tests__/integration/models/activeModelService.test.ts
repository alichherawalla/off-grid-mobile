/**
 * Integration Tests: ActiveModelService
 *
 * Tests the integration between:
 * - activeModelService ↔ llmService (text model loading/unloading)
 * - activeModelService ↔ localDreamGeneratorService (image model loading/unloading)
 * - activeModelService ↔ useAppStore (model state persistence)
 *
 * These tests verify the model lifecycle management works correctly
 * across service boundaries.
 */

import { useAppStore } from '../../../src/stores/appStore';
import { activeModelService } from '../../../src/services/activeModelService';
import { llmService } from '../../../src/services/llm';
import { localDreamGeneratorService } from '../../../src/services/localDreamGenerator';
import { hardwareService } from '../../../src/services/hardware';
import {
  resetStores,
  flushPromises,
  getAppState,
} from '../../utils/testHelpers';
import { createDownloadedModel, createONNXImageModel, createDeviceInfo } from '../../utils/factories';

// Mock the services
jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/localDreamGenerator');
jest.mock('../../../src/services/hardware');

const mockLlmService = llmService as jest.Mocked<typeof llmService>;
const mockLocalDreamService = localDreamGeneratorService as jest.Mocked<typeof localDreamGeneratorService>;
const mockHardwareService = hardwareService as jest.Mocked<typeof hardwareService>;

describe('ActiveModelService Integration', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();

    // Default mock implementations
    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLlmService.getLoadedModelPath.mockReturnValue(null);
    mockLlmService.loadModel.mockResolvedValue(undefined);
    mockLlmService.unloadModel.mockResolvedValue(undefined);

    mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
    mockLocalDreamService.loadModel.mockResolvedValue(true);
    mockLocalDreamService.unloadModel.mockResolvedValue(true);

    mockHardwareService.getDeviceInfo.mockResolvedValue(createDeviceInfo());
    mockHardwareService.refreshMemoryInfo.mockResolvedValue({
      totalMemory: 8 * 1024 * 1024 * 1024,
      usedMemory: 4 * 1024 * 1024 * 1024,
      availableMemory: 4 * 1024 * 1024 * 1024,
    } as any);

    // Reset the activeModelService's internal state to match mock state
    await activeModelService.syncWithNativeState();
  });

  describe('Text Model Loading', () => {
    it('should load text model via llmService and update store', async () => {
      const model = createDownloadedModel({ id: 'test-model-1' });
      useAppStore.setState({ downloadedModels: [model] });

      mockLlmService.loadModel.mockResolvedValue(undefined);
      mockLlmService.isModelLoaded.mockReturnValue(true);

      await activeModelService.loadTextModel('test-model-1');

      // Verify llmService was called correctly
      expect(mockLlmService.loadModel).toHaveBeenCalledWith(
        model.filePath,
        model.mmProjPath
      );

      // Verify store was updated
      expect(getAppState().activeModelId).toBe('test-model-1');
    });

    it('should skip loading if model already loaded', async () => {
      const model = createDownloadedModel({ id: 'test-model-1' });
      useAppStore.setState({ downloadedModels: [model], activeModelId: 'test-model-1' });

      // First, simulate that the model is already loaded via a first call
      mockLlmService.isModelLoaded.mockReturnValue(true);
      await activeModelService.loadTextModel('test-model-1');

      // Clear the call count after initial setup
      mockLlmService.loadModel.mockClear();

      // Now try to load again - should be skipped since already loaded
      await activeModelService.loadTextModel('test-model-1');

      // Should not be called again since model is already loaded
      expect(mockLlmService.loadModel).not.toHaveBeenCalled();
    });

    it('should unload previous model when loading different model', async () => {
      const model1 = createDownloadedModel({ id: 'model-1', filePath: '/path/model1.gguf' });
      const model2 = createDownloadedModel({ id: 'model-2', filePath: '/path/model2.gguf' });
      useAppStore.setState({ downloadedModels: [model1, model2] });

      mockLlmService.isModelLoaded.mockReturnValue(true);

      // Load first model
      await activeModelService.loadTextModel('model-1');

      // Load second model
      await activeModelService.loadTextModel('model-2');

      // Should have unloaded first model
      expect(mockLlmService.unloadModel).toHaveBeenCalled();

      // Should have loaded second model
      expect(mockLlmService.loadModel).toHaveBeenLastCalledWith(
        model2.filePath,
        model2.mmProjPath
      );
    });

    it('should throw error if model not found', async () => {
      useAppStore.setState({ downloadedModels: [] });

      await expect(
        activeModelService.loadTextModel('non-existent')
      ).rejects.toThrow('Model not found');
    });

    it('should notify listeners during loading state changes', async () => {
      const model = createDownloadedModel({ id: 'test-model' });
      useAppStore.setState({ downloadedModels: [model] });

      const listener = jest.fn();
      const unsubscribe = activeModelService.subscribe(listener);

      // Create a deferred promise to control loading
      let resolveLoad: () => void;
      mockLlmService.loadModel.mockImplementation(() =>
        new Promise((resolve) => { resolveLoad = resolve; })
      );

      const loadPromise = activeModelService.loadTextModel('test-model');

      await flushPromises();

      // Should have been called with loading state
      expect(listener).toHaveBeenCalled();
      const loadingCall = listener.mock.calls.find(
        call => call[0].text.isLoading === true
      );
      expect(loadingCall).toBeDefined();

      // Complete loading
      resolveLoad!();
      await loadPromise;

      // Should have been called with loaded state
      const loadedCall = listener.mock.calls.find(
        call => call[0].text.isLoading === false
      );
      expect(loadedCall).toBeDefined();

      unsubscribe();
    });
  });

  describe('Text Model Unloading', () => {
    it('should unload text model and clear store', async () => {
      const model = createDownloadedModel({ id: 'test-model' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: 'test-model',
      });

      mockLlmService.isModelLoaded.mockReturnValue(true);

      // First load the model to set internal tracking
      await activeModelService.loadTextModel('test-model');

      // Then unload
      await activeModelService.unloadTextModel();

      expect(mockLlmService.unloadModel).toHaveBeenCalled();
      expect(getAppState().activeModelId).toBe(null);
    });

    it('should skip unload if no model loaded', async () => {
      mockLlmService.isModelLoaded.mockReturnValue(false);
      useAppStore.setState({ activeModelId: null });

      await activeModelService.unloadTextModel();

      expect(mockLlmService.unloadModel).not.toHaveBeenCalled();
    });
  });

  describe('Image Model Loading', () => {
    it('should load image model via localDreamGeneratorService', async () => {
      const imageModel = createONNXImageModel({ id: 'img-model-1' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      await activeModelService.loadImageModel('img-model-1');

      expect(mockLocalDreamService.loadModel).toHaveBeenCalledWith(
        imageModel.modelPath,
        4,
        imageModel.backend ?? 'auto'
      );

      expect(getAppState().activeImageModelId).toBe('img-model-1');
    });

    it('should unload previous image model when loading different model', async () => {
      const imgModel1 = createONNXImageModel({ id: 'img-1' });
      const imgModel2 = createONNXImageModel({ id: 'img-2' });
      useAppStore.setState({
        downloadedImageModels: [imgModel1, imgModel2],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      // Load first model
      await activeModelService.loadImageModel('img-1');

      // Load second model
      await activeModelService.loadImageModel('img-2');

      expect(mockLocalDreamService.unloadModel).toHaveBeenCalled();
      expect(mockLocalDreamService.loadModel).toHaveBeenLastCalledWith(
        imgModel2.modelPath,
        4,
        imgModel2.backend ?? 'auto'
      );
    });
  });

  describe('Image Model Unloading', () => {
    it('should unload image model and clear store', async () => {
      const imageModel = createONNXImageModel({ id: 'img-model' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: 'img-model',
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      // First load to set internal tracking
      await activeModelService.loadImageModel('img-model');

      // Then unload
      await activeModelService.unloadImageModel();

      expect(mockLocalDreamService.unloadModel).toHaveBeenCalled();
      expect(getAppState().activeImageModelId).toBe(null);
    });
  });

  describe('Unload All Models', () => {
    it('should unload both text and image models', async () => {
      const textModel = createDownloadedModel({ id: 'text-model' });
      const imageModel = createONNXImageModel({ id: 'img-model' });
      useAppStore.setState({
        downloadedModels: [textModel],
        activeModelId: 'text-model',
        downloadedImageModels: [imageModel],
        activeImageModelId: 'img-model',
        settings: { imageThreads: 4 } as any,
      });

      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      // Load both models
      await activeModelService.loadTextModel('text-model');
      await activeModelService.loadImageModel('img-model');

      // Unload all
      const result = await activeModelService.unloadAllModels();

      expect(result.textUnloaded).toBe(true);
      expect(result.imageUnloaded).toBe(true);
      expect(mockLlmService.unloadModel).toHaveBeenCalled();
      expect(mockLocalDreamService.unloadModel).toHaveBeenCalled();
    });
  });

  describe('Memory Check', () => {
    it('should return safe for small models on high memory device', async () => {
      const model = createDownloadedModel({
        id: 'small-model',
        fileSize: 2 * 1024 * 1024 * 1024, // 2GB
      });
      useAppStore.setState({ downloadedModels: [model] });

      // High memory device (16GB)
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 16 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForModel('small-model', 'text');

      expect(result.canLoad).toBe(true);
      expect(result.severity).toBe('safe');
    });

    it('should return warning for models exceeding 50% of RAM', async () => {
      const model = createDownloadedModel({
        id: 'large-model',
        fileSize: 3 * 1024 * 1024 * 1024, // 3GB
      });
      useAppStore.setState({ downloadedModels: [model] });

      // 8GB device - 3GB * 1.5 (overhead) = 4.5GB
      // Warning threshold: 50% of 8GB = 4GB
      // Critical threshold: 60% of 8GB = 4.8GB
      // 4.5GB is between 4GB and 4.8GB, so should be warning
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForModel('large-model', 'text');

      expect(result.canLoad).toBe(true);
      expect(result.severity).toBe('warning');
    });

    it('should return critical for models exceeding 60% of RAM', async () => {
      const model = createDownloadedModel({
        id: 'huge-model',
        fileSize: 8 * 1024 * 1024 * 1024, // 8GB
      });
      useAppStore.setState({ downloadedModels: [model] });

      // 8GB device - 8GB * 1.5 = 12GB > 4.8GB (60%)
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForModel('huge-model', 'text');

      expect(result.canLoad).toBe(false);
      expect(result.severity).toBe('critical');
    });

    it('should return blocked for non-existent model', async () => {
      useAppStore.setState({ downloadedModels: [] });

      const result = await activeModelService.checkMemoryForModel('non-existent', 'text');

      expect(result.canLoad).toBe(false);
      expect(result.severity).toBe('blocked');
      expect(result.message).toBe('Model not found');
    });
  });

  describe('Dual Model Memory Check', () => {
    it('should check combined memory for text and image models', async () => {
      const textModel = createDownloadedModel({
        id: 'text-model',
        fileSize: 4 * 1024 * 1024 * 1024, // 4GB
      });
      const imageModel = createONNXImageModel({
        id: 'img-model',
        size: 2 * 1024 * 1024 * 1024, // 2GB
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
      });

      // 16GB device
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 16 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForDualModel(
        'text-model',
        'img-model'
      );

      expect(result).toBeDefined();
      expect(result.totalRequiredMemoryGB).toBeGreaterThan(0);
    });
  });

  describe('Sync With Native State', () => {
    it('should sync internal state with native module state', async () => {
      const model = createDownloadedModel({ id: 'test-model' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: 'test-model',
      });

      // Native says model is loaded
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.getLoadedModelPath.mockReturnValue(model.filePath);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await activeModelService.syncWithNativeState();

      // Internal tracking should now match
      const loadedIds = activeModelService.getLoadedModelIds();
      expect(loadedIds.textModelId).toBe('test-model');
    });

    it('should clear internal state if native reports no model loaded', async () => {
      // Native says no model loaded
      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await activeModelService.syncWithNativeState();

      const loadedIds = activeModelService.getLoadedModelIds();
      expect(loadedIds.textModelId).toBe(null);
      expect(loadedIds.imageModelId).toBe(null);
    });
  });

  describe('Performance Stats', () => {
    it('should proxy performance stats from llmService', () => {
      const expectedStats = {
        lastTokensPerSecond: 20.5,
        lastDecodeTokensPerSecond: 25.0,
        lastTimeToFirstToken: 0.4,
        lastGenerationTime: 4.0,
        lastTokenCount: 80,
      };

      mockLlmService.getPerformanceStats.mockReturnValue(expectedStats);

      const stats = activeModelService.getPerformanceStats();

      expect(stats).toEqual(expectedStats);
      expect(mockLlmService.getPerformanceStats).toHaveBeenCalled();
    });
  });

  describe('Active Models Info', () => {
    it('should return correct info about loaded models', async () => {
      const textModel = createDownloadedModel({ id: 'text-model' });
      const imageModel = createONNXImageModel({ id: 'img-model' });
      useAppStore.setState({
        downloadedModels: [textModel],
        activeModelId: 'text-model',
        downloadedImageModels: [imageModel],
        activeImageModelId: 'img-model',
        settings: { imageThreads: 4 } as any,
      });

      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      // Load both
      await activeModelService.loadTextModel('text-model');
      await activeModelService.loadImageModel('img-model');

      const info = activeModelService.getActiveModels();

      expect(info.text.model?.id).toBe('text-model');
      expect(info.text.isLoaded).toBe(true);
      expect(info.image.model?.id).toBe('img-model');
      expect(info.image.isLoaded).toBe(true);
    });

    it('should report no models when none loaded', async () => {
      // Sync with native state to reset internal tracking
      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await activeModelService.syncWithNativeState();

      const info = activeModelService.getActiveModels();

      expect(info.text.model).toBe(null);
      expect(info.text.isLoaded).toBe(false);
      expect(info.image.model).toBe(null);
      expect(info.image.isLoaded).toBe(false);
    });
  });

  describe('Has Any Model Loaded', () => {
    it('should return true when text model loaded', async () => {
      const model = createDownloadedModel({ id: 'test-model' });
      useAppStore.setState({ downloadedModels: [model] });

      mockLlmService.isModelLoaded.mockReturnValue(true);

      await activeModelService.loadTextModel('test-model');

      expect(activeModelService.hasAnyModelLoaded()).toBe(true);
    });

    it('should return true when image model loaded', async () => {
      const imageModel = createONNXImageModel({ id: 'img-model' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      await activeModelService.loadImageModel('img-model');

      expect(activeModelService.hasAnyModelLoaded()).toBe(true);
    });

    it('should return false when no models loaded', async () => {
      // Sync with native state to reset internal tracking
      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await activeModelService.syncWithNativeState();

      expect(activeModelService.hasAnyModelLoaded()).toBe(false);
    });
  });

  describe('Concurrent Load Prevention', () => {
    it('should wait for pending load to complete before starting new load', async () => {
      const model = createDownloadedModel({ id: 'test-model' });
      useAppStore.setState({ downloadedModels: [model] });

      let resolveFirst: () => void;
      let loadCount = 0;

      mockLlmService.loadModel.mockImplementation(() => {
        loadCount++;
        if (loadCount === 1) {
          return new Promise((resolve) => { resolveFirst = resolve; });
        }
        return Promise.resolve();
      });

      // Start first load
      const load1 = activeModelService.loadTextModel('test-model');

      // Start second load immediately
      const load2 = activeModelService.loadTextModel('test-model');

      await flushPromises();

      // Only one actual load should have started
      expect(loadCount).toBe(1);

      // Complete first load
      resolveFirst!();
      await Promise.all([load1, load2]);

      // Still only one load because same model
      expect(mockLlmService.loadModel).toHaveBeenCalledTimes(1);
    });
  });
});
