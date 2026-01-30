import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import {
  ImageGenerationParams,
  ImageGenerationProgress,
  GeneratedImage,
} from '../types';

const { ONNXImageGeneratorModule } = NativeModules;

type ProgressCallback = (progress: ImageGenerationProgress) => void;
type PreviewCallback = (preview: { previewPath: string; step: number; totalSteps: number }) => void;
type CompleteCallback = (image: GeneratedImage) => void;
type ErrorCallback = (error: Error) => void;

/**
 * ONNX Runtime based image generator service.
 * Replaces MediaPipe implementation for better Adreno GPU compatibility.
 */
class ONNXImageGeneratorService {
  private eventEmitter: NativeEventEmitter | null = null;
  private progressListener: any = null;
  private previewListener: any = null;
  private completeListener: any = null;
  private errorListener: any = null;

  constructor() {
    if (Platform.OS === 'android' && ONNXImageGeneratorModule) {
      this.eventEmitter = new NativeEventEmitter(ONNXImageGeneratorModule);
    }
  }

  isAvailable(): boolean {
    return Platform.OS === 'android' && ONNXImageGeneratorModule != null;
  }

  async isModelLoaded(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      return await ONNXImageGeneratorModule.isModelLoaded();
    } catch {
      return false;
    }
  }

  async getLoadedModelPath(): Promise<string | null> {
    if (!this.isAvailable()) return null;
    try {
      return await ONNXImageGeneratorModule.getLoadedModelPath();
    } catch {
      return null;
    }
  }

  async loadModel(modelPath: string): Promise<boolean> {
    if (!this.isAvailable()) {
      throw new Error('ONNX image generation is not available on this platform');
    }
    return await ONNXImageGeneratorModule.loadModel(modelPath);
  }

  async unloadModel(): Promise<boolean> {
    if (!this.isAvailable()) return true;
    return await ONNXImageGeneratorModule.unloadModel();
  }

  async generateImage(
    params: ImageGenerationParams & { previewInterval?: number },
    onProgress?: ProgressCallback,
    onPreview?: PreviewCallback,
    onComplete?: CompleteCallback,
    onError?: ErrorCallback
  ): Promise<GeneratedImage> {
    if (!this.isAvailable()) {
      throw new Error('ONNX image generation is not available on this platform');
    }

    // Set up event listeners
    this.removeListeners();

    if (this.eventEmitter) {
      if (onProgress) {
        this.progressListener = this.eventEmitter.addListener(
          'ONNXImageProgress',
          (data: ImageGenerationProgress) => {
            onProgress(data);
          }
        );
      }

      if (onPreview) {
        this.previewListener = this.eventEmitter.addListener(
          'ONNXImagePreview',
          (data: { previewPath: string; step: number; totalSteps: number }) => {
            onPreview(data);
          }
        );
      }

      if (onComplete) {
        this.completeListener = this.eventEmitter.addListener(
          'ONNXImageComplete',
          (data: GeneratedImage) => {
            onComplete(data);
          }
        );
      }

      if (onError) {
        this.errorListener = this.eventEmitter.addListener(
          'ONNXImageError',
          (data: { error: string }) => {
            onError(new Error(data.error));
          }
        );
      }
    }

    try {
      const result = await ONNXImageGeneratorModule.generateImage({
        prompt: params.prompt,
        negativePrompt: params.negativePrompt || '',
        steps: params.steps || 20,
        guidanceScale: params.guidanceScale || 7.5,
        seed: params.seed,
        width: params.width || 512,
        height: params.height || 512,
        previewInterval: params.previewInterval ?? 2,
      });

      return {
        id: result.id,
        prompt: result.prompt,
        negativePrompt: result.negativePrompt,
        imagePath: result.imagePath,
        width: result.width,
        height: result.height,
        steps: result.steps,
        seed: result.seed,
        modelId: '', // Will be set by caller
        createdAt: result.createdAt,
      };
    } finally {
      this.removeListeners();
    }
  }

  async cancelGeneration(): Promise<boolean> {
    if (!this.isAvailable()) return true;
    this.removeListeners();
    return await ONNXImageGeneratorModule.cancelGeneration();
  }

  async isGenerating(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    return await ONNXImageGeneratorModule.isGenerating();
  }

  async getGeneratedImages(): Promise<GeneratedImage[]> {
    if (!this.isAvailable()) return [];
    try {
      const images = await ONNXImageGeneratorModule.getGeneratedImages();
      return images.map((img: any) => ({
        id: img.id,
        prompt: img.prompt || '',
        imagePath: img.imagePath,
        width: img.width || 512,
        height: img.height || 512,
        steps: img.steps || 20,
        seed: img.seed || 0,
        modelId: img.modelId || '',
        createdAt: img.createdAt,
      }));
    } catch {
      return [];
    }
  }

  async deleteGeneratedImage(imageId: string): Promise<boolean> {
    if (!this.isAvailable()) return false;
    return await ONNXImageGeneratorModule.deleteGeneratedImage(imageId);
  }

  getConstants() {
    if (!this.isAvailable()) {
      return {
        DEFAULT_STEPS: 20,
        DEFAULT_GUIDANCE_SCALE: 7.5,
        DEFAULT_WIDTH: 512,
        DEFAULT_HEIGHT: 512,
        SUPPORTED_WIDTHS: [512],
        SUPPORTED_HEIGHTS: [512],
      };
    }
    return ONNXImageGeneratorModule.getConstants();
  }

  private removeListeners() {
    if (this.progressListener) {
      this.progressListener.remove();
      this.progressListener = null;
    }
    if (this.previewListener) {
      this.previewListener.remove();
      this.previewListener = null;
    }
    if (this.completeListener) {
      this.completeListener.remove();
      this.completeListener = null;
    }
    if (this.errorListener) {
      this.errorListener.remove();
      this.errorListener = null;
    }
  }
}

export const onnxImageGeneratorService = new ONNXImageGeneratorService();
