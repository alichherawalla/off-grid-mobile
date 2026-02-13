import { initLlama, LlamaContext, RNLlamaOAICompatibleMessage, RNLlamaMessagePart } from 'llama.rn';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { Message } from '../types';
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
// GPU layers: iOS Metal handles full offload well; Android OpenCL is unstable and causes native crashes
const DEFAULT_GPU_LAYERS = Platform.OS === 'ios' ? 99 : 0;

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
  lastDecodeTokensPerSecond: number;
  lastTimeToFirstToken: number;
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
    lastDecodeTokensPerSecond: 0,
    lastTimeToFirstToken: 0,
    lastGenerationTime: 0,
    lastTokenCount: 0,
  };
  private currentSettings: LLMPerformanceSettings = {
    nThreads: DEFAULT_THREADS,
    nBatch: DEFAULT_BATCH,
    contextLength: 2048,
  };
  // Runtime GPU info from initLlama
  private gpuEnabled: boolean = false;
  private gpuReason: string = '';
  private gpuDevices: string[] = [];
  private activeGpuLayers: number = 0;
  // Session caching for faster repeated prompts
  private lastSystemPromptHash: string | null = null;
  private sessionCacheDir: string = `${RNFS.CachesDirectoryPath}/llm-sessions`;

  private hashString(str: string): string {
    // Simple hash for cache key
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      // eslint-disable-next-line no-bitwise
      hash = ((hash << 5) - hash) + char;
      // eslint-disable-next-line no-bitwise
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

    // Verify files exist
    const modelExists = await RNFS.exists(modelPath);
    if (!modelExists) {
      throw new Error(`Model file not found at: ${modelPath}`);
    }

    if (mmProjPath) {
      const mmProjExists = await RNFS.exists(mmProjPath);
      if (!mmProjExists) {
        console.warn('[LLM] MMProj file not found, disabling vision support');
        mmProjPath = undefined;
      }
    }

    try {
      // Get settings from appStore, fallback to defaults
      const { settings } = useAppStore.getState();
      const nThreads = settings.nThreads || getOptimalThreadCount();
      const nBatch = settings.nBatch || getOptimalBatchSize();
      const requestedContextLength = settings.contextLength || APP_CONFIG.maxContextLength;

      // First do a lightweight load with minimal context to read model metadata
      // Then reload with the appropriate context size
      let contextLength = requestedContextLength;

      // Update internal settings tracker
      this.currentSettings = { nThreads, nBatch, contextLength };

      const baseParams = {
        model: modelPath,
        use_mlock: false,
        n_batch: nBatch,
        n_threads: nThreads,
        use_mmap: true,
        vocab_only: false,
        flash_attn: true,
        cache_type_k: 'q8_0',
        cache_type_v: 'q8_0',
      };

      console.log(`[LLM] Loading model: ctx=${contextLength}, threads=${nThreads}, batch=${nBatch}`);

      // Load model with GPU if enabled, fall back to CPU if it fails
      const gpuEnabled = settings.enableGpu !== false; // default true
      const nGpuLayers = gpuEnabled ? (settings.gpuLayers ?? DEFAULT_GPU_LAYERS) : 0;
      console.log(`[LLM] GPU setting: ${gpuEnabled ? 'enabled' : 'disabled'}, n_gpu_layers=${nGpuLayers}`);

      let gpuAttemptFailed = false;
      try {
        this.context = await initLlama({
          ...baseParams,
          n_ctx: contextLength,
          n_gpu_layers: nGpuLayers,
        } as any);
      } catch (gpuError: any) {
        if (gpuEnabled) {
          console.warn('[LLM] GPU load failed, falling back to CPU:', gpuError?.message || gpuError);
          gpuAttemptFailed = true;
        }
        try {
          this.context = await initLlama({
            ...baseParams,
            n_ctx: contextLength,
            n_gpu_layers: 0,
          } as any);
        } catch (cpuError: any) {
          // Context might be too large -- retry with safe default
          console.warn(`[LLM] CPU load also failed (ctx=${contextLength}), retrying with ctx=2048:`, cpuError?.message || cpuError);
          contextLength = 2048;
          this.currentSettings.contextLength = contextLength;
          this.context = await initLlama({
            ...baseParams,
            n_ctx: contextLength,
            n_gpu_layers: 0,
          } as any);
        }
      }

      // Read the model's trained context length from metadata and log it
      try {
        const metadata = (this.context as any).model?.metadata;
        if (metadata) {
          const trainCtx = metadata['llama.context_length']
            || metadata['general.context_length']
            || metadata.context_length;
          if (trainCtx) {
            const maxModelCtx = parseInt(trainCtx, 10);
            console.log(`[LLM] Model trained context: ${maxModelCtx}, using: ${contextLength}`);
            if (contextLength > maxModelCtx) {
              console.warn(`[LLM] Requested context (${contextLength}) exceeds model max (${maxModelCtx})`);
            }
          }
        }
      } catch {
        // Metadata reading is best-effort
      }

      // Capture runtime GPU status from the context
      const nativeGpuAvailable = this.context.gpu ?? false;
      this.gpuReason = (this.context as any).reasonNoGPU ?? '';
      this.gpuDevices = (this.context as any).devices ?? [];
      // GPU is only truly enabled if layers were requested AND native reports available
      this.activeGpuLayers = gpuAttemptFailed ? 0 : nGpuLayers;
      this.gpuEnabled = nativeGpuAvailable && this.activeGpuLayers > 0;

      // Log which native lib was loaded and GPU status
      const androidLib = (this.context as any).androidLib || 'unknown';
      const systemInfo = (this.context as any).systemInfo || '';
      console.log(`[LLM] Native lib: ${androidLib}`);
      console.log(`[LLM] System info: ${systemInfo}`);

      if (this.gpuEnabled) {
        console.log(`[LLM] GPU active: ${this.gpuDevices.join(', ') || 'yes'}, layers=${this.activeGpuLayers}`);
      } else {
        console.log(`[LLM] Running on CPU only${nativeGpuAvailable ? ' (GPU available but not used)' : ''}${this.gpuReason ? ': ' + this.gpuReason : ''}`);
      }

      this.currentModelPath = modelPath;
      this.multimodalSupport = null;
      this.multimodalInitialized = false;

      // Try to initialize multimodal support if mmproj path provided
      console.log('[LLM] mmProjPath:', mmProjPath || 'none');
      if (mmProjPath) {
        // Check mmproj file exists and log size
        try {
          const stat = await RNFS.stat(mmProjPath);
          const sizeMB = (Number(stat.size) / (1024 * 1024)).toFixed(2);
          console.log(`[LLM] mmproj file size: ${sizeMB} MB`);
          // Qwen3-VL F16 mmproj should be ~819MB, Q8_0 should be ~445MB
          if (Number(stat.size) < 100 * 1024 * 1024) {
            console.warn(`[LLM] WARNING: mmproj file seems too small (${sizeMB} MB) - may be incomplete download!`);
          }
        } catch (statErr) {
          console.error('[LLM] Failed to stat mmproj file:', statErr);
        }
        console.log('[LLM] Initializing multimodal with mmproj...');
        await this.initializeMultimodal(mmProjPath);
      } else {
        // No separate mmproj file - check if model has built-in multimodal support
        // (e.g., Qwen-VL merged models have vision built into the main GGUF)
        this.multimodalInitialized = false;
        await this.checkMultimodalSupport();
      }

      const support = this.multimodalSupport as MultimodalSupport | null;
      console.log('[LLM] Model loaded, vision:', support?.vision ?? false);
    } catch (error: any) {
      console.error('[LLM] Error loading model:', error?.message || error);
      this.context = null;
      this.currentModelPath = null;
      this.multimodalSupport = null;
      this.gpuEnabled = false;
      this.gpuReason = '';
      this.activeGpuLayers = 0;
      this.gpuDevices = [];
      throw new Error(error?.message || 'Unknown error loading model');
    }
  }

  async initializeMultimodal(mmProjPath: string): Promise<boolean> {
    if (!this.context) {
      console.warn('[LLM] initializeMultimodal: No context available');
      return false;
    }

    try {
      // Disable GPU for CLIP on iOS Simulator — the simulated Metal driver
      // can't handle the large buffer allocations and crashes with XPC API misuse.
      const deviceInfo = useAppStore.getState().deviceInfo;
      const useGpuForClip = Platform.OS === 'ios' && !deviceInfo?.isEmulator;
      console.log('[LLM] Calling context.initMultimodal with path:', mmProjPath, 'use_gpu:', useGpuForClip);
      const success = await this.context.initMultimodal({
        path: mmProjPath,
        use_gpu: useGpuForClip,
      });
      console.log('[LLM] context.initMultimodal returned:', success);

      if (success) {
        this.multimodalInitialized = true;
        this.multimodalSupport = { vision: true, audio: false };

        try {
          const support = await this.context.getMultimodalSupport();
          this.multimodalSupport = {
            vision: support?.vision || true,
            audio: support?.audio || false,
          };
        } catch {
          // getMultimodalSupport not available, keep defaults
        }
        console.log('[LLM] Multimodal initialized successfully, vision:', this.multimodalSupport?.vision);
        return true;
      } else {
        console.warn('[LLM] context.initMultimodal returned false - mmproj may be incompatible with model');
        this.multimodalInitialized = false;
        this.multimodalSupport = { vision: false, audio: false };
        return false;
      }
    } catch (error: any) {
      console.error('[LLM] Multimodal init exception:', error?.message || error);
      this.multimodalInitialized = false;
      this.multimodalSupport = { vision: false, audio: false };
      return false;
    }
  }

  async checkMultimodalSupport(): Promise<MultimodalSupport> {
    if (!this.context) {
      this.multimodalSupport = { vision: false, audio: false };
      return this.multimodalSupport;
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
    } catch {
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
      this.gpuEnabled = false;
      this.gpuReason = '';
      this.gpuDevices = [];
      this.activeGpuLayers = 0;
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

      // Check if we have images and multimodal is enabled
      const hasImages = managedMessages.some(m => m.attachments?.some(a => a.type === 'image'));
      const useMultimodal = hasImages && this.multimodalInitialized;

      console.log('[LLM] 🖼️ Generation mode:', useMultimodal ? 'VISION (multimodal)' : 'TEXT-ONLY');
      console.log('[LLM] Has images:', hasImages, 'Multimodal initialized:', this.multimodalInitialized);

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

      // Warn if trying to send images without multimodal
      if (hasImages && !useMultimodal) {
        console.warn('[LLM] Images attached but multimodal not initialized - images will be ignored');
      }

      // Prepare completion params
      let completionParams: any;

      if (useMultimodal) {
        // Convert to OpenAI-compatible message format with images
        console.log('[LLM] Converting messages for vision mode...');
        const oaiMessages = this.convertToOAIMessages(managedMessages);
        console.log('[LLM] Vision messages prepared, image count:',
          oaiMessages.filter(m => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url')).length);
        completionParams = {
          messages: oaiMessages,
          n_predict: maxTokens,
          temperature,
          top_k: 40,
          top_p: topP,
          penalty_repeat: repeatPenalty,
          stop: ['</s>', '<|end|>', '<|eot_id|>', '<|im_end|>', '<|im_start|>'],
        };
      } else {
        // Use text-only prompt format
        const prompt = this.formatMessages(managedMessages);
        completionParams = {
          prompt,
          n_predict: maxTokens,
          temperature,
          top_k: 40,
          top_p: topP,
          penalty_repeat: repeatPenalty,
          stop: ['</s>', '<|end|>', '<|eot_id|>', '<|im_end|>', '<|im_start|>'],
        };
      }

      // Use streaming completion
      console.log('[LLM] 🚀 Calling context.completion... (mode:', useMultimodal ? 'vision' : 'text', ')');
      console.log('[LLM] Waiting for first token...');

      await this.context.completion(
        completionParams,
        (data) => {
          // Check if generation was stopped - ignore any pending tokens
          if (!this.isGenerating) {
            return;
          }
          if (data.token) {
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              firstTokenTime = Date.now() - startTime;
              console.log('[LLM] ✅ First token received after', firstTokenTime, 'ms');
            }
            tokenCount++;
            fullResponse += data.token;
            onStream?.(data.token);
          }
        }
      );

      console.log('[LLM] 🏁 context.completion returned');

      // Log and store performance stats
      const elapsed = (Date.now() - startTime) / 1000;
      const tokensPerSec = elapsed > 0 ? tokenCount / elapsed : 0;
      const ttft = firstTokenTime / 1000; // convert ms to seconds
      const decodeTime = elapsed - ttft;
      const decodeTokensPerSec = decodeTime > 0 && tokenCount > 1 ? (tokenCount - 1) / decodeTime : 0;
      console.log(`[LLM] Generated ${tokenCount} tokens in ${elapsed.toFixed(1)}s (${tokensPerSec.toFixed(1)} tok/s overall, ${decodeTokensPerSec.toFixed(1)} tok/s decode, TTFT ${ttft.toFixed(2)}s)`);

      this.performanceStats = {
        lastTokensPerSecond: tokensPerSec,
        lastDecodeTokensPerSecond: decodeTokensPerSec,
        lastTimeToFirstToken: ttft,
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
    // Always try to stop if we have a context, regardless of isGenerating flag
    // This handles race conditions where generation might have just finished
    if (this.context) {
      try {
        await this.context.stopCompletion();
      } catch (e) {
        // Ignore errors if already stopped or no active completion
        console.log('[LLM] Stop completion error (may be already stopped):', e);
      }
    }
    this.isGenerating = false;
  }

  /**
   * Clear the KV cache to free memory and reset conversation state.
   * This helps prevent performance degradation after many messages.
   * Call this between conversations or when memory pressure is high.
   * @param clearData If true, clears both metadata and tensor data (slower but more thorough)
   */
  async clearKVCache(clearData: boolean = false): Promise<void> {
    if (!this.context) {
      return;
    }

    try {
      await (this.context as any).clearCache(clearData);
      console.log('[LLM] KV cache cleared');
    } catch (e) {
      console.log('[LLM] Failed to clear KV cache:', e);
    }
  }

  /**
   * Get estimated memory usage of the loaded model based on context size
   */
  getEstimatedMemoryUsage(): { contextMemoryMB: number; totalEstimatedMB: number } {
    if (!this.context) {
      return { contextMemoryMB: 0, totalEstimatedMB: 0 };
    }

    // Estimate KV cache memory: 2 * n_ctx * n_embd * n_layer * sizeof(float16)
    // For a typical 7B model: n_embd=4096, n_layer=32
    // Using f16 cache: 2 bytes per value, 2 KV matrices
    const contextLength = this.currentSettings.contextLength || 2048;
    // Rough estimate: 2 * ctx * 4096 * 32 * 2 / (1024*1024) = ctx * 0.5 MB
    const contextMemoryMB = contextLength * 0.5;

    return {
      contextMemoryMB,
      totalEstimatedMB: contextMemoryMB, // Model memory is separate and tracked via file size
    };
  }

  getGpuInfo(): { gpu: boolean; gpuBackend: string; gpuLayers: number; reasonNoGPU: string } {
    let backend = 'CPU';
    if (this.gpuEnabled) {
      if (Platform.OS === 'ios') {
        backend = 'Metal';
      } else if (this.gpuDevices.length > 0) {
        backend = this.gpuDevices.join(', ');
      } else {
        backend = 'OpenCL';
      }
    }
    return {
      gpu: this.gpuEnabled,
      gpuBackend: backend,
      gpuLayers: this.activeGpuLayers,
      reasonNoGPU: this.gpuReason,
    };
  }

  isCurrentlyGenerating(): boolean {
    return this.isGenerating;
  }

  private formatMessages(messages: Message[]): string {
    // Format for ChatML-style models (Qwen, etc.)
    let prompt = '';
    // First pass: collect system prompt content and build conversation
    for (const message of messages) {
      if (message.role === 'system') {
        // Collect system messages (there might be multiple: main + context note)
        if (message.id === 'system') {
          // This is the main project system prompt
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

  // Convert our Message[] to OpenAI-compatible format for multimodal
  private convertToOAIMessages(messages: Message[]): RNLlamaOAICompatibleMessage[] {
    return messages.map(message => {
      // Check if message has image attachments
      const imageAttachments = message.attachments?.filter(a => a.type === 'image') || [];

      if (imageAttachments.length > 0 && message.role === 'user') {
        // Build content array with images and text
        const contentParts: RNLlamaMessagePart[] = [];

        // Add images first
        for (const attachment of imageAttachments) {
          // Convert URI to file path format expected by llama.rn
          let imagePath = attachment.uri;
          // Ensure it starts with file:// for llama.rn
          if (!imagePath.startsWith('file://') && !imagePath.startsWith('http')) {
            imagePath = `file://${imagePath}`;
          }

          contentParts.push({
            type: 'image_url',
            image_url: {
              url: imagePath,
            },
          });
        }

        // Add text content
        if (message.content) {
          contentParts.push({
            type: 'text',
            text: message.content,
          });
        }

        return {
          role: message.role,
          content: contentParts,
        };
      }

      // Regular text-only message
      return {
        role: message.role,
        content: message.content,
      };
    });
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

      const { settings: appSettings } = useAppStore.getState();
      const gpuEnabled = appSettings.enableGpu !== false;
      const nGpuLayers = gpuEnabled ? (appSettings.gpuLayers ?? DEFAULT_GPU_LAYERS) : 0;

      const reloadParams = {
        model: modelPath,
        use_mlock: false,
        n_ctx: settings.contextLength,
        n_batch: settings.nBatch,
        n_threads: settings.nThreads,
        use_mmap: true,
        vocab_only: false,
        flash_attn: true,
        cache_type_k: 'q8_0',
        cache_type_v: 'q8_0',
      };

      // Try with GPU setting, fall back to CPU if it fails
      let gpuAttemptFailed = false;
      try {
        this.context = await initLlama({
          ...reloadParams,
          n_gpu_layers: nGpuLayers,
        } as any);
      } catch (gpuError: any) {
        if (gpuEnabled) {
          console.warn('[LLM] GPU reload failed, falling back to CPU:', gpuError?.message);
          gpuAttemptFailed = true;
        }
        this.context = await initLlama({
          ...reloadParams,
          n_gpu_layers: 0,
        } as any);
      }

      // Capture runtime GPU status
      const nativeGpuAvailable = this.context.gpu ?? false;
      this.gpuReason = (this.context as any).reasonNoGPU ?? '';
      this.gpuDevices = (this.context as any).devices ?? [];
      this.activeGpuLayers = gpuAttemptFailed ? 0 : nGpuLayers;
      this.gpuEnabled = nativeGpuAvailable && this.activeGpuLayers > 0;

      this.currentModelPath = modelPath;
      this.multimodalSupport = null;
      this.multimodalInitialized = false;

      await this.checkMultimodalSupport();

      console.log(`[LLM] Model reloaded, GPU: ${this.gpuEnabled ? `active (${this.activeGpuLayers}L)` : 'off'}`);
    } catch (error) {
      console.error('[LLM] Error reloading model:', error);
      this.context = null;
      this.currentModelPath = null;
      throw error;
    }
  }
}

export const llmService = new LLMService();
