import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import {
  ImageGenerationParams,
  ImageGenerationProgress,
  GeneratedImage,
} from '../types';

const { ImageGeneratorModule } = NativeModules;

type ProgressCallback = (progress: ImageGenerationProgress) => void;
type CompleteCallback = (image: GeneratedImage) => void;
type ErrorCallback = (error: Error) => void;

class ImageGeneratorService {
  private eventEmitter: NativeEventEmitter | null = null;
  private progressListener: any = null;
  private completeListener: any = null;
  private errorListener: any = null;

  constructor() {
    if (Platform.OS === 'android' && ImageGeneratorModule) {
      this.eventEmitter = new NativeEventEmitter(ImageGeneratorModule);
    }
  }

  isAvailable(): boolean {
    return Platform.OS === 'android' && ImageGeneratorModule != null;
  }

  async isModelLoaded(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      return await ImageGeneratorModule.isModelLoaded();
    } catch {
      return false;
    }
  }

  async getLoadedModelPath(): Promise<string | null> {
    if (!this.isAvailable()) return null;
    try {
      return await ImageGeneratorModule.getLoadedModelPath();
    } catch {
      return null;
    }
  }

  async loadModel(modelPath: string): Promise<boolean> {
    if (!this.isAvailable()) {
      throw new Error('Image generation is not available on this platform');
    }
    return await ImageGeneratorModule.loadModel(modelPath);
  }

  async unloadModel(): Promise<boolean> {
    if (!this.isAvailable()) return true;
    return await ImageGeneratorModule.unloadModel();
  }

  async generateImage(
    params: ImageGenerationParams,
    onProgress?: ProgressCallback,
    onComplete?: CompleteCallback,
    onError?: ErrorCallback
  ): Promise<GeneratedImage> {
    if (!this.isAvailable()) {
      throw new Error('Image generation is not available on this platform');
    }

    // Set up event listeners
    this.removeListeners();

    if (this.eventEmitter) {
      if (onProgress) {
        this.progressListener = this.eventEmitter.addListener(
          'ImageGenerationProgress',
          (data: ImageGenerationProgress) => {
            onProgress(data);
          }
        );
      }

      if (onComplete) {
        this.completeListener = this.eventEmitter.addListener(
          'ImageGenerationComplete',
          (data: GeneratedImage) => {
            onComplete(data);
          }
        );
      }

      if (onError) {
        this.errorListener = this.eventEmitter.addListener(
          'ImageGenerationError',
          (data: { error: string }) => {
            onError(new Error(data.error));
          }
        );
      }
    }

    try {
      const result = await ImageGeneratorModule.generateImage({
        prompt: params.prompt,
        negativePrompt: params.negativePrompt || '',
        steps: params.steps || 20,
        guidanceScale: params.guidanceScale || 7.5,
        seed: params.seed,
        width: params.width || 512,
        height: params.height || 512,
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
    return await ImageGeneratorModule.cancelGeneration();
  }

  async isGenerating(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    return await ImageGeneratorModule.isGenerating();
  }

  async getGeneratedImages(): Promise<GeneratedImage[]> {
    if (!this.isAvailable()) return [];
    try {
      const images = await ImageGeneratorModule.getGeneratedImages();
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
    return await ImageGeneratorModule.deleteGeneratedImage(imageId);
  }

  getConstants() {
    if (!this.isAvailable()) {
      return {
        DEFAULT_STEPS: 20,
        DEFAULT_GUIDANCE_SCALE: 7.5,
        DEFAULT_WIDTH: 512,
        DEFAULT_HEIGHT: 512,
        SUPPORTED_WIDTHS: [512, 768],
        SUPPORTED_HEIGHTS: [512, 768],
      };
    }
    return ImageGeneratorModule.getConstants();
  }

  private removeListeners() {
    if (this.progressListener) {
      this.progressListener.remove();
      this.progressListener = null;
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

export const imageGeneratorService = new ImageGeneratorService();
