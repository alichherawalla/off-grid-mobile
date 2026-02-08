/**
 * LocalDreamGenerator Unit Tests - Cross-Platform Routing
 *
 * Tests that localDreamGenerator.ts correctly routes to the right native module
 * per platform (CoreMLDiffusionModule on iOS, LocalDreamModule on Android).
 *
 * Priority: P0 (Critical) - If routing breaks, image generation silently fails.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

// ============================================================================
// Mock native modules
// ============================================================================

const mockLocalDreamModule = {
  loadModel: jest.fn(),
  unloadModel: jest.fn(),
  isModelLoaded: jest.fn(),
  getLoadedModelPath: jest.fn(),
  generateImage: jest.fn(),
  cancelGeneration: jest.fn(),
  isGenerating: jest.fn(),
  isNpuSupported: jest.fn(),
  getGeneratedImages: jest.fn(),
  deleteGeneratedImage: jest.fn(),
  getConstants: jest.fn(),
};

const mockCoreMLModule = {
  loadModel: jest.fn(),
  unloadModel: jest.fn(),
  isModelLoaded: jest.fn(),
  getLoadedModelPath: jest.fn(),
  generateImage: jest.fn(),
  cancelGeneration: jest.fn(),
  isGenerating: jest.fn(),
  isNpuSupported: jest.fn(),
  getGeneratedImages: jest.fn(),
  deleteGeneratedImage: jest.fn(),
  getConstants: jest.fn(),
};

const mockAddListener = jest.fn().mockReturnValue({ remove: jest.fn() });
const mockRemoveAllListeners = jest.fn();

jest.mock('react-native', () => {
  const actualPlatform = { OS: 'android', select: jest.fn() };
  return {
    NativeModules: {
      LocalDreamModule: mockLocalDreamModule,
      CoreMLDiffusionModule: mockCoreMLModule,
    },
    NativeEventEmitter: jest.fn().mockImplementation(() => ({
      addListener: mockAddListener,
      removeAllListeners: mockRemoveAllListeners,
    })),
    Platform: actualPlatform,
  };
});

// ============================================================================
// Tests
// ============================================================================

describe('LocalDreamGeneratorService', () => {
  // Since Platform.select is evaluated at module load time,
  // we need jest.isolateModules to test each platform path.

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ========================================================================
  // Platform routing
  // ========================================================================
  describe('Platform routing', () => {
    it('routes to LocalDreamModule on Android', () => {
      jest.isolateModules(() => {
        // Set Platform.select to return the android module
        const { Platform: P } = require('react-native');
        P.select = (opts: any) => opts.android;
        P.OS = 'android';

        const { localDreamGeneratorService: svc } =
          require('../../../src/services/localDreamGenerator');

        expect(svc.isAvailable()).toBe(true);
      });
    });

    it('routes to CoreMLDiffusionModule on iOS', () => {
      jest.isolateModules(() => {
        const { Platform: P } = require('react-native');
        P.select = (opts: any) => opts.ios;
        P.OS = 'ios';

        const { localDreamGeneratorService: svc } =
          require('../../../src/services/localDreamGenerator');

        expect(svc.isAvailable()).toBe(true);
      });
    });

    it('returns null DiffusionModule on unsupported platform', () => {
      jest.isolateModules(() => {
        const { Platform: P } = require('react-native');
        P.select = (opts: any) => opts.default;
        P.OS = 'web';

        const { localDreamGeneratorService: svc } =
          require('../../../src/services/localDreamGenerator');

        expect(svc.isAvailable()).toBe(false);
      });
    });
  });

  // ========================================================================
  // Method delegation (Android path)
  // ========================================================================
  describe('Method delegation (Android)', () => {
    let service: any;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.isolateModules(() => {
        const { Platform: P } = require('react-native');
        P.select = (opts: any) => opts.android;
        P.OS = 'android';

        const mod = require('../../../src/services/localDreamGenerator');
        service = mod.localDreamGeneratorService;
      });
    });

    it('loadModel delegates to native module', async () => {
      mockLocalDreamModule.loadModel.mockResolvedValue(true);

      const result = await service.loadModel('/path/to/model', 4, 'mnn');

      expect(mockLocalDreamModule.loadModel).toHaveBeenCalledWith({
        modelPath: '/path/to/model',
        threads: 4,
        backend: 'mnn',
      });
      expect(result).toBe(true);
    });

    it('loadModel omits threads when not provided', async () => {
      mockLocalDreamModule.loadModel.mockResolvedValue(true);

      await service.loadModel('/path/to/model');

      const callArg = mockLocalDreamModule.loadModel.mock.calls[0][0];
      expect(callArg.modelPath).toBe('/path/to/model');
      expect(callArg).not.toHaveProperty('threads');
    });

    it('unloadModel delegates to native module', async () => {
      mockLocalDreamModule.unloadModel.mockResolvedValue(true);

      const result = await service.unloadModel();

      expect(mockLocalDreamModule.unloadModel).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('isModelLoaded delegates to native module', async () => {
      mockLocalDreamModule.isModelLoaded.mockResolvedValue(true);

      const result = await service.isModelLoaded();

      expect(mockLocalDreamModule.isModelLoaded).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('getLoadedModelPath delegates to native module', async () => {
      mockLocalDreamModule.getLoadedModelPath.mockResolvedValue('/loaded/path');

      const result = await service.getLoadedModelPath();

      expect(mockLocalDreamModule.getLoadedModelPath).toHaveBeenCalled();
      expect(result).toBe('/loaded/path');
    });

    it('cancelGeneration delegates to native module', async () => {
      mockLocalDreamModule.cancelGeneration.mockResolvedValue(true);

      const result = await service.cancelGeneration();

      expect(mockLocalDreamModule.cancelGeneration).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('getGeneratedImages delegates to native module', async () => {
      mockLocalDreamModule.getGeneratedImages.mockResolvedValue([
        { id: 'img-1', prompt: 'test', imagePath: '/img.png', width: 512, height: 512, steps: 20, seed: 1, modelId: 'm1', createdAt: '2026-01-01' },
      ]);

      const result = await service.getGeneratedImages();

      expect(mockLocalDreamModule.getGeneratedImages).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('img-1');
    });

    it('deleteGeneratedImage delegates to native module', async () => {
      mockLocalDreamModule.deleteGeneratedImage.mockResolvedValue(true);

      const result = await service.deleteGeneratedImage('img-1');

      expect(mockLocalDreamModule.deleteGeneratedImage).toHaveBeenCalledWith('img-1');
      expect(result).toBe(true);
    });

    it('getConstants delegates to native module', () => {
      const mockConstants = {
        DEFAULT_STEPS: 20,
        DEFAULT_GUIDANCE_SCALE: 7.5,
        DEFAULT_WIDTH: 512,
        DEFAULT_HEIGHT: 512,
        SUPPORTED_WIDTHS: [512],
        SUPPORTED_HEIGHTS: [512],
      };
      mockLocalDreamModule.getConstants.mockReturnValue(mockConstants);

      const result = service.getConstants();

      expect(mockLocalDreamModule.getConstants).toHaveBeenCalled();
      expect(result.DEFAULT_STEPS).toBe(20);
    });
  });

  // ========================================================================
  // Method delegation (iOS path)
  // ========================================================================
  describe('Method delegation (iOS)', () => {
    let service: any;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.isolateModules(() => {
        const { Platform: P } = require('react-native');
        P.select = (opts: any) => opts.ios;
        P.OS = 'ios';

        const mod = require('../../../src/services/localDreamGenerator');
        service = mod.localDreamGeneratorService;
      });
    });

    it('loadModel delegates to CoreMLDiffusionModule', async () => {
      mockCoreMLModule.loadModel.mockResolvedValue(true);

      const result = await service.loadModel('/path/to/coreml-model', 4, 'auto');

      expect(mockCoreMLModule.loadModel).toHaveBeenCalledWith({
        modelPath: '/path/to/coreml-model',
        threads: 4,
        backend: 'auto',
      });
      expect(mockLocalDreamModule.loadModel).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('unloadModel delegates to CoreMLDiffusionModule', async () => {
      mockCoreMLModule.unloadModel.mockResolvedValue(true);

      await service.unloadModel();

      expect(mockCoreMLModule.unloadModel).toHaveBeenCalled();
      expect(mockLocalDreamModule.unloadModel).not.toHaveBeenCalled();
    });

    it('isModelLoaded delegates to CoreMLDiffusionModule', async () => {
      mockCoreMLModule.isModelLoaded.mockResolvedValue(false);

      const result = await service.isModelLoaded();

      expect(mockCoreMLModule.isModelLoaded).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('cancelGeneration delegates to CoreMLDiffusionModule', async () => {
      mockCoreMLModule.cancelGeneration.mockResolvedValue(true);

      await service.cancelGeneration();

      expect(mockCoreMLModule.cancelGeneration).toHaveBeenCalled();
      expect(mockLocalDreamModule.cancelGeneration).not.toHaveBeenCalled();
    });

    it('getGeneratedImages delegates to CoreMLDiffusionModule', async () => {
      mockCoreMLModule.getGeneratedImages.mockResolvedValue([]);

      const result = await service.getGeneratedImages();

      expect(mockCoreMLModule.getGeneratedImages).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('deleteGeneratedImage delegates to CoreMLDiffusionModule', async () => {
      mockCoreMLModule.deleteGeneratedImage.mockResolvedValue(true);

      await service.deleteGeneratedImage('img-1');

      expect(mockCoreMLModule.deleteGeneratedImage).toHaveBeenCalledWith('img-1');
      expect(mockLocalDreamModule.deleteGeneratedImage).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // isAvailable edge cases
  // ========================================================================
  describe('isAvailable', () => {
    it('returns false when module is unavailable', () => {
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.NativeModules.LocalDreamModule = null;
        rn.NativeModules.CoreMLDiffusionModule = null;
        const { Platform: P } = rn;
        P.select = (opts: any) => opts.default;
        P.OS = 'android';

        const { localDreamGeneratorService: svc } =
          require('../../../src/services/localDreamGenerator');

        expect(svc.isAvailable()).toBe(false);
      });
    });

    it('isModelLoaded returns false when not available', async () => {
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.NativeModules.LocalDreamModule = null;
        rn.NativeModules.CoreMLDiffusionModule = null;
        const { Platform: P } = rn;
        P.select = (opts: any) => opts.default;

        const { localDreamGeneratorService: svc } =
          require('../../../src/services/localDreamGenerator');

        expect(svc.isModelLoaded()).resolves.toBe(false);
      });
    });

    it('getLoadedModelPath returns null when not available', async () => {
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.NativeModules.LocalDreamModule = null;
        rn.NativeModules.CoreMLDiffusionModule = null;
        const { Platform: P } = rn;
        P.select = (opts: any) => opts.default;

        const { localDreamGeneratorService: svc } =
          require('../../../src/services/localDreamGenerator');

        expect(svc.getLoadedModelPath()).resolves.toBeNull();
      });
    });

    it('loadModel throws when not available', async () => {
      let svc: any;
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.NativeModules.LocalDreamModule = null;
        rn.NativeModules.CoreMLDiffusionModule = null;
        const { Platform: P } = rn;
        P.select = (opts: any) => opts.default;

        svc = require('../../../src/services/localDreamGenerator').localDreamGeneratorService;
      });

      await expect(svc.loadModel('/path')).rejects.toThrow('not available');
    });

    it('generateImage throws when not available', async () => {
      let svc: any;
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.NativeModules.LocalDreamModule = null;
        rn.NativeModules.CoreMLDiffusionModule = null;
        const { Platform: P } = rn;
        P.select = (opts: any) => opts.default;

        svc = require('../../../src/services/localDreamGenerator').localDreamGeneratorService;
      });

      await expect(svc.generateImage({ prompt: 'test' })).rejects.toThrow('not available');
    });

    it('getGeneratedImages returns empty array when not available', async () => {
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.NativeModules.LocalDreamModule = null;
        rn.NativeModules.CoreMLDiffusionModule = null;
        const { Platform: P } = rn;
        P.select = (opts: any) => opts.default;

        const { localDreamGeneratorService: svc } =
          require('../../../src/services/localDreamGenerator');

        expect(svc.getGeneratedImages()).resolves.toEqual([]);
      });
    });

    it('deleteGeneratedImage returns false when not available', async () => {
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.NativeModules.LocalDreamModule = null;
        rn.NativeModules.CoreMLDiffusionModule = null;
        const { Platform: P } = rn;
        P.select = (opts: any) => opts.default;

        const { localDreamGeneratorService: svc } =
          require('../../../src/services/localDreamGenerator');

        expect(svc.deleteGeneratedImage('img-1')).resolves.toBe(false);
      });
    });

    it('unloadModel returns true when not available (no-op)', async () => {
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.NativeModules.LocalDreamModule = null;
        rn.NativeModules.CoreMLDiffusionModule = null;
        const { Platform: P } = rn;
        P.select = (opts: any) => opts.default;

        const { localDreamGeneratorService: svc } =
          require('../../../src/services/localDreamGenerator');

        expect(svc.unloadModel()).resolves.toBe(true);
      });
    });

    it('cancelGeneration returns true when not available (no-op)', async () => {
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.NativeModules.LocalDreamModule = null;
        rn.NativeModules.CoreMLDiffusionModule = null;
        const { Platform: P } = rn;
        P.select = (opts: any) => opts.default;

        const { localDreamGeneratorService: svc } =
          require('../../../src/services/localDreamGenerator');

        expect(svc.cancelGeneration()).resolves.toBe(true);
      });
    });

    it('getConstants returns defaults when not available', () => {
      jest.isolateModules(() => {
        const rn = require('react-native');
        rn.NativeModules.LocalDreamModule = null;
        rn.NativeModules.CoreMLDiffusionModule = null;
        const { Platform: P } = rn;
        P.select = (opts: any) => opts.default;

        const { localDreamGeneratorService: svc } =
          require('../../../src/services/localDreamGenerator');

        const constants = svc.getConstants();
        expect(constants.DEFAULT_STEPS).toBe(20);
        expect(constants.DEFAULT_GUIDANCE_SCALE).toBe(7.5);
        expect(constants.DEFAULT_WIDTH).toBe(512);
        expect(constants.DEFAULT_HEIGHT).toBe(512);
        expect(Array.isArray(constants.SUPPORTED_WIDTHS)).toBe(true);
        expect(Array.isArray(constants.SUPPORTED_HEIGHTS)).toBe(true);
      });
    });
  });

  // ========================================================================
  // generateImage lifecycle
  // ========================================================================
  describe('generateImage lifecycle', () => {
    let service: any;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.isolateModules(() => {
        const { Platform: P } = require('react-native');
        P.select = (opts: any) => opts.android;
        P.OS = 'android';

        service = require('../../../src/services/localDreamGenerator').localDreamGeneratorService;
      });
    });

    it('calls native generateImage with correct params', async () => {
      mockLocalDreamModule.generateImage.mockResolvedValue({
        id: 'img-1',
        imagePath: '/gen/img.png',
        width: 512,
        height: 512,
        seed: 42,
      });

      await service.generateImage({
        prompt: 'A cat',
        negativePrompt: 'blurry',
        steps: 25,
        guidanceScale: 8.0,
        seed: 42,
        width: 512,
        height: 512,
      });

      expect(mockLocalDreamModule.generateImage).toHaveBeenCalledWith({
        prompt: 'A cat',
        negativePrompt: 'blurry',
        steps: 25,
        guidanceScale: 8.0,
        seed: 42,
        width: 512,
        height: 512,
        previewInterval: 2,
      });
    });

    it('returns a GeneratedImage with correct shape', async () => {
      mockLocalDreamModule.generateImage.mockResolvedValue({
        id: 'img-result',
        imagePath: '/gen/result.png',
        width: 512,
        height: 512,
        seed: 99,
      });

      const result = await service.generateImage({ prompt: 'sunset' });

      expect(result).toHaveProperty('id', 'img-result');
      expect(result).toHaveProperty('prompt', 'sunset');
      expect(result).toHaveProperty('imagePath', '/gen/result.png');
      expect(result).toHaveProperty('width', 512);
      expect(result).toHaveProperty('height', 512);
      expect(result).toHaveProperty('seed', 99);
      expect(result).toHaveProperty('createdAt');
    });

    it('subscribes to LocalDreamProgress events during generation', async () => {
      mockLocalDreamModule.generateImage.mockResolvedValue({
        id: 'img-1', imagePath: '/p.png', width: 512, height: 512, seed: 1,
      });

      const onProgress = jest.fn();
      await service.generateImage({ prompt: 'test' }, onProgress);

      expect(mockAddListener).toHaveBeenCalledWith(
        'LocalDreamProgress',
        expect.any(Function),
      );
    });

    it('removes progress listener after generation completes', async () => {
      const mockRemove = jest.fn();
      mockAddListener.mockReturnValue({ remove: mockRemove });
      mockLocalDreamModule.generateImage.mockResolvedValue({
        id: 'img-1', imagePath: '/p.png', width: 512, height: 512, seed: 1,
      });

      await service.generateImage({ prompt: 'test' });

      expect(mockRemove).toHaveBeenCalled();
    });

    it('removes progress listener after generation fails', async () => {
      const mockRemove = jest.fn();
      mockAddListener.mockReturnValue({ remove: mockRemove });
      mockLocalDreamModule.generateImage.mockRejectedValue(new Error('OOM'));

      await service.generateImage({ prompt: 'test' }).catch(() => {});

      expect(mockRemove).toHaveBeenCalled();
    });

    it('rejects when generation already in progress', async () => {
      // Start a generation that doesn't resolve immediately
      let resolveGen: any;
      mockLocalDreamModule.generateImage.mockImplementation(
        () => new Promise(resolve => { resolveGen = resolve; }),
      );

      const first = service.generateImage({ prompt: 'first' });

      await expect(
        service.generateImage({ prompt: 'second' }),
      ).rejects.toThrow('already in progress');

      // Clean up
      resolveGen({ id: 'x', imagePath: '/x.png', width: 512, height: 512, seed: 1 });
      await first;
    });

    it('calls onError callback on native failure', async () => {
      mockLocalDreamModule.generateImage.mockRejectedValue(new Error('Core ML failed'));

      const onError = jest.fn();

      await service.generateImage({ prompt: 'test' }, undefined, undefined, undefined, onError)
        .catch(() => {});

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe('Core ML failed');
    });

    it('calls onComplete callback on success', async () => {
      mockLocalDreamModule.generateImage.mockResolvedValue({
        id: 'img-ok', imagePath: '/ok.png', width: 512, height: 512, seed: 7,
      });

      const onComplete = jest.fn();

      await service.generateImage({ prompt: 'test' }, undefined, undefined, onComplete);

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'img-ok' }),
      );
    });

    it('forwards progress events from emitter', async () => {
      let progressHandler: any;
      mockAddListener.mockImplementation((event: string, handler: any) => {
        if (event === 'LocalDreamProgress') {
          progressHandler = handler;
        }
        return { remove: jest.fn() };
      });

      mockLocalDreamModule.generateImage.mockImplementation(async () => {
        // Simulate progress event mid-generation
        progressHandler?.({ step: 5, totalSteps: 20, progress: 0.25 });
        return { id: 'img', imagePath: '/p.png', width: 512, height: 512, seed: 1 };
      });

      const onProgress = jest.fn();
      await service.generateImage({ prompt: 'test' }, onProgress);

      expect(onProgress).toHaveBeenCalledWith({
        step: 5,
        totalSteps: 20,
        progress: 0.25,
      });
    });

    it('forwards preview events from emitter', async () => {
      let progressHandler: any;
      mockAddListener.mockImplementation((event: string, handler: any) => {
        if (event === 'LocalDreamProgress') {
          progressHandler = handler;
        }
        return { remove: jest.fn() };
      });

      mockLocalDreamModule.generateImage.mockImplementation(async () => {
        progressHandler?.({
          step: 10,
          totalSteps: 20,
          progress: 0.5,
          previewPath: '/preview/step_10.png',
        });
        return { id: 'img', imagePath: '/p.png', width: 512, height: 512, seed: 1 };
      });

      const onPreview = jest.fn();
      await service.generateImage({ prompt: 'test' }, undefined, onPreview);

      expect(onPreview).toHaveBeenCalledWith({
        previewPath: '/preview/step_10.png',
        step: 10,
        totalSteps: 20,
      });
    });
  });

  // ========================================================================
  // Thread tracking
  // ========================================================================
  describe('thread tracking', () => {
    let service: any;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.isolateModules(() => {
        const { Platform: P } = require('react-native');
        P.select = (opts: any) => opts.android;
        P.OS = 'android';

        service = require('../../../src/services/localDreamGenerator').localDreamGeneratorService;
      });
    });

    it('tracks loaded threads after loadModel', async () => {
      mockLocalDreamModule.loadModel.mockResolvedValue(true);

      expect(service.getLoadedThreads()).toBeNull();

      await service.loadModel('/path', 6);

      expect(service.getLoadedThreads()).toBe(6);
    });

    it('clears threads after unloadModel', async () => {
      mockLocalDreamModule.loadModel.mockResolvedValue(true);
      mockLocalDreamModule.unloadModel.mockResolvedValue(true);

      await service.loadModel('/path', 4);
      expect(service.getLoadedThreads()).toBe(4);

      await service.unloadModel();
      expect(service.getLoadedThreads()).toBeNull();
    });
  });

  // ========================================================================
  // Error handling
  // ========================================================================
  describe('error handling', () => {
    let service: any;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.isolateModules(() => {
        const { Platform: P } = require('react-native');
        P.select = (opts: any) => opts.android;
        P.OS = 'android';

        service = require('../../../src/services/localDreamGenerator').localDreamGeneratorService;
      });
    });

    it('isModelLoaded returns false on native error', async () => {
      mockLocalDreamModule.isModelLoaded.mockRejectedValue(new Error('native crash'));

      const result = await service.isModelLoaded();

      expect(result).toBe(false);
    });

    it('getLoadedModelPath returns null on native error', async () => {
      mockLocalDreamModule.getLoadedModelPath.mockRejectedValue(new Error('native crash'));

      const result = await service.getLoadedModelPath();

      expect(result).toBeNull();
    });

    it('getGeneratedImages returns empty array on native error', async () => {
      mockLocalDreamModule.getGeneratedImages.mockRejectedValue(new Error('native crash'));

      const result = await service.getGeneratedImages();

      expect(result).toEqual([]);
    });
  });
});
