/**
 * LLMService Unit Tests
 *
 * Tests for the core LLM inference service (model loading, generation, context management).
 * Priority: P0 (Critical) - Core inference engine.
 */

import { initLlama } from 'llama.rn';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { llmService } from '../../../src/services/llm';
import { useAppStore } from '../../../src/stores/appStore';
import { resetStores } from '../../utils/testHelpers';
import { createMockLlamaContext } from '../../utils/testHelpers';
import { createMessage, createUserMessage, createAssistantMessage, createSystemMessage } from '../../utils/factories';

const mockedInitLlama = initLlama as jest.MockedFunction<typeof initLlama>;
const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;

describe('LLMService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStores();

    // Reset singleton state
    (llmService as any).context = null;
    (llmService as any).currentModelPath = null;
    (llmService as any).isGenerating = false;
    (llmService as any).multimodalSupport = null;
    (llmService as any).multimodalInitialized = false;
    (llmService as any).gpuEnabled = false;
    (llmService as any).gpuReason = '';
    (llmService as any).gpuDevices = [];
    (llmService as any).activeGpuLayers = 0;
    (llmService as any).performanceStats = {
      lastTokensPerSecond: 0,
      lastDecodeTokensPerSecond: 0,
      lastTimeToFirstToken: 0,
      lastGenerationTime: 0,
      lastTokenCount: 0,
    };
    (llmService as any).currentSettings = {
      nThreads: 6,
      nBatch: 256,
      contextLength: 2048,
    };
  });

  // ========================================================================
  // loadModel
  // ========================================================================
  describe('loadModel', () => {
    it('calls initLlama with correct parameters', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      await llmService.loadModel('/models/test.gguf');

      expect(initLlama).toHaveBeenCalledWith(
        expect.objectContaining({
          model: '/models/test.gguf',
        })
      );
      expect(llmService.isModelLoaded()).toBe(true);
      expect(llmService.getLoadedModelPath()).toBe('/models/test.gguf');
    });

    it('throws when model file not found', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      await expect(llmService.loadModel('/missing/model.gguf')).rejects.toThrow('Model file not found');
    });

    it('skips loading if same model already loaded', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      await llmService.loadModel('/models/test.gguf');
      await llmService.loadModel('/models/test.gguf');

      expect(initLlama).toHaveBeenCalledTimes(1);
    });

    it('unloads existing model before loading different one', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx1 = createMockLlamaContext();
      const ctx2 = createMockLlamaContext();
      mockedInitLlama
        .mockResolvedValueOnce(ctx1 as any)
        .mockResolvedValueOnce(ctx2 as any);

      await llmService.loadModel('/models/model1.gguf');
      await llmService.loadModel('/models/model2.gguf');

      expect(ctx1.release).toHaveBeenCalled();
    });

    it('falls back to CPU when GPU init fails', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      // GPU load fails, CPU load succeeds
      const ctx = createMockLlamaContext();
      mockedInitLlama
        .mockRejectedValueOnce(new Error('GPU error'))
        .mockResolvedValueOnce(ctx as any);

      // Enable GPU in settings
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          enableGpu: true,
          gpuLayers: 6,
        },
      });

      await llmService.loadModel('/models/test.gguf');

      expect(initLlama).toHaveBeenCalledTimes(2);
      expect(llmService.isModelLoaded()).toBe(true);
    });

    it('falls back to smaller context when CPU also fails', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      const ctx = createMockLlamaContext();
      mockedInitLlama
        .mockRejectedValueOnce(new Error('GPU error'))
        .mockRejectedValueOnce(new Error('OOM with ctx=4096'))
        .mockResolvedValueOnce(ctx as any);

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          contextLength: 4096,
          enableGpu: true,
        },
      });

      await llmService.loadModel('/models/test.gguf');

      // Third call should use ctx=2048
      expect(initLlama).toHaveBeenCalledTimes(3);
      const thirdCallArgs = (initLlama as jest.Mock).mock.calls[2][0];
      expect(thirdCallArgs.n_ctx).toBe(2048);
    });

    it('warns when mmproj file not found but continues', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true) // model exists
        .mockResolvedValueOnce(false); // mmproj doesn't exist

      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await llmService.loadModel('/models/test.gguf', '/models/mmproj.gguf');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('MMProj file not found'));
      expect(llmService.isModelLoaded()).toBe(true);
      consoleSpy.mockRestore();
    });

    it('initializes multimodal when mmproj path provided and exists', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 800 * 1024 * 1024 } as any);

      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(true)),
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: true, audio: false })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);

      await llmService.loadModel('/models/test.gguf', '/models/mmproj.gguf');

      expect(ctx.initMultimodal).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/models/mmproj.gguf' })
      );
      expect(llmService.supportsVision()).toBe(true);
    });

    it('reads settings from appStore', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          nThreads: 8,
          nBatch: 512,
          contextLength: 4096,
        },
      });

      await llmService.loadModel('/models/test.gguf');

      expect(initLlama).toHaveBeenCalledWith(
        expect.objectContaining({
          n_threads: 8,
          n_batch: 512,
          n_ctx: 4096,
        })
      );
    });

    it('captures GPU status from context', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        gpu: true,
        reasonNoGPU: '',
        devices: ['Metal'],
      });
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          enableGpu: true,
          gpuLayers: 99,
        },
      });

      await llmService.loadModel('/models/test.gguf');

      const gpuInfo = llmService.getGpuInfo();
      expect(gpuInfo.gpu).toBe(true);
      expect(gpuInfo.gpuLayers).toBe(99);
    });

    it('resets state on final error', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedInitLlama.mockRejectedValue(new Error('fatal'));

      // Disable GPU to skip retries
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          enableGpu: false,
        },
      });

      await expect(llmService.loadModel('/models/test.gguf')).rejects.toThrow();

      expect(llmService.isModelLoaded()).toBe(false);
      expect(llmService.getLoadedModelPath()).toBeNull();
    });
  });

  // ========================================================================
  // initializeMultimodal
  // ========================================================================
  describe('initializeMultimodal', () => {
    it('returns false when no context', async () => {
      const result = await llmService.initializeMultimodal('/mmproj.gguf');
      expect(result).toBe(false);
    });

    it('calls context.initMultimodal with correct path', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(true)),
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: true, audio: false })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const result = await llmService.initializeMultimodal('/models/mmproj.gguf');

      expect(ctx.initMultimodal).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/models/mmproj.gguf' })
      );
      expect(result).toBe(true);
    });

    it('sets vision support on success', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(true)),
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: true, audio: false })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      await llmService.initializeMultimodal('/mmproj.gguf');

      expect(llmService.supportsVision()).toBe(true);
    });

    it('returns false on initMultimodal failure', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(false)),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const result = await llmService.initializeMultimodal('/mmproj.gguf');

      expect(result).toBe(false);
      expect(llmService.supportsVision()).toBe(false);
    });

    it('handles exception gracefully', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.reject(new Error('crash'))),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const result = await llmService.initializeMultimodal('/mmproj.gguf');

      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // unloadModel
  // ========================================================================
  describe('unloadModel', () => {
    it('releases context and resets state', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      await llmService.unloadModel();

      expect(ctx.release).toHaveBeenCalled();
      expect(llmService.isModelLoaded()).toBe(false);
      expect(llmService.getLoadedModelPath()).toBeNull();
      expect(llmService.getMultimodalSupport()).toBeNull();
    });

    it('is safe when no model loaded', async () => {
      await llmService.unloadModel(); // Should not throw
      expect(llmService.isModelLoaded()).toBe(false);
    });
  });

  // ========================================================================
  // generateResponse
  // ========================================================================
  describe('generateResponse', () => {
    const setupLoadedModel = async (overrides: Record<string, any> = {}) => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        completion: jest.fn(async (params: any, callback: any) => {
          callback({ token: 'Hello' });
          callback({ token: ' World' });
          return { text: 'Hello World', tokens_predicted: 2 };
        }),
        tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2, 3] })),
        ...overrides,
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');
      return ctx;
    };

    it('throws when no model loaded', async () => {
      const messages = [createUserMessage('Hello')];

      await expect(llmService.generateResponse(messages)).rejects.toThrow('No model loaded');
    });

    it('throws when generation already in progress', async () => {
      await setupLoadedModel();
      (llmService as any).isGenerating = true;

      const messages = [createUserMessage('Hello')];

      await expect(llmService.generateResponse(messages)).rejects.toThrow('Generation already in progress');
    });

    it('calls onThinking callback', async () => {
      await setupLoadedModel();
      const messages = [createUserMessage('Hello')];
      const onThinking = jest.fn();

      await llmService.generateResponse(messages, undefined, undefined, undefined, onThinking);

      expect(onThinking).toHaveBeenCalled();
    });

    it('streams tokens via onStream callback', async () => {
      await setupLoadedModel();
      const messages = [createUserMessage('Hello')];
      const tokens: string[] = [];

      await llmService.generateResponse(messages, (token) => tokens.push(token));

      expect(tokens).toEqual(['Hello', ' World']);
    });

    it('returns full response and calls onComplete', async () => {
      await setupLoadedModel();
      const messages = [createUserMessage('Hello')];
      const onComplete = jest.fn();

      const result = await llmService.generateResponse(messages, undefined, onComplete);

      expect(result).toBe('Hello World');
      expect(onComplete).toHaveBeenCalledWith('Hello World');
    });

    it('updates performance stats', async () => {
      await setupLoadedModel();
      const messages = [createUserMessage('Hello')];

      await llmService.generateResponse(messages);

      const stats = llmService.getPerformanceStats();
      expect(stats.lastTokenCount).toBe(2);
      expect(stats.lastGenerationTime).toBeGreaterThanOrEqual(0);
    });

    it('resets isGenerating on error', async () => {
      await setupLoadedModel({
        completion: jest.fn(() => Promise.reject(new Error('gen error'))),
        tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2] })),
      });

      const messages = [createUserMessage('Hello')];

      await expect(llmService.generateResponse(messages)).rejects.toThrow('gen error');
      expect(llmService.isCurrentlyGenerating()).toBe(false);
    });

    it('calls onError callback on failure', async () => {
      await setupLoadedModel({
        completion: jest.fn(() => Promise.reject(new Error('gen error'))),
        tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2] })),
      });

      const messages = [createUserMessage('Hello')];
      const onError = jest.fn();

      await expect(
        llmService.generateResponse(messages, undefined, undefined, onError)
      ).rejects.toThrow();

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('uses text-only path when no images', async () => {
      const ctx = await setupLoadedModel();
      const messages = [createUserMessage('Hello')];

      await llmService.generateResponse(messages);

      const callArgs = ctx.completion.mock.calls[0][0];
      expect(callArgs).toHaveProperty('prompt');
      expect(callArgs).not.toHaveProperty('messages');
    });

    it('ignores tokens after generation stops', async () => {
      const tokens: string[] = [];
      await setupLoadedModel({
        completion: jest.fn(async (params: any, callback: any) => {
          callback({ token: 'Hello' });
          // Simulate stop
          (llmService as any).isGenerating = false;
          callback({ token: ' ignored' });
          return { text: 'Hello', tokens_predicted: 1 };
        }),
        tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2] })),
      });

      const messages = [createUserMessage('Hello')];
      await llmService.generateResponse(messages, (t) => tokens.push(t));

      expect(tokens).toEqual(['Hello']);
    });
  });

  // ========================================================================
  // context window management (private, tested through generateResponse)
  // ========================================================================
  describe('context window management', () => {
    const setupForContextTest = async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const tokenizeResult = (text: string) => {
        // Simulate ~1 token per 4 chars
        const count = Math.ceil(text.length / 4);
        return Promise.resolve({ tokens: new Array(count) });
      };

      const ctx = createMockLlamaContext({
        completion: jest.fn(async (params: any, callback: any) => {
          callback({ token: 'OK' });
          return { text: 'OK', tokens_predicted: 1 };
        }),
        tokenize: jest.fn(tokenizeResult),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');
      return ctx;
    };

    it('preserves system message', async () => {
      const ctx = await setupForContextTest();

      const messages = [
        createSystemMessage('You are helpful'),
        createUserMessage('Hello'),
      ];

      await llmService.generateResponse(messages);

      const prompt = ctx.completion.mock.calls[0][0].prompt;
      expect(prompt).toContain('You are helpful');
    });

    it('keeps all messages when they fit in context', async () => {
      const ctx = await setupForContextTest();

      const messages = [
        createSystemMessage('System'),
        createUserMessage('Q1'),
        createAssistantMessage('A1'),
        createUserMessage('Q2'),
      ];

      await llmService.generateResponse(messages);

      const prompt = ctx.completion.mock.calls[0][0].prompt;
      expect(prompt).toContain('Q1');
      expect(prompt).toContain('A1');
      expect(prompt).toContain('Q2');
    });

    it('truncates old messages while keeping recent ones', async () => {
      const ctx = await setupForContextTest();

      // Large context so system + recent fit, but not all messages
      // contextLength=200, safety=0.85 → 170 tokens budget
      // minus SYSTEM_PROMPT_RESERVE(256) + RESPONSE_RESERVE(512) → negative, so use default
      // Instead, make context large enough to partially fit
      (llmService as any).currentSettings.contextLength = 2048;

      // Create many messages to force some truncation
      const messages = [
        createSystemMessage('System prompt'),
        ...Array.from({ length: 50 }, (_, i) =>
          i % 2 === 0
            ? createUserMessage(`Question ${i} ${'x'.repeat(100)}`)
            : createAssistantMessage(`Response ${i} ${'y'.repeat(100)}`)
        ),
        createUserMessage('Final question'),
      ];

      await llmService.generateResponse(messages);

      const prompt = ctx.completion.mock.calls[0][0].prompt;
      // The final question should always be included
      expect(prompt).toContain('Final question');
      // System prompt should be preserved
      expect(prompt).toContain('System prompt');
    });

    it('adds context-note when truncating messages', async () => {
      const ctx = await setupForContextTest();

      // Very small context to force truncation
      (llmService as any).currentSettings.contextLength = 200;

      const messages = [
        createSystemMessage('System'),
        ...Array.from({ length: 20 }, (_, i) =>
          i % 2 === 0
            ? createUserMessage(`Question ${i} with some longer content here`)
            : createAssistantMessage(`Response ${i} with more content to fill`)
        ),
      ];

      await llmService.generateResponse(messages);

      const prompt = ctx.completion.mock.calls[0][0].prompt;
      expect(prompt).toContain('earlier message(s)');
    });
  });

  // ========================================================================
  // stopGeneration
  // ========================================================================
  describe('stopGeneration', () => {
    it('calls context.stopCompletion', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      await llmService.stopGeneration();

      expect(ctx.stopCompletion).toHaveBeenCalled();
    });

    it('resets isGenerating flag', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      (llmService as any).isGenerating = true;
      await llmService.stopGeneration();

      expect(llmService.isCurrentlyGenerating()).toBe(false);
    });

    it('is safe without context', async () => {
      await llmService.stopGeneration(); // Should not throw
      expect(llmService.isCurrentlyGenerating()).toBe(false);
    });
  });

  // ========================================================================
  // clearKVCache
  // ========================================================================
  describe('clearKVCache', () => {
    it('delegates to context.clearCache', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      await llmService.clearKVCache();

      expect(ctx.clearCache).toHaveBeenCalledWith(false);
    });

    it('is safe without context', async () => {
      await llmService.clearKVCache(); // Should not throw
    });
  });

  // ========================================================================
  // getEstimatedMemoryUsage
  // ========================================================================
  describe('getEstimatedMemoryUsage', () => {
    it('returns 0 without context', () => {
      const usage = llmService.getEstimatedMemoryUsage();
      expect(usage.contextMemoryMB).toBe(0);
      expect(usage.totalEstimatedMB).toBe(0);
    });

    it('calculates from context length', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const usage = llmService.getEstimatedMemoryUsage();
      // 2048 * 0.5 = 1024
      expect(usage.contextMemoryMB).toBe(1024);
    });
  });

  // ========================================================================
  // getGpuInfo
  // ========================================================================
  describe('getGpuInfo', () => {
    it('returns CPU backend when GPU disabled', () => {
      const info = llmService.getGpuInfo();
      expect(info.gpu).toBe(false);
      expect(info.gpuBackend).toBe('CPU');
    });

    it('returns Metal backend on iOS with GPU enabled', async () => {
      const originalOS = Platform.OS;
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({ gpu: true, devices: [] });
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, enableGpu: true, gpuLayers: 99 },
      });

      await llmService.loadModel('/models/test.gguf');

      const info = llmService.getGpuInfo();
      expect(info.gpu).toBe(true);
      expect(info.gpuBackend).toBe('Metal');

      Object.defineProperty(Platform, 'OS', { get: () => originalOS });
    });
  });

  // ========================================================================
  // tokenize / estimateContextUsage
  // ========================================================================
  describe('tokenize', () => {
    it('throws without model loaded', async () => {
      await expect(llmService.tokenize('hello')).rejects.toThrow('No model loaded');
    });

    it('returns token array', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2, 3, 4] })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const tokens = await llmService.tokenize('hello world');
      expect(tokens).toEqual([1, 2, 3, 4]);
    });
  });

  describe('estimateContextUsage', () => {
    it('returns usage percentage', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        tokenize: jest.fn(() => Promise.resolve({ tokens: new Array(500) })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const messages = [createUserMessage('Hello')];
      const usage = await llmService.estimateContextUsage(messages);

      expect(usage.tokenCount).toBe(500);
      // 500 / 2048 * 100 ≈ 24.4%
      expect(usage.percentUsed).toBeCloseTo(24.4, 0);
      expect(usage.willFit).toBe(true);
    });
  });

  // ========================================================================
  // performance settings
  // ========================================================================
  describe('performance settings', () => {
    it('updatePerformanceSettings merges settings', () => {
      llmService.updatePerformanceSettings({ nThreads: 8 });

      const settings = llmService.getPerformanceSettings();
      expect(settings.nThreads).toBe(8);
      expect(settings.nBatch).toBe(256); // unchanged
    });
  });
});
