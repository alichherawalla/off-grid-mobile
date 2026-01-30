import { initLlama, LlamaContext } from 'llama.rn';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { Message, MediaAttachment } from '../types';
import { APP_CONFIG } from '../constants';
import { useAppStore } from '../stores';

type StreamCallback = (token: string) => void;
type CompleteCallback = (fullResponse: string) => void;
type ErrorCallback = (error: Error) => void;
type ThinkingCallback = () => void;

export interface MultimodalSupport {
  vision: boolean;
  audio: boolean;
}

// Reserve tokens for system prompt and response generation
const SYSTEM_PROMPT_RESERVE = 256;
const RESPONSE_RESERVE = 512;
const CONTEXT_SAFETY_MARGIN = 0.85; // Use only 85% of context to be safe

// Default performance settings
const DEFAULT_THREADS = Platform.OS === 'android' ? 6 : 4;
const DEFAULT_BATCH = 256;

// Helper functions to get optimal settings based on platform
function getOptimalThreadCount(): number {
  // Android devices generally benefit from more threads
  // iOS with Metal can use fewer CPU threads since GPU handles most work
  return DEFAULT_THREADS;
}

function getOptimalBatchSize(): number {
  // Smaller batch = faster first token, larger batch = faster overall throughput
  // 256 is a good balance for mobile
  return DEFAULT_BATCH;
}

export interface LLMPerformanceSettings {
  nThreads: number;
  nBatch: number;
  contextLength: number;
}

export interface LLMPerformanceStats {
  lastTokensPerSecond: number;
  lastGenerationTime: number;
  lastTokenCount: number;
}

class LLMService {
  private context: LlamaContext | null = null;
  private currentModelPath: string | null = null;
  private isGenerating: boolean = false;
  private multimodalSupport: MultimodalSupport | null = null;
  private multimodalInitialized: boolean = false;
  private performanceStats: LLMPerformanceStats = {
    lastTokensPerSecond: 0,
    lastGenerationTime: 0,
    lastTokenCount: 0,
  };
  private currentSettings: LLMPerformanceSettings = {
    nThreads: DEFAULT_THREADS,
    nBatch: DEFAULT_BATCH,
    contextLength: 2048,
  };
  // Session caching for faster repeated prompts
  private lastSystemPromptHash: string | null = null;
  private sessionCacheDir: string = `${RNFS.CachesDirectoryPath}/llm-sessions`;

  private hashString(str: string): string {
    // Simple hash for cache key
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  private async ensureSessionCacheDir(): Promise<void> {
    try {
      const exists = await RNFS.exists(this.sessionCacheDir);
      if (!exists) {
        await RNFS.mkdir(this.sessionCacheDir);
      }
    } catch (e) {
      console.log('[LLM] Failed to create session cache dir:', e);
    }
  }

  private getSessionPath(promptHash: string): string {
    return `${this.sessionCacheDir}/session-${promptHash}.bin`;
  }

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
      // Get settings from appStore, fallback to defaults
      const { settings } = useAppStore.getState();
      const nThreads = settings.nThreads || getOptimalThreadCount();
      const nBatch = settings.nBatch || getOptimalBatchSize();
      const contextLength = settings.contextLength || APP_CONFIG.maxContextLength;

      // Update internal settings tracker
      this.currentSettings = { nThreads, nBatch, contextLength };

      console.log(`[LLM] Loading with threads=${nThreads}, batch=${nBatch}, ctx=${contextLength}`);

      // Determine GPU layers based on platform
      // iOS: Use Metal with all layers on GPU
      // Android: Can try GPU if device supports it
      const nGpuLayers = Platform.OS === 'ios' ? 99 : 0;

      this.context = await initLlama({
        model: modelPath,
        use_mlock: false, // Disable mlock for better compatibility on Android
        n_ctx: contextLength,
        n_batch: nBatch,
        n_threads: nThreads,
        n_gpu_layers: nGpuLayers,
        use_mmap: true, // Memory-mapped files for faster loading
        vocab_only: false,
        // Performance optimizations
        flash_attn: Platform.OS === 'ios', // Flash attention on iOS (Metal)
        cache_type_k: 'f16', // Use f16 for KV cache (faster, less memory)
        cache_type_v: 'f16',
      } as any);

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
    onError?: ErrorCallback,
    onThinking?: ThinkingCallback
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

    // Signal that we're starting to think (process prompt)
    onThinking?.();

    try {
      // Apply context window management to prevent overflow
      const managedMessages = await this.manageContextWindow(messages);

      // Format messages into prompt
      const prompt = this.formatMessages(managedMessages);

      let fullResponse = '';
      let firstTokenReceived = false;

      // Track performance
      const startTime = Date.now();
      let firstTokenTime = 0;
      let tokenCount = 0;

      // Get generation settings from appStore
      const { settings } = useAppStore.getState();
      const maxTokens = settings.maxTokens || RESPONSE_RESERVE;
      const temperature = settings.temperature ?? 0.7;
      const topP = settings.topP ?? 0.95;
      const repeatPenalty = settings.repeatPenalty ?? 1.1;

      console.log(`[LLM] Generating with temp=${temperature}, topP=${topP}, maxTokens=${maxTokens}, repeatPenalty=${repeatPenalty}`);

      // Use streaming completion with optimized parameters
      const result = await this.context.completion(
        {
          prompt,
          n_predict: maxTokens,
          temperature,
          top_k: 40,
          top_p: topP,
          penalty_repeat: repeatPenalty,
          stop: ['</s>', '<|end|>', '<|eot_id|>', '<|im_end|>', '<|im_start|>'],
        } as any,
        (data) => {
          if (data.token) {
            // Track time to first token
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              firstTokenTime = Date.now() - startTime;
              console.log(`[LLM] First token received after ${firstTokenTime}ms`);
            }
            tokenCount++;
            fullResponse += data.token;
            onStream?.(data.token);
          }
        }
      );

      // Log and store performance stats
      const elapsed = (Date.now() - startTime) / 1000;
      const tokensPerSec = elapsed > 0 ? tokenCount / elapsed : 0;
      console.log(`[LLM] Generated ${tokenCount} tokens in ${elapsed.toFixed(1)}s (${tokensPerSec.toFixed(1)} tok/s)`);

      this.performanceStats = {
        lastTokensPerSecond: tokensPerSec,
        lastGenerationTime: elapsed,
        lastTokenCount: tokenCount,
      };

      this.isGenerating = false;
      onComplete?.(fullResponse);
      return fullResponse;
    } catch (error) {
      this.isGenerating = false;
      onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Manage context window by truncating old messages while preserving:
   * 1. System prompt (always kept)
   * 2. Most recent messages (prioritized)
   * 3. A summarized context indicator when truncation occurs
   */
  private async manageContextWindow(messages: Message[]): Promise<Message[]> {
    if (!this.context || messages.length === 0) {
      return messages;
    }

    const contextLength = this.currentSettings.contextLength || APP_CONFIG.maxContextLength;
    const maxContextTokens = Math.floor(contextLength * CONTEXT_SAFETY_MARGIN);
    const availableTokens = maxContextTokens - SYSTEM_PROMPT_RESERVE - RESPONSE_RESERVE;

    // Separate system message from conversation
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    if (conversationMessages.length === 0) {
      return messages;
    }

    // Estimate tokens for system prompt
    let systemTokens = 0;
    if (systemMessage) {
      try {
        systemTokens = (await this.context.tokenize(systemMessage.content)).tokens?.length || 0;
      } catch {
        // Rough estimate: ~4 chars per token
        systemTokens = Math.ceil(systemMessage.content.length / 4);
      }
    }

    // Calculate available space for conversation
    let remainingTokens = availableTokens - systemTokens;

    // Process messages from most recent to oldest
    const includedMessages: Message[] = [];
    for (let i = conversationMessages.length - 1; i >= 0 && remainingTokens > 0; i--) {
      const msg = conversationMessages[i];
      let msgTokens: number;

      try {
        msgTokens = (await this.context.tokenize(msg.content)).tokens?.length || 0;
        // Add overhead for ChatML tags
        msgTokens += 10;
      } catch {
        // Rough estimate
        msgTokens = Math.ceil(msg.content.length / 4) + 10;
      }

      if (msgTokens <= remainingTokens) {
        includedMessages.unshift(msg);
        remainingTokens -= msgTokens;
      } else if (includedMessages.length === 0) {
        // Always include at least the last message, even if truncated
        includedMessages.unshift(msg);
        break;
      } else {
        break;
      }
    }

    // Build final message array
    const result: Message[] = [];

    if (systemMessage) {
      result.push(systemMessage);
    }

    // If we truncated messages, add a context note
    const truncatedCount = conversationMessages.length - includedMessages.length;
    if (truncatedCount > 0) {
      result.push({
        id: 'context-note',
        role: 'system',
        content: `[Note: ${truncatedCount} earlier message(s) in this conversation have been summarized to fit context. Continue naturally from the recent messages below.]`,
        timestamp: 0,
      });
    }

    result.push(...includedMessages);

    return result;
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
    let systemPromptContent = '';

    // First pass: collect system prompt content and build conversation
    for (const message of messages) {
      if (message.role === 'system') {
        // Collect system messages (there might be multiple: main + context note)
        if (message.id === 'system') {
          // This is the main persona/system prompt
          systemPromptContent = message.content;
          prompt += `<|im_start|>system\n${message.content}<|im_end|>\n`;
        } else {
          // Context notes or other system messages
          prompt += `<|im_start|>system\n${message.content}<|im_end|>\n`;
        }
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
    const contextLength = this.currentSettings.contextLength || APP_CONFIG.maxContextLength;
    const percentUsed = (tokenCount / contextLength) * 100;

    return {
      tokenCount,
      percentUsed,
      willFit: tokenCount < contextLength * 0.9, // Leave 10% buffer
    };
  }

  // Debug: Get the formatted prompt that would be sent
  getFormattedPrompt(messages: Message[]): string {
    return this.formatMessages(messages);
  }

  // Debug: Get context management info
  async getContextDebugInfo(messages: Message[]): Promise<{
    originalMessageCount: number;
    managedMessageCount: number;
    truncatedCount: number;
    formattedPrompt: string;
    estimatedTokens: number;
    maxContextLength: number;
    contextUsagePercent: number;
  }> {
    const managedMessages = await this.manageContextWindow(messages);
    const formattedPrompt = this.formatMessages(managedMessages);

    let estimatedTokens = 0;
    try {
      if (this.context) {
        estimatedTokens = (await this.context.tokenize(formattedPrompt)).tokens?.length || 0;
      }
    } catch {
      estimatedTokens = Math.ceil(formattedPrompt.length / 4);
    }

    const systemMessages = messages.filter(m => m.role === 'system').length;
    const managedSystemMessages = managedMessages.filter(m => m.role === 'system').length;
    const originalConvMessages = messages.length - systemMessages;
    const managedConvMessages = managedMessages.length - managedSystemMessages;

    const contextLength = this.currentSettings.contextLength || APP_CONFIG.maxContextLength;
    return {
      originalMessageCount: messages.length,
      managedMessageCount: managedMessages.length,
      truncatedCount: originalConvMessages - managedConvMessages,
      formattedPrompt,
      estimatedTokens,
      maxContextLength: contextLength,
      contextUsagePercent: (estimatedTokens / contextLength) * 100,
    };
  }

  // Performance settings management
  updatePerformanceSettings(settings: Partial<LLMPerformanceSettings>): void {
    this.currentSettings = { ...this.currentSettings, ...settings };
    console.log('[LLM] Performance settings updated:', this.currentSettings);
  }

  getPerformanceSettings(): LLMPerformanceSettings {
    return { ...this.currentSettings };
  }

  getPerformanceStats(): LLMPerformanceStats {
    return { ...this.performanceStats };
  }

  // Reload the model with current performance settings
  async reloadWithSettings(modelPath: string, settings: LLMPerformanceSettings): Promise<void> {
    this.updatePerformanceSettings(settings);

    // Force unload first
    if (this.context) {
      await this.unloadModel();
    }

    try {
      console.log(`[LLM] Reloading with threads=${settings.nThreads}, batch=${settings.nBatch}, ctx=${settings.contextLength}`);

      this.context = await initLlama({
        model: modelPath,
        use_mlock: false,
        n_ctx: settings.contextLength,
        n_batch: settings.nBatch,
        n_threads: settings.nThreads,
        n_gpu_layers: Platform.OS === 'ios' ? 99 : 0,
        use_mmap: true,
        vocab_only: false,
      });

      this.currentModelPath = modelPath;
      this.multimodalSupport = null;
      this.multimodalInitialized = false;

      await this.checkMultimodalSupport();

      console.log('[LLM] Model reloaded with new settings');
    } catch (error) {
      console.error('[LLM] Error reloading model:', error);
      this.context = null;
      this.currentModelPath = null;
      throw error;
    }
  }
}

export const llmService = new LLMService();
