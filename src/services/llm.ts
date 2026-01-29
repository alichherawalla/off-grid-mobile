import { initLlama, LlamaContext } from 'llama.rn';
import { Message, MediaAttachment } from '../types';
import { APP_CONFIG } from '../constants';

type StreamCallback = (token: string) => void;
type CompleteCallback = (fullResponse: string) => void;
type ErrorCallback = (error: Error) => void;

export interface MultimodalSupport {
  vision: boolean;
  audio: boolean;
}

class LLMService {
  private context: LlamaContext | null = null;
  private currentModelPath: string | null = null;
  private isGenerating: boolean = false;
  private multimodalSupport: MultimodalSupport | null = null;
  private multimodalInitialized: boolean = false;

  async loadModel(modelPath: string, mmProjPath?: string): Promise<void> {
    // Unload existing model if different
    if (this.context && this.currentModelPath !== modelPath) {
      await this.unloadModel();
    }

    // Skip if already loaded
    if (this.context && this.currentModelPath === modelPath) {
      return;
    }

    try {
      this.context = await initLlama({
        model: modelPath,
        use_mlock: true,
        n_ctx: APP_CONFIG.maxContextLength,
        n_batch: 512,
        n_threads: 4,
        n_gpu_layers: 0, // CPU only for broader compatibility, can adjust per device
      });

      this.currentModelPath = modelPath;
      this.multimodalSupport = null;
      this.multimodalInitialized = false;

      // Try to initialize multimodal support if mmproj path provided
      if (mmProjPath) {
        await this.initializeMultimodal(mmProjPath);
      }

      // Check for multimodal support
      await this.checkMultimodalSupport();

      console.log('Model loaded successfully:', modelPath);
      console.log('Multimodal support:', this.multimodalSupport);
    } catch (error) {
      console.error('Error loading model:', error);
      this.context = null;
      this.currentModelPath = null;
      this.multimodalSupport = null;
      throw error;
    }
  }

  async initializeMultimodal(mmProjPath: string): Promise<boolean> {
    if (!this.context) return false;

    try {
      // @ts-ignore - llama.rn may have this method for multimodal
      if (typeof this.context.initMultimodal === 'function') {
        await this.context.initMultimodal({
          path: mmProjPath,
          use_gpu: false, // CPU for compatibility
        });
        this.multimodalInitialized = true;
        return true;
      }
    } catch (error) {
      console.error('Error initializing multimodal:', error);
    }
    return false;
  }

  async checkMultimodalSupport(): Promise<MultimodalSupport> {
    if (!this.context) {
      return { vision: false, audio: false };
    }

    try {
      // @ts-ignore - llama.rn may have this method
      if (typeof this.context.getMultimodalSupport === 'function') {
        const support = await this.context.getMultimodalSupport();
        this.multimodalSupport = {
          vision: support?.vision || false,
          audio: support?.audio || false,
        };
        return this.multimodalSupport;
      }
    } catch (error) {
      console.log('Multimodal support check not available');
    }

    this.multimodalSupport = { vision: false, audio: false };
    return this.multimodalSupport;
  }

  getMultimodalSupport(): MultimodalSupport | null {
    return this.multimodalSupport;
  }

  supportsVision(): boolean {
    return this.multimodalSupport?.vision || false;
  }

  async unloadModel(): Promise<void> {
    if (this.context) {
      await this.context.release();
      this.context = null;
      this.currentModelPath = null;
      this.multimodalSupport = null;
      this.multimodalInitialized = false;
    }
  }

  isModelLoaded(): boolean {
    return this.context !== null;
  }

  getLoadedModelPath(): string | null {
    return this.currentModelPath;
  }

  async generateResponse(
    messages: Message[],
    onStream?: StreamCallback,
    onComplete?: CompleteCallback,
    onError?: ErrorCallback
  ): Promise<string> {
    if (!this.context) {
      const error = new Error('No model loaded');
      onError?.(error);
      throw error;
    }

    if (this.isGenerating) {
      const error = new Error('Generation already in progress');
      onError?.(error);
      throw error;
    }

    this.isGenerating = true;

    try {
      // Format messages into prompt
      const prompt = this.formatMessages(messages);

      let fullResponse = '';

      // Use streaming completion
      const result = await this.context.completion(
        {
          prompt,
          n_predict: 512,
          temperature: 0.7,
          top_k: 40,
          top_p: 0.95,
          penalty_repeat: 1.1,
          stop: ['</s>', '<|end|>', '<|eot_id|>', '<|im_end|>'],
        } as any,
        (data) => {
          if (data.token) {
            fullResponse += data.token;
            onStream?.(data.token);
          }
        }
      );

      this.isGenerating = false;
      onComplete?.(fullResponse);
      return fullResponse;
    } catch (error) {
      this.isGenerating = false;
      onError?.(error as Error);
      throw error;
    }
  }

  async stopGeneration(): Promise<void> {
    if (this.context && this.isGenerating) {
      await this.context.stopCompletion();
      this.isGenerating = false;
    }
  }

  isCurrentlyGenerating(): boolean {
    return this.isGenerating;
  }

  private formatMessages(messages: Message[]): string {
    // Format for ChatML-style models (Qwen, etc.)
    let prompt = '';

    for (const message of messages) {
      if (message.role === 'system') {
        prompt += `<|im_start|>system\n${message.content}<|im_end|>\n`;
      } else if (message.role === 'user') {
        // For vision models, add image marker before text if attachments exist
        let content = message.content;
        if (message.attachments && message.attachments.length > 0 && this.supportsVision()) {
          // Add image markers for multimodal models
          const imageMarkers = message.attachments
            .filter(a => a.type === 'image')
            .map(() => '<__media__>')
            .join('');
          content = imageMarkers + content;
        }
        prompt += `<|im_start|>user\n${content}<|im_end|>\n`;
      } else if (message.role === 'assistant') {
        prompt += `<|im_start|>assistant\n${message.content}<|im_end|>\n`;
      }
    }

    // Add assistant prefix to prompt response
    prompt += '<|im_start|>assistant\n';

    return prompt;
  }

  // Get image URIs from messages for multimodal processing
  private getImageUris(messages: Message[]): string[] {
    const uris: string[] = [];
    for (const message of messages) {
      if (message.attachments) {
        for (const attachment of message.attachments) {
          if (attachment.type === 'image') {
            uris.push(attachment.uri);
          }
        }
      }
    }
    return uris;
  }

  // Get model info from loaded context
  async getModelInfo(): Promise<{
    contextLength: number;
    vocabSize: number;
  } | null> {
    if (!this.context) {
      return null;
    }

    // llama.rn provides limited info access
    return {
      contextLength: APP_CONFIG.maxContextLength,
      vocabSize: 0, // Not directly accessible
    };
  }

  // Tokenize text (useful for context length estimation)
  async tokenize(text: string): Promise<number[]> {
    if (!this.context) {
      throw new Error('No model loaded');
    }

    const result = await this.context.tokenize(text);
    return result.tokens || [];
  }

  // Get token count for text
  async getTokenCount(text: string): Promise<number> {
    if (!this.context) {
      throw new Error('No model loaded');
    }
    const result = await this.context.tokenize(text);
    return result.tokens?.length || 0;
  }

  // Estimate if messages fit in context
  async estimateContextUsage(messages: Message[]): Promise<{
    tokenCount: number;
    percentUsed: number;
    willFit: boolean;
  }> {
    const prompt = this.formatMessages(messages);
    const tokenCount = await this.getTokenCount(prompt);
    const percentUsed = (tokenCount / APP_CONFIG.maxContextLength) * 100;

    return {
      tokenCount,
      percentUsed,
      willFit: tokenCount < APP_CONFIG.maxContextLength * 0.9, // Leave 10% buffer
    };
  }
}

export const llmService = new LLMService();
