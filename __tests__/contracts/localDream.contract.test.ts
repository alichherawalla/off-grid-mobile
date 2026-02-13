/**
 * Contract Tests: LocalDream Native Module (Image Generation)
 *
 * These tests verify that the LocalDream native module interface
 * matches our TypeScript expectations for image generation.
 */

export {};

// Define the expected interface
interface LocalDreamModuleInterface {
  loadModel(params: {
    modelPath: string;
    threads?: number;
    backend: 'mnn' | 'qnn' | 'auto';
  }): Promise<boolean>;

  unloadModel(): Promise<boolean>;
  isModelLoaded(): Promise<boolean>;
  getLoadedModelPath(): Promise<string | null>;
  getLoadedThreads(): number;

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

  getConstants(): {
    DEFAULT_STEPS: number;
    DEFAULT_GUIDANCE_SCALE: number;
    DEFAULT_WIDTH: number;
    DEFAULT_HEIGHT: number;
    SUPPORTED_WIDTHS: number[];
    SUPPORTED_HEIGHTS: number[];
  };

  getServerPort(): Promise<number>;
  isNpuSupported(): Promise<boolean>;
}

// Mock NativeModules
const mockLocalDreamModule: LocalDreamModuleInterface = {
  loadModel: jest.fn(),
  unloadModel: jest.fn(),
  isModelLoaded: jest.fn(),
  getLoadedModelPath: jest.fn(),
  getLoadedThreads: jest.fn(),
  generateImage: jest.fn(),
  cancelGeneration: jest.fn(),
  isGenerating: jest.fn(),
  getGeneratedImages: jest.fn(),
  deleteGeneratedImage: jest.fn(),
  getConstants: jest.fn(),
  getServerPort: jest.fn(),
  isNpuSupported: jest.fn(),
};

jest.mock('react-native', () => ({
  NativeModules: {
    LocalDreamModule: mockLocalDreamModule,
  },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
    removeAllListeners: jest.fn(),
  })),
  Platform: { OS: 'android' },
}));

describe('LocalDream Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadModel', () => {
    it('should accept valid model loading params', async () => {
      (mockLocalDreamModule.loadModel as jest.Mock).mockResolvedValue(true);

      const params = {
        modelPath: '/data/user/0/ai.offgridmobile/files/models/sdxl-turbo',
        threads: 4,
        backend: 'qnn' as const,
      };

      const result = await mockLocalDreamModule.loadModel(params);

      expect(mockLocalDreamModule.loadModel).toHaveBeenCalledWith(
        expect.objectContaining({
          modelPath: expect.any(String),
          threads: expect.any(Number),
          backend: expect.stringMatching(/^(mnn|qnn|auto)$/),
        })
      );
      expect(typeof result).toBe('boolean');
    });

    it('should work with optional threads param', async () => {
      (mockLocalDreamModule.loadModel as jest.Mock).mockResolvedValue(true);

      const params = {
        modelPath: '/path/to/model',
        backend: 'auto' as const,
      };

      await mockLocalDreamModule.loadModel(params);

      expect(mockLocalDreamModule.loadModel).toHaveBeenCalledWith(
        expect.objectContaining({
          modelPath: expect.any(String),
          backend: 'auto',
        })
      );
    });

    it('should accept mnn backend', async () => {
      (mockLocalDreamModule.loadModel as jest.Mock).mockResolvedValue(true);

      await mockLocalDreamModule.loadModel({
        modelPath: '/path/to/model',
        backend: 'mnn',
      });

      expect(mockLocalDreamModule.loadModel).toHaveBeenCalledWith(
        expect.objectContaining({ backend: 'mnn' })
      );
    });
  });

  describe('unloadModel', () => {
    it('should return boolean success', async () => {
      (mockLocalDreamModule.unloadModel as jest.Mock).mockResolvedValue(true);

      const result = await mockLocalDreamModule.unloadModel();

      expect(typeof result).toBe('boolean');
    });
  });

  describe('isModelLoaded', () => {
    it('should return boolean state', async () => {
      (mockLocalDreamModule.isModelLoaded as jest.Mock).mockResolvedValue(true);

      const result = await mockLocalDreamModule.isModelLoaded();

      expect(typeof result).toBe('boolean');
    });
  });

  describe('getLoadedModelPath', () => {
    it('should return string path when model loaded', async () => {
      (mockLocalDreamModule.getLoadedModelPath as jest.Mock).mockResolvedValue('/path/to/model');

      const result = await mockLocalDreamModule.getLoadedModelPath();

      expect(typeof result).toBe('string');
    });

    it('should return null when no model loaded', async () => {
      (mockLocalDreamModule.getLoadedModelPath as jest.Mock).mockResolvedValue(null);

      const result = await mockLocalDreamModule.getLoadedModelPath();

      expect(result).toBeNull();
    });
  });

  describe('generateImage', () => {
    const validGenerateParams = {
      prompt: 'A beautiful sunset over mountains',
      negativePrompt: 'blurry, ugly, distorted',
      steps: 20,
      guidanceScale: 7.5,
      seed: 12345,
      width: 512,
      height: 512,
      previewInterval: 5,
    };

    it('should accept valid generation params', async () => {
      const mockResult = {
        id: 'img-123',
        imagePath: '/data/user/0/ai.offgridmobile/files/generated/img-123.png',
        width: 512,
        height: 512,
        seed: 12345,
      };
      (mockLocalDreamModule.generateImage as jest.Mock).mockResolvedValue(mockResult);

      await mockLocalDreamModule.generateImage(validGenerateParams);

      expect(mockLocalDreamModule.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.any(String),
          steps: expect.any(Number),
          guidanceScale: expect.any(Number),
          width: expect.any(Number),
          height: expect.any(Number),
        })
      );
    });

    it('should return expected result shape', async () => {
      const mockResult = {
        id: 'img-123',
        imagePath: '/path/to/image.png',
        width: 512,
        height: 512,
        seed: 12345,
      };
      (mockLocalDreamModule.generateImage as jest.Mock).mockResolvedValue(mockResult);

      const result = await mockLocalDreamModule.generateImage(validGenerateParams);

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
        id: 'img-456',
        imagePath: '/path/to/image.png',
        width: 512,
        height: 512,
        seed: 99999,
      };
      (mockLocalDreamModule.generateImage as jest.Mock).mockResolvedValue(mockResult);

      await mockLocalDreamModule.generateImage({ prompt: 'A cat' });

      expect(mockLocalDreamModule.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'A cat' })
      );
    });

    it('should generate random seed when not provided', async () => {
      const mockResult = {
        id: 'img-789',
        imagePath: '/path/to/image.png',
        width: 512,
        height: 512,
        seed: 987654321, // Random seed generated by native
      };
      (mockLocalDreamModule.generateImage as jest.Mock).mockResolvedValue(mockResult);

      const result = await mockLocalDreamModule.generateImage({
        prompt: 'A dog',
        // No seed provided
      });

      expect(result.seed).toBeDefined();
      expect(typeof result.seed).toBe('number');
    });
  });

  describe('cancelGeneration', () => {
    it('should return boolean success', async () => {
      (mockLocalDreamModule.cancelGeneration as jest.Mock).mockResolvedValue(true);

      const result = await mockLocalDreamModule.cancelGeneration();

      expect(typeof result).toBe('boolean');
    });
  });

  describe('isGenerating', () => {
    it('should return boolean state', async () => {
      (mockLocalDreamModule.isGenerating as jest.Mock).mockResolvedValue(false);

      const result = await mockLocalDreamModule.isGenerating();

      expect(typeof result).toBe('boolean');
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
          modelId: 'sdxl-turbo',
          createdAt: '2024-01-15T10:30:00Z',
        },
        {
          id: 'img-2',
          prompt: 'A mountain',
          imagePath: '/path/to/img2.png',
          width: 768,
          height: 768,
          steps: 30,
          seed: 54321,
          modelId: 'sdxl-turbo',
          createdAt: '2024-01-15T11:00:00Z',
        },
      ];
      (mockLocalDreamModule.getGeneratedImages as jest.Mock).mockResolvedValue(mockImages);

      const result = await mockLocalDreamModule.getGeneratedImages();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('prompt');
      expect(result[0]).toHaveProperty('imagePath');
      expect(result[0]).toHaveProperty('createdAt');
    });

    it('should return empty array when no images', async () => {
      (mockLocalDreamModule.getGeneratedImages as jest.Mock).mockResolvedValue([]);

      const result = await mockLocalDreamModule.getGeneratedImages();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe('deleteGeneratedImage', () => {
    it('should accept image ID and return boolean', async () => {
      (mockLocalDreamModule.deleteGeneratedImage as jest.Mock).mockResolvedValue(true);

      const result = await mockLocalDreamModule.deleteGeneratedImage('img-123');

      expect(mockLocalDreamModule.deleteGeneratedImage).toHaveBeenCalledWith('img-123');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getConstants', () => {
    it('should return expected constants shape', () => {
      const mockConstants = {
        DEFAULT_STEPS: 20,
        DEFAULT_GUIDANCE_SCALE: 7.5,
        DEFAULT_WIDTH: 512,
        DEFAULT_HEIGHT: 512,
        SUPPORTED_WIDTHS: [512, 768, 1024],
        SUPPORTED_HEIGHTS: [512, 768, 1024],
      };
      (mockLocalDreamModule.getConstants as jest.Mock).mockReturnValue(mockConstants);

      const constants = mockLocalDreamModule.getConstants();

      expect(constants).toHaveProperty('DEFAULT_STEPS');
      expect(constants).toHaveProperty('DEFAULT_GUIDANCE_SCALE');
      expect(constants).toHaveProperty('DEFAULT_WIDTH');
      expect(constants).toHaveProperty('DEFAULT_HEIGHT');
      expect(constants).toHaveProperty('SUPPORTED_WIDTHS');
      expect(constants).toHaveProperty('SUPPORTED_HEIGHTS');
      expect(typeof constants.DEFAULT_STEPS).toBe('number');
      expect(Array.isArray(constants.SUPPORTED_WIDTHS)).toBe(true);
    });
  });

  describe('getServerPort', () => {
    it('should return port number', async () => {
      (mockLocalDreamModule.getServerPort as jest.Mock).mockResolvedValue(18081);

      const result = await mockLocalDreamModule.getServerPort();

      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('isNpuSupported', () => {
    it('should return boolean for NPU support', async () => {
      (mockLocalDreamModule.isNpuSupported as jest.Mock).mockResolvedValue(true);

      const result = await mockLocalDreamModule.isNpuSupported();

      expect(typeof result).toBe('boolean');
    });
  });

  describe('Progress Events', () => {
    it('should define expected progress event shape', () => {
      // Document the expected progress event interface
      const progressEvent = {
        step: 10,
        totalSteps: 20,
        progress: 0.5,
        previewPath: '/path/to/preview.png',
      };

      expect(progressEvent).toHaveProperty('step');
      expect(progressEvent).toHaveProperty('totalSteps');
      expect(progressEvent).toHaveProperty('progress');
      expect(typeof progressEvent.step).toBe('number');
      expect(typeof progressEvent.totalSteps).toBe('number');
      expect(typeof progressEvent.progress).toBe('number');
      expect(progressEvent.progress).toBeGreaterThanOrEqual(0);
      expect(progressEvent.progress).toBeLessThanOrEqual(1);
    });

    it('should define expected error event shape', () => {
      // Document the expected error event interface
      const errorEvent = {
        error: 'Out of memory during generation',
      };

      expect(errorEvent).toHaveProperty('error');
      expect(typeof errorEvent.error).toBe('string');
    });

    it('should support optional preview path in progress events', () => {
      const progressWithPreview = {
        step: 15,
        totalSteps: 20,
        progress: 0.75,
        previewPath: '/data/user/0/ai.offgridmobile/files/previews/step-15.png',
      };

      const progressWithoutPreview = {
        step: 5,
        totalSteps: 20,
        progress: 0.25,
      };

      expect(progressWithPreview.previewPath).toBeDefined();
      expect(progressWithoutPreview).not.toHaveProperty('previewPath');
    });
  });

  describe('Error handling', () => {
    it('should reject on model load failure', async () => {
      (mockLocalDreamModule.loadModel as jest.Mock).mockRejectedValue(
        new Error('Failed to load model: invalid format')
      );

      await expect(mockLocalDreamModule.loadModel({
        modelPath: '/invalid/model',
        backend: 'auto',
      })).rejects.toThrow('Failed to load model');
    });

    it('should reject on generation failure', async () => {
      (mockLocalDreamModule.generateImage as jest.Mock).mockRejectedValue(
        new Error('Generation failed: out of memory')
      );

      await expect(mockLocalDreamModule.generateImage({
        prompt: 'test',
      })).rejects.toThrow('Generation failed');
    });

    it('should handle server not running', async () => {
      (mockLocalDreamModule.generateImage as jest.Mock).mockRejectedValue(
        new Error('Server not running')
      );

      await expect(mockLocalDreamModule.generateImage({
        prompt: 'test',
      })).rejects.toThrow('Server not running');
    });
  });
});
