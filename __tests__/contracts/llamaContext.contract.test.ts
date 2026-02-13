/**
 * Contract Tests: llama.rn Native Module
 *
 * These tests verify that the llama.rn native module interface
 * matches our TypeScript expectations. They test the shape of
 * inputs/outputs without requiring actual model execution.
 */

import { initLlama, LlamaContext } from 'llama.rn';

// Mock the native module
jest.mock('llama.rn', () => ({
  initLlama: jest.fn(),
}));

const mockInitLlama = initLlama as jest.MockedFunction<typeof initLlama>;

describe('llama.rn Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initLlama', () => {
    const validInitParams = {
      model: '/path/to/model.gguf',
      use_mlock: false,
      n_batch: 512,
      n_threads: 4,
      use_mmap: true,
      vocab_only: false,
      flash_attn: true,
      cache_type_k: 'f16' as const,
      cache_type_v: 'f16' as const,
      n_ctx: 4096,
      n_gpu_layers: 99,
    };

    it('should accept valid initialization parameters', async () => {
      const mockContext: Partial<LlamaContext> = {
        gpu: true,
        reasonNoGPU: '',
        completion: jest.fn(),
        stopCompletion: jest.fn(),
        release: jest.fn(),
      };
      mockInitLlama.mockResolvedValue(mockContext as LlamaContext);

      await initLlama(validInitParams);

      expect(mockInitLlama).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.any(String),
          n_ctx: expect.any(Number),
          n_gpu_layers: expect.any(Number),
          n_threads: expect.any(Number),
        })
      );
    });

    it('should return context with expected properties', async () => {
      const mockContext: Partial<LlamaContext> = {
        gpu: true,
        reasonNoGPU: '',
        devices: ['Apple M1'],
        model: { metadata: { 'general.name': 'test-model' } } as any,
        androidLib: undefined,
        systemInfo: 'Apple M1 Pro',
        completion: jest.fn(),
        tokenize: jest.fn(),
        stopCompletion: jest.fn(),
        release: jest.fn(),
        clearCache: jest.fn(),
      };
      mockInitLlama.mockResolvedValue(mockContext as LlamaContext);

      const context = await initLlama(validInitParams);

      expect(context).toHaveProperty('gpu');
      expect(context).toHaveProperty('completion');
      expect(context).toHaveProperty('stopCompletion');
      expect(context).toHaveProperty('release');
    });

    it('should handle GPU unavailable reason', async () => {
      const mockContext: Partial<LlamaContext> = {
        gpu: false,
        reasonNoGPU: 'Metal not supported on this device',
        completion: jest.fn(),
        release: jest.fn(),
      };
      mockInitLlama.mockResolvedValue(mockContext as LlamaContext);

      const context = await initLlama(validInitParams);

      expect(context.gpu).toBe(false);
      expect(context.reasonNoGPU).toContain('Metal');
    });
  });

  describe('LlamaContext.completion', () => {
    it('should accept text-only completion params', async () => {
      const mockCompletion = jest.fn().mockResolvedValue({});
      const mockContext: Partial<LlamaContext> = {
        completion: mockCompletion,
        release: jest.fn(),
      };
      mockInitLlama.mockResolvedValue(mockContext as LlamaContext);

      const context = await initLlama({
        model: '/path/to/model.gguf',
        n_ctx: 4096,
        n_gpu_layers: 0,
      } as any);

      const completionParams = {
        prompt: 'Hello, how are you?',
        n_predict: 256,
        temperature: 0.7,
        top_k: 40,
        top_p: 0.95,
        penalty_repeat: 1.1,
        stop: ['</s>', '<|eot_id|>'],
      };

      const tokenCallback = jest.fn();
      await context.completion(completionParams, tokenCallback);

      expect(mockCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.any(String),
          n_predict: expect.any(Number),
          temperature: expect.any(Number),
          stop: expect.any(Array),
        }),
        expect.any(Function)
      );
    });

    it('should accept chat messages format', async () => {
      const mockCompletion = jest.fn().mockResolvedValue({});
      const mockContext: Partial<LlamaContext> = {
        completion: mockCompletion,
        release: jest.fn(),
      };
      mockInitLlama.mockResolvedValue(mockContext as LlamaContext);

      const context = await initLlama({ model: '/path/to/model.gguf' } as any);

      const completionParams = {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello!' },
        ],
        n_predict: 256,
        temperature: 0.7,
        top_k: 40,
        top_p: 0.95,
        penalty_repeat: 1.1,
        stop: [],
      };

      await context.completion(completionParams, jest.fn());

      expect(mockCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user' }),
          ]),
        }),
        expect.any(Function)
      );
    });

    it('should accept multimodal messages with images', async () => {
      const mockCompletion = jest.fn().mockResolvedValue({});
      const mockContext: Partial<LlamaContext> = {
        completion: mockCompletion,
        release: jest.fn(),
      };
      mockInitLlama.mockResolvedValue(mockContext as LlamaContext);

      const context = await initLlama({ model: '/path/to/model.gguf' } as any);

      const multimodalMessage = {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image_url', image_url: { url: 'file:///path/to/image.jpg' } },
        ],
      };

      const completionParams = {
        messages: [multimodalMessage],
        n_predict: 256,
        temperature: 0.7,
        top_k: 40,
        top_p: 0.95,
        penalty_repeat: 1.1,
        stop: [],
      };

      await context.completion(completionParams, jest.fn());

      expect(mockCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.arrayContaining([
                expect.objectContaining({ type: 'text' }),
                expect.objectContaining({ type: 'image_url' }),
              ]),
            }),
          ]),
        }),
        expect.any(Function)
      );
    });

    it('should call token callback with expected shape', async () => {
      const tokenCallback = jest.fn();
      const mockCompletion = jest.fn().mockImplementation(async (params, callback) => {
        // Simulate token streaming
        callback({ token: 'Hello' });
        callback({ token: ' ' });
        callback({ token: 'world' });
        return {};
      });

      const mockContext: Partial<LlamaContext> = {
        completion: mockCompletion,
        release: jest.fn(),
      };
      mockInitLlama.mockResolvedValue(mockContext as LlamaContext);

      const context = await initLlama({ model: '/path/to/model.gguf' } as any);
      await context.completion({ prompt: 'Hi', n_predict: 10 } as any, tokenCallback);

      expect(tokenCallback).toHaveBeenCalledWith(expect.objectContaining({ token: expect.any(String) }));
      expect(tokenCallback).toHaveBeenCalledTimes(3);
    });
  });

  describe('LlamaContext.tokenize', () => {
    it('should return token array', async () => {
      const mockTokenize = jest.fn().mockResolvedValue({ tokens: [1, 2, 3, 4, 5] });
      const mockContext: Partial<LlamaContext> = {
        tokenize: mockTokenize,
        release: jest.fn(),
      };
      mockInitLlama.mockResolvedValue(mockContext as LlamaContext);

      const context = await initLlama({ model: '/path/to/model.gguf' } as any);
      const result = await context.tokenize!('Hello world');

      expect(result).toHaveProperty('tokens');
      expect(Array.isArray(result.tokens)).toBe(true);
      expect(result.tokens?.every(t => typeof t === 'number')).toBe(true);
    });
  });

  describe('LlamaContext.initMultimodal', () => {
    it('should accept mmproj path and GPU flag', async () => {
      const mockInitMultimodal = jest.fn().mockResolvedValue(true);
      const mockContext: Partial<LlamaContext> = {
        initMultimodal: mockInitMultimodal,
        release: jest.fn(),
      };
      mockInitLlama.mockResolvedValue(mockContext as LlamaContext);

      const context = await initLlama({ model: '/path/to/model.gguf' } as any);
      const result = await context.initMultimodal!({
        path: '/path/to/mmproj.gguf',
        use_gpu: true,
      });

      expect(mockInitMultimodal).toHaveBeenCalledWith({
        path: expect.any(String),
        use_gpu: expect.any(Boolean),
      });
      expect(typeof result).toBe('boolean');
    });
  });

  describe('LlamaContext.getMultimodalSupport', () => {
    it('should return support flags', async () => {
      const mockGetMultimodalSupport = jest.fn().mockResolvedValue({
        vision: true,
        audio: false,
      });
      const mockContext: Partial<LlamaContext> = {
        getMultimodalSupport: mockGetMultimodalSupport,
        release: jest.fn(),
      };
      mockInitLlama.mockResolvedValue(mockContext as LlamaContext);

      const context = await initLlama({ model: '/path/to/model.gguf' } as any);
      const support = await context.getMultimodalSupport!();

      expect(support).toHaveProperty('vision');
      expect(support).toHaveProperty('audio');
      expect(typeof support.vision).toBe('boolean');
    });
  });

  describe('LlamaContext.stopCompletion', () => {
    it('should be callable and return promise', async () => {
      const mockStopCompletion = jest.fn().mockResolvedValue(undefined);
      const mockContext: Partial<LlamaContext> = {
        stopCompletion: mockStopCompletion,
        release: jest.fn(),
      };
      mockInitLlama.mockResolvedValue(mockContext as LlamaContext);

      const context = await initLlama({ model: '/path/to/model.gguf' } as any);
      await context.stopCompletion();

      expect(mockStopCompletion).toHaveBeenCalled();
    });
  });

  describe('LlamaContext.clearCache', () => {
    it('should accept optional clearData flag', async () => {
      const mockClearCache = jest.fn().mockResolvedValue(undefined);
      const mockContext: Partial<LlamaContext> = {
        clearCache: mockClearCache,
        release: jest.fn(),
      };
      mockInitLlama.mockResolvedValue(mockContext as LlamaContext);

      const context = await initLlama({ model: '/path/to/model.gguf' } as any);

      // Without flag
      await context.clearCache!();
      expect(mockClearCache).toHaveBeenCalled();

      // With flag
      mockClearCache.mockClear();
      await context.clearCache!(true);
      expect(mockClearCache).toHaveBeenCalledWith(true);
    });
  });

  describe('LlamaContext.release', () => {
    it('should be callable for cleanup', async () => {
      const mockRelease = jest.fn().mockResolvedValue(undefined);
      const mockContext: Partial<LlamaContext> = {
        release: mockRelease,
      };
      mockInitLlama.mockResolvedValue(mockContext as LlamaContext);

      const context = await initLlama({ model: '/path/to/model.gguf' } as any);
      await context.release();

      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should reject on invalid model path', async () => {
      mockInitLlama.mockRejectedValue(new Error('Failed to load model: file not found'));

      await expect(initLlama({ model: '/invalid/path.gguf' } as any))
        .rejects.toThrow('Failed to load model');
    });

    it('should reject on out of memory', async () => {
      mockInitLlama.mockRejectedValue(new Error('Failed to allocate memory'));

      await expect(initLlama({ model: '/path/to/large-model.gguf' } as any))
        .rejects.toThrow('memory');
    });
  });
});
