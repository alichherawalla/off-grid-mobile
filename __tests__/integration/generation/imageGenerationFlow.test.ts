/**
 * Integration Tests: Image Generation Flow
 *
 * Tests the integration between:
 * - imageGenerationService ↔ localDreamGeneratorService
 * - imageGenerationService ↔ useAppStore (generated images)
 */

import { useAppStore } from '../../../src/stores/appStore';
import { imageGenerationService } from '../../../src/services/imageGenerationService';
import { localDreamGeneratorService } from '../../../src/services/localDreamGenerator';
import { activeModelService } from '../../../src/services/activeModelService';
import { llmService } from '../../../src/services/llm';
import {
  resetStores,
  flushPromises,
  getAppState,
  getChatState,
  setupWithConversation,
} from '../../utils/testHelpers';
import { createONNXImageModel, createGeneratedImage, createMessage } from '../../utils/factories';
import { Message } from '../../../src/types';

// Mock the services
jest.mock('../../../src/services/localDreamGenerator');
jest.mock('../../../src/services/activeModelService');
jest.mock('../../../src/services/llm');

const mockLocalDreamService = localDreamGeneratorService as jest.Mocked<typeof localDreamGeneratorService>;
const mockActiveModelService = activeModelService as jest.Mocked<typeof activeModelService>;
const mockLlmService = llmService as jest.Mocked<typeof llmService>;

describe('Image Generation Flow Integration', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();

    // Default mock implementations
    mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
    mockLocalDreamService.getLoadedModelPath.mockResolvedValue('/mock/image-model');
    mockLocalDreamService.getLoadedThreads.mockReturnValue(4);
    mockLocalDreamService.isAvailable.mockReturnValue(true);
    mockLocalDreamService.generateImage.mockResolvedValue({
      id: 'generated-img-1',
      prompt: 'Test prompt',
      imagePath: '/mock/generated/image.png',
      width: 512,
      height: 512,
      steps: 20,
      seed: 12345,
      modelId: 'img-model-1',
      createdAt: new Date().toISOString(),
    });
    mockLocalDreamService.cancelGeneration.mockResolvedValue(true);

    mockActiveModelService.getActiveModels.mockReturnValue({
      text: { model: null, isLoaded: false, isLoading: false },
      image: { model: null, isLoaded: true, isLoading: false },
    });
    mockActiveModelService.loadImageModel.mockResolvedValue();

    // Default LLM service mocks (for prompt enhancement)
    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLlmService.isCurrentlyGenerating.mockReturnValue(false);
    mockLlmService.stopGeneration.mockResolvedValue();

    // Reset imageGenerationService state by canceling any in-progress generation
    await imageGenerationService.cancelGeneration().catch(() => {});
  });

  const setupImageModelState = () => {
    const imageModel = createONNXImageModel({
      id: 'img-model-1',
      modelPath: '/mock/image-model',
    });
    useAppStore.setState({
      downloadedImageModels: [imageModel],
      activeImageModelId: 'img-model-1',
      generatedImages: [],
      settings: {
        imageSteps: 20,
        imageGuidanceScale: 7.5,
        imageWidth: 512,
        imageHeight: 512,
        imageThreads: 4,
      } as any,
    });
    mockLocalDreamService.getLoadedModelPath.mockResolvedValue(imageModel.modelPath);
    return imageModel;
  };

  describe('Image Generation Lifecycle', () => {
    it('should update state during generation lifecycle', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      // Use a deferred promise to control when generation completes
      let resolveGeneration: (value: any) => void;
      mockLocalDreamService.generateImage.mockImplementation(async () => {
        return new Promise((resolve) => {
          resolveGeneration = resolve;
        });
      });

      // Start generation (don't await - we want to check state while generating)
      const generatePromise = imageGenerationService.generateImage({
        prompt: 'A beautiful sunset',
      });

      // Wait for the async setup to complete
      await flushPromises();

      // Should be generating
      expect(imageGenerationService.getState().isGenerating).toBe(true);
      expect(imageGenerationService.getState().prompt).toBe('A beautiful sunset');

      // Complete generation
      resolveGeneration!({
        id: 'test-img',
        prompt: 'A beautiful sunset',
        imagePath: '/mock/image.png',
        width: 512,
        height: 512,
        steps: 20,
        seed: 12345,
        modelId: 'img-model-1',
        createdAt: new Date().toISOString(),
      });

      await generatePromise;

      // Should no longer be generating
      expect(imageGenerationService.getState().isGenerating).toBe(false);
    });

    it('should call localDreamGeneratorService with correct parameters', async () => {
      const imageModel = setupImageModelState();

      // Update settings
      useAppStore.setState({
        settings: {
          imageSteps: 30,
          imageGuidanceScale: 8.5,
          imageWidth: 768,
          imageHeight: 768,
          imageThreads: 4,
        } as any,
      });

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      await imageGenerationService.generateImage({
        prompt: 'A mountain landscape',
        negativePrompt: 'blurry, ugly',
      });

      expect(mockLocalDreamService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'A mountain landscape',
          negativePrompt: 'blurry, ugly',
          steps: 30,
          guidanceScale: 8.5,
          width: 768,
          height: 768,
        }),
        expect.any(Function), // onProgress
        expect.any(Function) // onPreview
      );
    });

    it('should save generated image to gallery', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      const result = await imageGenerationService.generateImage({
        prompt: 'Test prompt',
      });

      expect(result).not.toBeNull();
      expect(result?.imagePath).toBe('/mock/generated/image.png');

      const state = getAppState();
      expect(state.generatedImages).toHaveLength(1);
      expect(state.generatedImages[0].prompt).toBe('Test prompt');
    });

    it('should add message to chat when conversationId is provided', async () => {
      const imageModel = setupImageModelState();
      const conversationId = setupWithConversation();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      await imageGenerationService.generateImage({
        prompt: 'Chat image prompt',
        conversationId,
      });

      const chatState = getChatState();
      const conversation = chatState.conversations.find(c => c.id === conversationId);
      expect(conversation?.messages).toHaveLength(1);
      expect(conversation?.messages[0].role).toBe('assistant');
      expect(conversation?.messages[0].content).toContain('Chat image prompt');
      expect(conversation?.messages[0].attachments).toHaveLength(1);
      expect(conversation?.messages[0].attachments?.[0].type).toBe('image');
    });
  });

  describe('Progress Updates', () => {
    it('should receive and propagate progress updates', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      let _progressCallback: ((progress: any) => void) | undefined;
      mockLocalDreamService.generateImage.mockImplementation(
        async (params, onProgress, _onPreview) => {
          _progressCallback = onProgress;
          // Simulate progress
          onProgress?.({ step: 5, totalSteps: 20, progress: 0.25 });
          onProgress?.({ step: 10, totalSteps: 20, progress: 0.5 });
          onProgress?.({ step: 20, totalSteps: 20, progress: 1.0 });
          return {
            id: 'test-img',
            prompt: params.prompt,
            imagePath: '/mock/image.png',
            width: 512,
            height: 512,
            steps: 20,
            seed: 12345,
            modelId: 'test',
            createdAt: new Date().toISOString(),
          };
        }
      );

      const progressUpdates: { step: number; totalSteps: number }[] = [];
      const unsubscribe = imageGenerationService.subscribe((state) => {
        if (state.progress) {
          progressUpdates.push({ ...state.progress });
        }
      });

      await imageGenerationService.generateImage({ prompt: 'Test' });

      unsubscribe();

      // Should have received progress updates
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates.some(p => p.step > 0)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle generation errors gracefully', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      mockLocalDreamService.generateImage.mockRejectedValue(
        new Error('Generation failed: out of memory')
      );

      const result = await imageGenerationService.generateImage({
        prompt: 'Test prompt',
      });

      // Should return null on error
      expect(result).toBeNull();

      // State should show error
      expect(imageGenerationService.getState().isGenerating).toBe(false);
      expect(imageGenerationService.getState().error).toContain('out of memory');
    });

    it('should return null when no model is selected', async () => {
      useAppStore.setState({
        downloadedImageModels: [],
        activeImageModelId: null,
        settings: { imageSteps: 20, imageGuidanceScale: 7.5 } as any,
      });

      const result = await imageGenerationService.generateImage({
        prompt: 'Test prompt',
      });

      expect(result).toBeNull();
      expect(imageGenerationService.getState().error).toContain('No image model');
    });

    it('should handle model load failure', async () => {
      setupImageModelState();

      // Model not loaded yet
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
      mockActiveModelService.loadImageModel.mockRejectedValue(
        new Error('Failed to load model')
      );

      const result = await imageGenerationService.generateImage({
        prompt: 'Test prompt',
      });

      expect(result).toBeNull();
      expect(imageGenerationService.getState().error).toContain('Failed to load');
    });
  });

  describe('Cancel Generation', () => {
    it('should cancel generation when requested', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      // Long running generation
      let _resolveGeneration: (value: any) => void;
      mockLocalDreamService.generateImage.mockImplementation(async () => {
        return new Promise((resolve) => {
          _resolveGeneration = resolve;
        });
      });

      imageGenerationService.generateImage({
        prompt: 'Long prompt',
      });

      await flushPromises();

      // Should be generating
      expect(imageGenerationService.getState().isGenerating).toBe(true);

      // Cancel generation
      await imageGenerationService.cancelGeneration();

      // Should have called native cancel
      expect(mockLocalDreamService.cancelGeneration).toHaveBeenCalled();

      // Should no longer be generating
      expect(imageGenerationService.getState().isGenerating).toBe(false);
    });
  });

  describe('Concurrent Generation Prevention', () => {
    it('should ignore second generation request while generating', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      let resolveFirst: (value: any) => void;
      let callCount = 0;

      mockLocalDreamService.generateImage.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return createGeneratedImage();
      });

      // Start first generation
      const gen1 = imageGenerationService.generateImage({ prompt: 'First' });

      await flushPromises();
      expect(imageGenerationService.getState().isGenerating).toBe(true);

      // Try second generation - should return null immediately
      const gen2 = await imageGenerationService.generateImage({ prompt: 'Second' });

      expect(gen2).toBeNull();
      expect(callCount).toBe(1);

      // Complete first
      resolveFirst!(createGeneratedImage());
      await gen1;
    });
  });

  describe('State Subscription', () => {
    it('should notify subscribers of state changes', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      const generatingStates: boolean[] = [];
      const unsubscribe = imageGenerationService.subscribe((state) => {
        generatingStates.push(state.isGenerating);
      });

      await imageGenerationService.generateImage({ prompt: 'Test' });

      unsubscribe();

      // Should have transitions: initial false -> true (generating) -> false (complete)
      expect(generatingStates).toContain(true);
      expect(generatingStates[generatingStates.length - 1]).toBe(false);
    });

    it('should receive current state immediately on subscribe', () => {
      const states: boolean[] = [];
      const unsubscribe = imageGenerationService.subscribe((state) => {
        states.push(state.isGenerating);
      });

      // Should have received initial state
      expect(states).toHaveLength(1);
      expect(states[0]).toBe(false);

      unsubscribe();
    });
  });

  describe('Model Auto-Loading', () => {
    it('should auto-load model if not loaded', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: false, isLoading: false },
      });

      // Model not loaded
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await imageGenerationService.generateImage({ prompt: 'Test' });

      // Should have tried to load model
      expect(mockActiveModelService.loadImageModel).toHaveBeenCalledWith('img-model-1');
    });

    it('should reload model if threads changed', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      // Model loaded but with different threads
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.getLoadedThreads.mockReturnValue(2); // Different from settings (4)

      await imageGenerationService.generateImage({ prompt: 'Test' });

      // Should have reloaded model
      expect(mockActiveModelService.loadImageModel).toHaveBeenCalled();
    });
  });

  describe('Generation Metadata', () => {
    it('should include generation metadata in chat message', async () => {
      const imageModel = createONNXImageModel({
        id: 'img-model-1',
        name: 'Test Image Model',
        modelPath: '/mock/image-model',
        backend: 'qnn',
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: 'img-model-1',
        generatedImages: [],
        settings: {
          imageSteps: 25,
          imageGuidanceScale: 8.0,
          imageWidth: 512,
          imageHeight: 512,
          imageThreads: 4,
        } as any,
      });
      mockLocalDreamService.getLoadedModelPath.mockResolvedValue(imageModel.modelPath);

      const conversationId = setupWithConversation();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      await imageGenerationService.generateImage({
        prompt: 'Metadata test',
        conversationId,
      });

      const chatState = getChatState();
      const conversation = chatState.conversations.find(c => c.id === conversationId);
      const message = conversation?.messages[0];

      expect(message?.generationMeta).toBeDefined();
      expect(message?.generationMeta?.modelName).toBe('Test Image Model');
      expect(message?.generationMeta?.steps).toBe(25);
      expect(message?.generationMeta?.guidanceScale).toBe(8.0);
      expect(message?.generationMeta?.resolution).toBe('512x512');
    });
  });

  describe('Prompt Enhancement with Conversation Context', () => {
    const setupEnhancement = () => {
      const imageModel = setupImageModelState();
      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      // Enable enhancement and set up LLM as available
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          enhanceImagePrompts: true,
        },
      });
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.isCurrentlyGenerating.mockReturnValue(false);
      mockLlmService.generateResponse.mockResolvedValue('A beautifully enhanced prompt');

      return imageModel;
    };

    it('should pass conversation history to enhancement when conversationId provided', async () => {
      setupEnhancement();

      // Set up a conversation with prior messages
      const messages: Message[] = [
        createMessage({ role: 'user', content: 'Draw me a cat' }),
        createMessage({ role: 'assistant', content: 'Here is a cat image' }),
        createMessage({ role: 'user', content: 'Make it darker' }),
      ];
      const conversationId = setupWithConversation({ messages });

      await imageGenerationService.generateImage({
        prompt: 'Make it darker',
        conversationId,
      });

      // Verify generateResponse was called with conversation context
      expect(mockLlmService.generateResponse).toHaveBeenCalled();
      const callArgs = mockLlmService.generateResponse.mock.calls[0];
      const enhancementMessages = callArgs[0] as Message[];

      // Should have: system + context messages + user enhance prompt
      // system (1) + conversation messages (3) + user enhance (1) = 5
      expect(enhancementMessages.length).toBe(5);
      expect(enhancementMessages[0].role).toBe('system');
      expect(enhancementMessages[0].content).toContain('conversation history');
      expect(enhancementMessages[1].content).toBe('Draw me a cat');
      expect(enhancementMessages[2].content).toBe('Here is a cat image');
      expect(enhancementMessages[3].content).toBe('Make it darker');
      expect(enhancementMessages[4].role).toBe('user');
      expect(enhancementMessages[4].content).toBe('Make it darker');
    });

    it('should not include conversation context when no conversationId', async () => {
      setupEnhancement();

      await imageGenerationService.generateImage({
        prompt: 'A sunset',
      });

      expect(mockLlmService.generateResponse).toHaveBeenCalled();
      const callArgs = mockLlmService.generateResponse.mock.calls[0];
      const enhancementMessages = callArgs[0] as Message[];

      // Should have: system + user enhance prompt only (no context)
      expect(enhancementMessages.length).toBe(2);
      expect(enhancementMessages[0].role).toBe('system');
      expect(enhancementMessages[0].content).not.toContain('conversation history');
      expect(enhancementMessages[1].role).toBe('user');
      expect(enhancementMessages[1].content).toBe('A sunset');
    });

    it('should truncate long messages in conversation context', async () => {
      setupEnhancement();

      const longContent = 'x'.repeat(1000);
      const messages: Message[] = [
        createMessage({ role: 'user', content: longContent }),
      ];
      const conversationId = setupWithConversation({ messages });

      await imageGenerationService.generateImage({
        prompt: 'Enhance this',
        conversationId,
      });

      const callArgs = mockLlmService.generateResponse.mock.calls[0];
      const enhancementMessages = callArgs[0] as Message[];

      // The context message should be truncated to 500 chars
      const contextMsg = enhancementMessages.find(m => m.id.startsWith('ctx-'));
      expect(contextMsg).toBeDefined();
      expect(contextMsg!.content.length).toBe(500);
    });

    it('should limit conversation context to last 10 messages', async () => {
      setupEnhancement();

      // Create 15 messages
      const messages: Message[] = [];
      for (let i = 0; i < 15; i++) {
        messages.push(createMessage({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i + 1}`,
        }));
      }
      const conversationId = setupWithConversation({ messages });

      await imageGenerationService.generateImage({
        prompt: 'Generate image',
        conversationId,
      });

      const callArgs = mockLlmService.generateResponse.mock.calls[0];
      const enhancementMessages = callArgs[0] as Message[];

      // system (1) + last 10 context messages + user enhance (1) = 12
      expect(enhancementMessages.length).toBe(12);
      // First context message should be message 6 (index 5), not message 1
      const firstContextMsg = enhancementMessages[1];
      expect(firstContextMsg.content).toBe('Message 6');
    });

    it('should skip system messages from conversation context', async () => {
      setupEnhancement();

      const messages: Message[] = [
        createMessage({ role: 'user', content: 'Hello' }),
        createMessage({ role: 'system', content: 'Model loaded successfully' }),
        createMessage({ role: 'assistant', content: 'Hi there' }),
      ];
      const conversationId = setupWithConversation({ messages });

      await imageGenerationService.generateImage({
        prompt: 'Draw something',
        conversationId,
      });

      const callArgs = mockLlmService.generateResponse.mock.calls[0];
      const enhancementMessages = callArgs[0] as Message[];

      // system (1) + 2 context (user + assistant, system skipped) + user enhance (1) = 4
      expect(enhancementMessages.length).toBe(4);
      const contextMessages = enhancementMessages.filter(m => m.id.startsWith('ctx-'));
      expect(contextMessages).toHaveLength(2);
      expect(contextMessages.every(m => m.role !== 'system')).toBe(true);
    });

    it('should use original prompt when enhancement is disabled', async () => {
      setupImageModelState();
      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: setupImageModelState(), isLoaded: true, isLoading: false },
      });

      // Enhancement disabled (default)
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          enhanceImagePrompts: false,
        },
      });

      const messages: Message[] = [
        createMessage({ role: 'user', content: 'Draw a cat' }),
      ];
      const conversationId = setupWithConversation({ messages });

      await imageGenerationService.generateImage({
        prompt: 'Make it blue',
        conversationId,
      });

      // LLM should not be called for enhancement
      expect(mockLlmService.generateResponse).not.toHaveBeenCalled();
    });

    it('should handle empty conversation gracefully', async () => {
      setupEnhancement();

      const conversationId = setupWithConversation({ messages: [] });

      await imageGenerationService.generateImage({
        prompt: 'A landscape',
        conversationId,
      });

      const callArgs = mockLlmService.generateResponse.mock.calls[0];
      const enhancementMessages = callArgs[0] as Message[];

      // system + user enhance only (no context from empty conversation)
      expect(enhancementMessages.length).toBe(2);
      expect(enhancementMessages[0].role).toBe('system');
      expect(enhancementMessages[0].content).not.toContain('conversation history');
    });
  });
});
