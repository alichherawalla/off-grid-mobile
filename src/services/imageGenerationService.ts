/**
 * ImageGenerationService - Handles image generation independently of UI lifecycle
 * This allows generation to continue even when the user navigates away from the screen
 * Follows the same pattern as generationService.ts for text LLM generation
 */

import { Platform } from 'react-native';
import { onnxImageGeneratorService } from './onnxImageGenerator';
import { activeModelService } from './activeModelService';
import { useAppStore, useChatStore } from '../stores';
import { GeneratedImage, GenerationMeta } from '../types';

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

    this.cancelRequested = false;
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
          prompt: params.prompt,
          negativePrompt: params.negativePrompt || '',
          steps,
          guidanceScale,
          seed: params.seed,
          width: imageWidth,
          height: imageHeight,
          previewInterval: params.previewInterval ?? 2,
        },
        // onProgress - service-owned callback, never goes stale
        (progress) => {
          if (this.cancelRequested) return;
          this.updateState({
            progress: { step: progress.step, totalSteps: progress.totalSteps },
            status: `Generating image (${progress.step}/${progress.totalSteps})...`,
          });
        },
        // onPreview - service-owned callback
        (preview) => {
          if (this.cancelRequested) return;
          this.updateState({
            previewPath: `file://${preview.previewPath}?t=${Date.now()}`,
            status: `Refining image (${preview.step}/${preview.totalSteps})...`,
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
          const imageMeta: GenerationMeta = {
            gpu: Platform.OS === 'ios',
            gpuBackend: Platform.OS === 'ios' ? 'Metal' : 'CPU',
            modelName: activeImageModel.name,
            steps,
            guidanceScale,
            resolution: `${result.width}x${result.height}`,
          };

          const chatStore = useChatStore.getState();
          chatStore.addMessage(
            params.conversationId,
            {
              role: 'assistant',
              content: `Generated image for: "${params.prompt}"`,
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
