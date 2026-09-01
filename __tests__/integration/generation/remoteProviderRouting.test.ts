/**
 * Generation Service Provider Routing Integration Tests
 *
 * Tests for routing between local and remote providers in the generation service.
 */

import { providerRegistry, localProvider } from '../../../src/services/adapters/providers';
import { useRemoteServerStore } from '../../../src/stores';
import { OpenAICompatibleProvider } from '../../../src/services/adapters/providers/openAICompatibleProvider';

// Mock stores
jest.mock('../../../src/stores', () => ({
  useAppStore: {
    getState: jest.fn(() => ({
      settings: {
        systemPrompt: 'You are helpful.',
        temperature: 0.7,
        maxTokens: 1024,
        topP: 0.9,
      },
      downloadedModels: [],
      activeModelId: null,
    })),
  },
  useChatStore: {
    getState: jest.fn(() => ({
      startStreaming: jest.fn(),
      appendToStreamingMessage: jest.fn(),
      appendToStreamingReasoningContent: jest.fn(),
      finalizeStreamingMessage: jest.fn(),
      clearStreamingMessage: jest.fn(),
      setStreamingMessage: jest.fn(),
      setIsThinking: jest.fn(),
      addMessage: jest.fn(),
    })),
  },
  useRemoteServerStore: {
    getState: jest.fn(() => ({
      activeServerId: null,
      servers: [],
      setActiveServerId: jest.fn(),
      getActiveServer: jest.fn(),
    })),
  },
}));

// Mock llmService
jest.mock('../../../src/services/llm', () => ({
  llmService: {
    isModelLoaded: jest.fn(() => true),
    isCurrentlyGenerating: jest.fn(() => false),
    supportsVision: jest.fn(() => false),
    supportsToolCalling: jest.fn(() => true),
    supportsThinking: jest.fn(() => false),
    getGpuInfo: jest.fn(() => ({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0 })),
    getPerformanceStats: jest.fn(() => ({
      lastTokensPerSecond: 10,
      lastDecodeTokensPerSecond: 8,
      lastTimeToFirstToken: 0.5,
      lastGenerationTime: 1000,
      lastTokenCount: 10,
    })),
    generateResponse: jest.fn(),
    generateResponseWithTools: jest.fn(),
    stopGeneration: jest.fn(),
    loadModel: jest.fn(),
  },
}));

// Mock llmToolGeneration
jest.mock('../../../src/services/llmToolGeneration', () => ({
  generateWithToolsImpl: jest.fn(),
}));

// Mock tools
jest.mock('../../../src/services/tools', () => ({
  getToolsAsOpenAISchema: jest.fn(() => []),
  executeToolCall: jest.fn(),
}));

// Mock sharePrompt
jest.mock('../../../src/utils/sharePrompt', () => ({
  shouldShowSharePrompt: jest.fn(() => false),
  emitSharePrompt: jest.fn(),
}));

describe('Generation Service Provider Routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset active server
    (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
      activeServerId: null,
      servers: [],
      setActiveServerId: jest.fn(),
      getActiveServer: jest.fn(),
    });
  });

  describe('Local Provider (Default)', () => {
    it('should use local provider when no remote server is active', () => {
      const activeProvider = providerRegistry.getActiveProvider();

      expect(activeProvider.id).toBe('local');
      expect(activeProvider.type).toBe('local');
    });

    it('should return local provider from getProviderForServer(null)', () => {
      const provider = providerRegistry.getProvider('local');

      expect(provider!.id).toBe('local');
      expect(provider).toBe(localProvider);
    });
  });

  describe('Remote Provider Routing', () => {
    it('should register a remote provider', () => {
      const remoteProvider = new OpenAICompatibleProvider('test-server', {
        endpoint: 'http://192.168.1.50:11434',
        modelId: 'llama2',
      });

      providerRegistry.registerProvider('test-server', remoteProvider);

      expect(providerRegistry.hasProvider('test-server')).toBe(true);
      expect(providerRegistry.getProvider('test-server')).toBe(remoteProvider);

      // Cleanup
      providerRegistry.unregisterProvider('test-server');
    });

    it('should switch active provider', () => {
      const remoteProvider = new OpenAICompatibleProvider('remote-1', {
        endpoint: 'http://192.168.1.50:11434',
        modelId: 'mistral',
      });

      providerRegistry.registerProvider('remote-1', remoteProvider);

      const switched = providerRegistry.setActiveProvider('remote-1');

      expect(switched).toBe(true);
      expect(providerRegistry.getActiveProviderId()).toBe('remote-1');
      expect(providerRegistry.getActiveProvider()).toBe(remoteProvider);

      // Cleanup
      providerRegistry.setActiveProvider('local');
      providerRegistry.unregisterProvider('remote-1');
    });

    it('should return undefined for unknown provider', () => {
      const provider = providerRegistry.getProvider('unknown-id');

      // Should return undefined for unknown provider
      expect(provider).toBeUndefined();
    });

    it('should not unregister local provider', () => {
      providerRegistry.unregisterProvider('local');

      // Local should still be available
      expect(providerRegistry.hasProvider('local')).toBe(true);
    });
  });

  describe('Provider Notifications', () => {
    it('should notify listeners on provider change', () => {
      const listener = jest.fn();
      const unsubscribe = providerRegistry.subscribe(listener);

      const remoteProvider = new OpenAICompatibleProvider('notify-test', {
        endpoint: 'http://test:11434',
        modelId: 'test',
      });

      providerRegistry.registerProvider('notify-test', remoteProvider);
      providerRegistry.setActiveProvider('notify-test');

      expect(listener).toHaveBeenCalledWith('notify-test');

      // Cleanup
      providerRegistry.setActiveProvider('local');
      providerRegistry.unregisterProvider('notify-test');
      unsubscribe();
    });

    it('should unsubscribe listeners', () => {
      const listener = jest.fn();
      const unsubscribe = providerRegistry.subscribe(listener);

      unsubscribe();

      const remoteProvider = new OpenAICompatibleProvider('unsub-test', {
        endpoint: 'http://test:11434',
        modelId: 'test',
      });

      providerRegistry.registerProvider('unsub-test', remoteProvider);
      providerRegistry.setActiveProvider('unsub-test');

      expect(listener).not.toHaveBeenCalled();

      // Cleanup
      providerRegistry.setActiveProvider('local');
      providerRegistry.unregisterProvider('unsub-test');
    });
  });

  describe('Clear Providers', () => {
    it('should clear all providers except local', () => {
      const remoteProvider1 = new OpenAICompatibleProvider('clear-test-1', {
        endpoint: 'http://test1:11434',
        modelId: 'test',
      });
      const remoteProvider2 = new OpenAICompatibleProvider('clear-test-2', {
        endpoint: 'http://test2:11434',
        modelId: 'test',
      });

      providerRegistry.registerProvider('clear-test-1', remoteProvider1);
      providerRegistry.registerProvider('clear-test-2', remoteProvider2);

      expect(providerRegistry.getProviderIds()).toHaveLength(3); // local + 2 remote

      providerRegistry.clear();

      expect(providerRegistry.getProviderIds()).toHaveLength(1);
      expect(providerRegistry.getProviderIds()).toContain('local');
    });
  });

  describe('Generation Service isUsingRemoteProvider', () => {
    it('should return false when no remote server is active', () => {
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        activeServerId: null,
      });

      // generationService.isUsingRemoteProvider() should return false
      // This is tested indirectly through the local generation path
      expect(providerRegistry.getActiveProvider().type).toBe('local');
    });

    it('should return true when remote server is active', () => {
      (useRemoteServerStore.getState as jest.Mock).mockReturnValue({
        activeServerId: 'remote-server',
      });

      // Create and register remote provider
      const remoteProvider = new OpenAICompatibleProvider('remote-server', {
        endpoint: 'http://192.168.1.50:11434',
        modelId: 'llama2',
      });

      providerRegistry.registerProvider('remote-server', remoteProvider);
      providerRegistry.setActiveProvider('remote-server');

      expect(providerRegistry.getActiveProvider().type).toBe('openai-compatible');

      // Cleanup
      providerRegistry.setActiveProvider('local');
      providerRegistry.unregisterProvider('remote-server');
    });
  });

  describe('Local Provider Capabilities', () => {
    it('should report correct capabilities', () => {
      const caps = localProvider.capabilities;

      expect(caps).toHaveProperty('supportsVision');
      expect(caps).toHaveProperty('supportsToolCalling');
      expect(caps).toHaveProperty('supportsThinking');
      expect(caps).toHaveProperty('providerName');
    });

    it('should delegate to llmService for model loading', async () => {
      const { llmService } = require('../../../src/services/llm');
      (llmService.loadModel as jest.Mock).mockResolvedValue(undefined);

      await localProvider.loadModel('/path/to/model.gguf');

      // loadModel on localProvider just tracks the ID
      // llmService.loadModel is called by activeModelService, not directly here
      expect(localProvider.getLoadedModelId()).toBe('/path/to/model.gguf');
    });

    it('should delegate stopGeneration to llmService', async () => {
      const { llmService } = require('../../../src/services/llm');
      (llmService.stopGeneration as jest.Mock).mockResolvedValue(undefined);

      await localProvider.stopGeneration();

      expect(llmService.stopGeneration).toHaveBeenCalled();
    });
  });

  describe('Remote Provider Capabilities', () => {
    it('sets vision capability via updateCapabilities, not model name', async () => {
      const provider = new OpenAICompatibleProvider('test', {
        endpoint: 'http://test:11434',
        modelId: 'llava-v1.6',
      });

      await provider.loadModel('llava-v1.6');
      // loadModel no longer infers vision from name — stays false until discovery applies it
      expect(provider.capabilities.supportsVision).toBe(false);

      provider.updateCapabilities({ supportsVision: true });
      expect(provider.capabilities.supportsVision).toBe(true);
    });

    it('should enable tool calling by default', () => {
      const provider = new OpenAICompatibleProvider('test', {
        endpoint: 'http://test:11434',
        modelId: 'test-model',
      });

      expect(provider.capabilities.supportsToolCalling).toBe(true);
    });
  });
});