/**
 * ImageGenerationService - Handles image generation independently of UI lifecycle
 * This allows generation to continue even when the user navigates away from the screen
 * Follows the same pattern as generationService.ts for text LLM generation
 */

import { Platform } from 'react-native';
import { localDreamGeneratorService as onnxImageGeneratorService } from './localDreamGenerator';
import { activeModelService } from './activeModelService';
import { llmService } from './llm';
import { useAppStore, useChatStore } from '../stores';
import { GeneratedImage, GenerationMeta, Message } from '../types';

export interface ImageGenerationState {
  isGenerating: boolean;
  progress: { step: number; totalSteps: number } | null;
  status: string | null;
  previewPath: string | null;
  prompt: string | null;
  conversationId: string | null;
  error: string | null;
  result: GeneratedImage | null;
}

type ImageGenerationListener = (state: ImageGenerationState) => void;

class ImageGenerationService {
  private state: ImageGenerationState = {
    isGenerating: false,
    progress: null,
    status: null,
    previewPath: null,
    prompt: null,
    conversationId: null,
    error: null,
    result: null,
  };

  private listeners: Set<ImageGenerationListener> = new Set();
  private cancelRequested: boolean = false;

  /**
   * Get current generation state
   */
  getState(): ImageGenerationState {
    return { ...this.state };
  }

  /**
   * Check if generation is in progress for a specific conversation
   */
  isGeneratingFor(conversationId: string): boolean {
    return this.state.isGenerating && this.state.conversationId === conversationId;
  }

  /**
   * Subscribe to generation state changes.
   * Immediately calls listener with current state.
   */
  subscribe(listener: ImageGenerationListener): () => void {
    this.listeners.add(listener);
    // Immediately call with current state so reconnecting screens get progress
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach(listener => listener(state));
  }

  private updateState(partial: Partial<ImageGenerationState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();

    // Sync appStore flags for global UI indicators (tab bar badges, etc.)
    const appStore = useAppStore.getState();
    if ('isGenerating' in partial) {
      appStore.setIsGeneratingImage(this.state.isGenerating);
    }
    if ('progress' in partial) {
      appStore.setImageGenerationProgress(this.state.progress);
    }
    if ('status' in partial) {
      appStore.setImageGenerationStatus(this.state.status);
    }
    if ('previewPath' in partial) {
      appStore.setImagePreviewPath(this.state.previewPath);
    }
  }

  /**
   * Generate an image. Runs independently of UI lifecycle.
   * If conversationId is provided, the result will be added as a chat message.
   */
  async generateImage(params: {
    prompt: string;
    conversationId?: string;
    negativePrompt?: string;
    steps?: number;
    guidanceScale?: number;
    seed?: number;
    previewInterval?: number;
  }): Promise<GeneratedImage | null> {
    // Guard against concurrent generation
    if (this.state.isGenerating) {
      console.log('[ImageGenerationService] Already generating, ignoring request');
      return null;
    }

    const { settings, activeImageModelId, downloadedImageModels } = useAppStore.getState();
    const activeImageModel = downloadedImageModels.find(m => m.id === activeImageModelId);

    if (!activeImageModel) {
      this.updateState({ error: 'No image model selected' });
      return null;
    }

    const steps = params.steps || settings.imageSteps || 8;
    const guidanceScale = params.guidanceScale || settings.imageGuidanceScale || 2.0;
    const imageWidth = settings.imageWidth || 256;
    const imageHeight = settings.imageHeight || 256;

    // Enhance prompt using text LLM if enabled
    let enhancedPrompt = params.prompt;
    let tempMessageId: string | null = null;
    console.log('[ImageGen] enhanceImagePrompts setting:', settings.enhanceImagePrompts);

    if (settings.enhanceImagePrompts) {
      const isTextModelLoaded = llmService.isModelLoaded();
      const isLlmGenerating = llmService.isCurrentlyGenerating();
      console.log('[ImageGen] 🎨 Starting prompt enhancement - Model loaded:', isTextModelLoaded, 'LLM generating:', isLlmGenerating);

      if (!isTextModelLoaded) {
        console.warn('[ImageGen] No text model loaded, skipping enhancement');

        // Delete the thinking message
        if (params.conversationId && tempMessageId) {
          const chatStore = useChatStore.getState();
          chatStore.deleteMessage(params.conversationId, tempMessageId);
          tempMessageId = null;
        }

        enhancedPrompt = params.prompt;
      } else {
        this.updateState({
          isGenerating: true,
          prompt: params.prompt,
          conversationId: params.conversationId || null,
          status: 'Enhancing prompt with AI...',
          previewPath: null,
          progress: { step: 0, totalSteps: steps },
          error: null,
          result: null,
        });

        // Add message to show enhancement in progress with thinking animation
        if (params.conversationId) {
          const chatStore = useChatStore.getState();
          const tempMessage = chatStore.addMessage(
            params.conversationId,
            {
              role: 'assistant',
              content: 'Enhancing your prompt...',
              isThinking: true,
            }
          );
          tempMessageId = tempMessage.id;
        }

        try {
        const enhancementMessages: Message[] = [
          {
            id: 'system-enhance',
            role: 'system',
            content: `You are an expert at creating detailed image generation prompts. Take the user's request and enhance it into a detailed, descriptive prompt that will produce better results from an image generation model. Include artistic style, lighting, composition, and quality modifiers. Keep it under 75 words. Only respond with the enhanced prompt, no explanation.`,
            timestamp: Date.now(),
          },
          {
            id: 'user-enhance',
            role: 'user',
            content: params.prompt,
            timestamp: Date.now(),
          },
        ];

        let fullResponse = '';
        console.log('[ImageGen] 📤 Calling llmService.generateResponse for enhancement...');
        enhancedPrompt = await llmService.generateResponse(
          enhancementMessages,
          (token) => {
            fullResponse += token;
          },
          (complete) => {
            fullResponse = complete;
          },
          (error) => {
            console.error('[ImageGen] ❌ Enhancement error callback:', error);
          }
        );
        console.log('[ImageGen] 📥 llmService.generateResponse returned, checking state...');
        console.log('[ImageGen] LLM state after enhancement - generating:', llmService.isCurrentlyGenerating());

          // Clean up the response - remove quotes, extra whitespace
          enhancedPrompt = enhancedPrompt.trim().replace(/^["']|["']$/g, '');

          console.log('[ImageGen] ✅ Original prompt:', params.prompt);
          console.log('[ImageGen] ✅ Enhanced prompt:', enhancedPrompt);

          // CRITICAL: Reset LLM service after enhancement
          // This ensures it's ready for normal text generation later
          console.log('[ImageGen] 🔄 Starting cleanup - generating:', llmService.isCurrentlyGenerating());
          try {
            // Always call stop to ensure clean state
            await llmService.stopGeneration();
            console.log('[ImageGen] ✓ stopGeneration() called');
            // NOTE: We DON'T clear KV cache here because:
            // 1. It's already cleared during generation completion
            // 2. Clearing it slows down subsequent vision inference significantly
            console.log('[ImageGen] ✅ LLM service reset complete - generating:', llmService.isCurrentlyGenerating());
          } catch (resetError) {
            console.error('[ImageGen] ❌ Failed to reset LLM service:', resetError);
          }

          // Update thinking message with enhanced prompt as a collapsible block
          if (params.conversationId && tempMessageId) {
            const chatStore = useChatStore.getState();

            // If enhancement worked, show it as a collapsible block
            if (enhancedPrompt && enhancedPrompt !== params.prompt) {
              chatStore.updateMessage(
                params.conversationId,
                tempMessageId,
                `<think>__LABEL:Enhanced prompt__\n${enhancedPrompt}</think>`,
                false  // Clear the isThinking flag so it renders as a collapsible block
              );
            } else {
              console.warn('[ImageGen] Enhancement produced no change, deleting thinking message');
              chatStore.deleteMessage(params.conversationId, tempMessageId);
              tempMessageId = null;
            }
          }
        } catch (error: any) {
          console.error('[ImageGen] ❌ Prompt enhancement failed:', error);
          console.error('[ImageGen] Error details:', error?.message || 'Unknown error');

          // CRITICAL: Reset LLM service after error
          console.log('[ImageGen] 🔄 Starting cleanup after error - generating:', llmService.isCurrentlyGenerating());
          try {
            await llmService.stopGeneration();
            console.log('[ImageGen] ✓ stopGeneration() called after error');
            console.log('[ImageGen] ✅ LLM service reset after error - generating:', llmService.isCurrentlyGenerating());
          } catch (resetError) {
            console.error('[ImageGen] ❌ Failed to reset LLM service after error:', resetError);
          }

          // Update or remove the thinking message on error
          if (params.conversationId && tempMessageId) {
            const chatStore = useChatStore.getState();
            chatStore.deleteMessage(params.conversationId, tempMessageId);
            tempMessageId = null;
          }

          // Fall back to original prompt if enhancement fails
          enhancedPrompt = params.prompt;
        }
      }
    } else {
      console.log('[ImageGen] Enhancement disabled, using original prompt');
    }

    this.cancelRequested = false;

    // Only set initial state if we didn't already set it during prompt enhancement
    if (!settings.enhanceImagePrompts) {
      this.updateState({
        isGenerating: true,
        prompt: params.prompt,
        conversationId: params.conversationId || null,
        status: 'Preparing image generation...',
        previewPath: null,
        progress: { step: 0, totalSteps: steps },
        error: null,
        result: null,
      });
    } else {
      // Update status for next phase
      this.updateState({ status: 'Preparing image generation...' });
    }

    // Ensure image model is loaded
    const isImageModelLoaded = await onnxImageGeneratorService.isModelLoaded();
    const loadedPath = await onnxImageGeneratorService.getLoadedModelPath();
    const desiredThreads = settings.imageThreads ?? 4;
    const loadedThreads = onnxImageGeneratorService.getLoadedThreads();
    const needsThreadReload = loadedThreads == null || loadedThreads !== desiredThreads;

    if (!isImageModelLoaded || loadedPath !== activeImageModel.modelPath || needsThreadReload) {
      if (!activeImageModelId) {
        this.updateState({ error: 'No image model selected', isGenerating: false });
        return null;
      }
      try {
        this.updateState({ status: `Loading ${activeImageModel.name}...` });
        await activeModelService.loadImageModel(activeImageModelId);
      } catch (error: any) {
        this.updateState({
          isGenerating: false,
          progress: null,
          status: null,
          error: `Failed to load image model: ${error?.message || 'Unknown error'}`,
        });
        return null;
      }
    }

    if (this.cancelRequested) {
      this.resetState();
      return null;
    }

    this.updateState({ status: 'Starting image generation...' });
    const startTime = Date.now();

    try {
      const result = await onnxImageGeneratorService.generateImage(
        {
          prompt: enhancedPrompt,
          negativePrompt: params.negativePrompt || '',
          steps,
          guidanceScale,
          seed: params.seed,
          width: imageWidth,
          height: imageHeight,
          previewInterval: params.previewInterval ?? 2,
        },
        // onProgress - service-owned callback, never goes stale
        // The server reports total_steps = requested_steps + 2 (CLIP + VAE overhead),
        // so we use the requested `steps` value for display consistency.
        (progress) => {
          if (this.cancelRequested) return;
          const displayStep = Math.min(progress.step, steps);
          this.updateState({
            progress: { step: displayStep, totalSteps: steps },
            status: `Generating image (${displayStep}/${steps})...`,
          });
        },
        // onPreview - service-owned callback
        (preview) => {
          if (this.cancelRequested) return;
          const displayStep = Math.min(preview.step, steps);
          this.updateState({
            previewPath: `file://${preview.previewPath}?t=${Date.now()}`,
            status: `Refining image (${displayStep}/${steps})...`,
          });
        },
      );

      if (this.cancelRequested) {
        this.resetState();
        return null;
      }

      const genTime = Date.now() - startTime;

      if (result && result.imagePath) {
        // Set modelId and conversationId on the result
        result.modelId = activeImageModel.id;
        if (params.conversationId) {
          result.conversationId = params.conversationId;
        }

        // Add to gallery store
        useAppStore.getState().addGeneratedImage(result);

        // If triggered from a conversation, add assistant message with the image
        if (params.conversationId) {
          const backend = activeImageModel.backend ?? 'mnn';
          const gpuBackend = Platform.OS === 'ios'
            ? 'Core ML (ANE)'
            : backend === 'qnn'
              ? 'QNN (NPU)'
              : 'MNN (CPU)';

          const imageMeta: GenerationMeta = {
            gpu: Platform.OS === 'ios' ? true : backend === 'qnn',
            gpuBackend,
            modelName: activeImageModel.name,
            steps,
            guidanceScale,
            resolution: `${result.width}x${result.height}`,
          };

          const chatStore = useChatStore.getState();

          // Keep the enhanced prompt message (don't delete it)
          // It's already shown as a collapsible block in the chat

          // Add image message with only the original prompt
          const messageContent = `Generated image for: "${params.prompt}"`;

          chatStore.addMessage(
            params.conversationId,
            {
              role: 'assistant',
              content: messageContent,
            },
            [{
              id: result.id,
              type: 'image',
              uri: `file://${result.imagePath}`,
              width: result.width,
              height: result.height,
            }],
            genTime,
            imageMeta
          );
        }

        this.updateState({
          isGenerating: false,
          progress: null,
          status: null,
          previewPath: null,
          result,
          error: null,
        });

        return result;
      }

      this.resetState();
      return null;
    } catch (error: any) {
      if (!error?.message?.includes('cancelled')) {
        console.error('[ImageGenerationService] Generation error:', error);
        this.updateState({
          isGenerating: false,
          progress: null,
          status: null,
          previewPath: null,
          error: error?.message || 'Image generation failed',
        });
      } else {
        this.resetState();
      }
      return null;
    }
  }

  /**
   * Cancel the current generation
   */
  async cancelGeneration(): Promise<void> {
    if (!this.state.isGenerating) return;
    this.cancelRequested = true;
    try {
      await onnxImageGeneratorService.cancelGeneration();
    } catch (e) {
      // Ignore cancellation errors
    }
    this.resetState();
  }

  private resetState(): void {
    this.updateState({
      isGenerating: false,
      progress: null,
      status: null,
      previewPath: null,
      prompt: null,
      conversationId: null,
      error: null,
      // Keep result so the last generated image is still accessible
    });
  }
}

export const imageGenerationService = new ImageGenerationService();
