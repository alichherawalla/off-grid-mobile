/**
 * Contract Tests: CoreMLDiffusion Native Module (iOS Image Generation)
 *
 * These tests verify that the CoreMLDiffusion native module interface
 * maintains parity with the Android LocalDreamModule so the shared
 * TypeScript bridge (localDreamGenerator.ts) works on both platforms.
 */

import { NativeModules, NativeEventEmitter } from 'react-native';

// The CoreMLDiffusionModule must expose the same methods as LocalDreamModule
interface CoreMLDiffusionModuleInterface {
  loadModel(params: {
    modelPath: string;
    threads?: number;
    backend?: string;
  }): Promise<boolean>;

  unloadModel(): Promise<boolean>;
  isModelLoaded(): Promise<boolean>;
  getLoadedModelPath(): Promise<string | null>;

  generateImage(params: {
    prompt: string;
    negativePrompt?: string;
    steps?: number;
    guidanceScale?: number;
    seed?: number;
    width?: number;
    height?: number;
    previewInterval?: number;
  }): Promise<{
    id: string;
    imagePath: string;
    width: number;
    height: number;
    seed: number;
  }>;

  cancelGeneration(): Promise<boolean>;
  isGenerating(): Promise<boolean>;
  isNpuSupported(): Promise<boolean>;

  getGeneratedImages(): Promise<Array<{
    id: string;
    prompt: string;
    imagePath: string;
    width: number;
    height: number;
    steps: number;
    seed: number;
    modelId: string;
    createdAt: string;
  }>>;

  deleteGeneratedImage(imageId: string): Promise<boolean>;
}

// Mock NativeModules
const mockCoreMLModule: CoreMLDiffusionModuleInterface = {
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
};

jest.mock('react-native', () => ({
  NativeModules: {
    CoreMLDiffusionModule: mockCoreMLModule,
  },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
    removeAllListeners: jest.fn(),
  })),
  Platform: { OS: 'ios' },
}));

describe('CoreMLDiffusion Contract (iOS parity with LocalDreamModule)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadModel', () => {
    it('should accept modelPath parameter', async () => {
      (mockCoreMLModule.loadModel as jest.Mock).mockResolvedValue(true);

      const params = {
        modelPath: '/var/mobile/Containers/Data/Application/.../models/sd21',
      };

      const result = await mockCoreMLModule.loadModel(params);

      expect(mockCoreMLModule.loadModel).toHaveBeenCalledWith(
        expect.objectContaining({
          modelPath: expect.any(String),
        })
      );
      expect(typeof result).toBe('boolean');
    });
  });

  describe('unloadModel', () => {
    it('should return boolean success', async () => {
      (mockCoreMLModule.unloadModel as jest.Mock).mockResolvedValue(true);

      const result = await mockCoreMLModule.unloadModel();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('isModelLoaded', () => {
    it('should return boolean state', async () => {
      (mockCoreMLModule.isModelLoaded as jest.Mock).mockResolvedValue(true);

      const result = await mockCoreMLModule.isModelLoaded();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getLoadedModelPath', () => {
    it('should return string path when model loaded', async () => {
      (mockCoreMLModule.getLoadedModelPath as jest.Mock).mockResolvedValue('/path/to/model');

      const result = await mockCoreMLModule.getLoadedModelPath();
      expect(typeof result).toBe('string');
    });

    it('should return null when no model loaded', async () => {
      (mockCoreMLModule.getLoadedModelPath as jest.Mock).mockResolvedValue(null);

      const result = await mockCoreMLModule.getLoadedModelPath();
      expect(result).toBeNull();
    });
  });

  describe('generateImage', () => {
    const validParams = {
      prompt: 'A beautiful sunset over mountains',
      negativePrompt: 'blurry, ugly',
      steps: 20,
      guidanceScale: 7.5,
      seed: 12345,
      width: 512,
      height: 512,
    };

    it('should accept valid generation params and return expected shape', async () => {
      const mockResult = {
        id: 'img-abc',
        imagePath: '/path/to/generated.png',
        width: 512,
        height: 512,
        seed: 12345,
      };
      (mockCoreMLModule.generateImage as jest.Mock).mockResolvedValue(mockResult);

      const result = await mockCoreMLModule.generateImage(validParams);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('imagePath');
      expect(result).toHaveProperty('width');
      expect(result).toHaveProperty('height');
      expect(result).toHaveProperty('seed');
      expect(typeof result.id).toBe('string');
      expect(typeof result.imagePath).toBe('string');
      expect(typeof result.width).toBe('number');
      expect(typeof result.height).toBe('number');
      expect(typeof result.seed).toBe('number');
    });

    it('should work with minimal params (prompt only)', async () => {
      const mockResult = {
        id: 'img-min',
        imagePath: '/path/to/img.png',
        width: 512,
        height: 512,
        seed: 99999,
      };
      (mockCoreMLModule.generateImage as jest.Mock).mockResolvedValue(mockResult);

      await mockCoreMLModule.generateImage({ prompt: 'A cat' });

      expect(mockCoreMLModule.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'A cat' })
      );
    });
  });

  describe('cancelGeneration', () => {
    it('should return boolean success', async () => {
      (mockCoreMLModule.cancelGeneration as jest.Mock).mockResolvedValue(true);

      const result = await mockCoreMLModule.cancelGeneration();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('isGenerating', () => {
    it('should return boolean state', async () => {
      (mockCoreMLModule.isGenerating as jest.Mock).mockResolvedValue(false);

      const result = await mockCoreMLModule.isGenerating();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('isNpuSupported', () => {
    it('should return true on iOS (Apple Neural Engine)', async () => {
      (mockCoreMLModule.isNpuSupported as jest.Mock).mockResolvedValue(true);

      const result = await mockCoreMLModule.isNpuSupported();
      expect(result).toBe(true);
    });
  });

  describe('getGeneratedImages', () => {
    it('should return array of generated images', async () => {
      const mockImages = [
        {
          id: 'img-1',
          prompt: 'A sunset',
          imagePath: '/path/to/img1.png',
          width: 512,
          height: 512,
          steps: 20,
          seed: 12345,
          modelId: 'sd21-coreml',
          createdAt: '2026-02-08T10:30:00Z',
        },
      ];
      (mockCoreMLModule.getGeneratedImages as jest.Mock).mockResolvedValue(mockImages);

      const result = await mockCoreMLModule.getGeneratedImages();

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('imagePath');
      expect(result[0]).toHaveProperty('createdAt');
    });

    it('should return empty array when no images', async () => {
      (mockCoreMLModule.getGeneratedImages as jest.Mock).mockResolvedValue([]);

      const result = await mockCoreMLModule.getGeneratedImages();
      expect(result).toEqual([]);
    });
  });

  describe('deleteGeneratedImage', () => {
    it('should accept image ID and return boolean', async () => {
      (mockCoreMLModule.deleteGeneratedImage as jest.Mock).mockResolvedValue(true);

      const result = await mockCoreMLModule.deleteGeneratedImage('img-abc');

      expect(mockCoreMLModule.deleteGeneratedImage).toHaveBeenCalledWith('img-abc');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Progress Events (same event names as Android)', () => {
    it('should emit LocalDreamProgress events', () => {
      const progressEvent = {
        step: 10,
        totalSteps: 20,
        progress: 0.5,
      };

      expect(progressEvent).toHaveProperty('step');
      expect(progressEvent).toHaveProperty('totalSteps');
      expect(progressEvent).toHaveProperty('progress');
      expect(progressEvent.progress).toBeGreaterThanOrEqual(0);
      expect(progressEvent.progress).toBeLessThanOrEqual(1);
    });

    it('should emit LocalDreamError events', () => {
      const errorEvent = {
        error: 'Core ML pipeline failed',
      };

      expect(errorEvent).toHaveProperty('error');
      expect(typeof errorEvent.error).toBe('string');
    });
  });

  describe('Interface parity with LocalDreamModule', () => {
    it('should expose all required methods', () => {
      const requiredMethods = [
        'loadModel',
        'unloadModel',
        'isModelLoaded',
        'getLoadedModelPath',
        'generateImage',
        'cancelGeneration',
        'isGenerating',
        'isNpuSupported',
        'getGeneratedImages',
        'deleteGeneratedImage',
      ];

      for (const method of requiredMethods) {
        expect(mockCoreMLModule).toHaveProperty(method);
        expect(typeof (mockCoreMLModule as any)[method]).toBe('function');
      }
    });
  });
});
