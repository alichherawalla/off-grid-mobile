/**
 * GenerationService - Handles LLM generation independently of UI lifecycle
 * This allows generation to continue even when the user navigates away from the chat screen
 */

import { llmService } from './llm';
import { useAppStore, useChatStore } from '../stores';
import { Message, GenerationMeta, MediaAttachment } from '../types';

export interface QueuedMessage {
  id: string;
  conversationId: string;
  text: string;
  attachments?: MediaAttachment[];
  messageText: string;
}

export interface GenerationState {
  isGenerating: boolean;
  isThinking: boolean;
  conversationId: string | null;
  streamingContent: string;
  startTime: number | null;
  queuedMessages: QueuedMessage[];
}

type GenerationListener = (state: GenerationState) => void;
type QueueProcessor = (item: QueuedMessage) => Promise<void>;

class GenerationService {
  private state: GenerationState = {
    isGenerating: false,
    isThinking: false,
    conversationId: null,
    streamingContent: '',
    startTime: null,
    queuedMessages: [],
  };

  private listeners: Set<GenerationListener> = new Set();
  private abortRequested: boolean = false;
  private queueProcessor: QueueProcessor | null = null;

  /**
   * Get current generation state
   */
  getState(): GenerationState {
    return { ...this.state };
  }

  /**
   * Check if generation is in progress for a specific conversation
   */
  isGeneratingFor(conversationId: string): boolean {
    return this.state.isGenerating && this.state.conversationId === conversationId;
  }

  /**
   * Subscribe to generation state changes
   */
  subscribe(listener: GenerationListener): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach(listener => listener(state));
  }

  private updateState(partial: Partial<GenerationState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
  }

  /**
   * Generate a response for a conversation
   * This runs independently of UI - will continue even if user navigates away
   */
  async generateResponse(
    conversationId: string,
    messages: Message[],
    onFirstToken?: () => void
  ): Promise<void> {
    // Don't start if already generating
    if (this.state.isGenerating) {
      console.log('[GenerationService] Already generating, ignoring request');
      return;
    }

    // Ensure model is loaded
    const isModelLoaded = llmService.isModelLoaded();
    const isLlmGenerating = llmService.isCurrentlyGenerating();
    console.log('[GenerationService] 🟢 Starting text generation - Model loaded:', isModelLoaded, 'LLM generating:', isLlmGenerating);

    if (!isModelLoaded) {
      console.error('[GenerationService] ❌ No model loaded');
      throw new Error('No model loaded');
    }

    if (isLlmGenerating) {
      console.error('[GenerationService] ❌ LLM service is currently generating, cannot start');
      throw new Error('LLM service busy - try again in a moment');
    }

    this.abortRequested = false;
    this.updateState({
      isGenerating: true,
      isThinking: true,
      conversationId,
      streamingContent: '',
      startTime: Date.now(),
    });

    // Initialize streaming state in chat store
    const chatStore = useChatStore.getState();
    chatStore.startStreaming(conversationId);
    let firstTokenReceived = false;

    try {
      console.log('[GenerationService] 📤 Calling llmService.generateResponse...');
      await llmService.generateResponse(
        messages,
        // onStream
        (token) => {
          // Check if generation was aborted
          if (this.abortRequested) {
            return;
          }

          if (!firstTokenReceived) {
            firstTokenReceived = true;
            this.updateState({ isThinking: false });
            onFirstToken?.();
          }

          // Accumulate streaming content
          const newContent = this.state.streamingContent + token;
          this.updateState({ streamingContent: newContent });

          // Also update the chat store's streaming message for UI reactivity
          chatStore.appendToStreamingMessage(token);
        },
        // onComplete
        () => {
          console.log('[GenerationService] ✅ Text generation completed');
          if (this.abortRequested) {
            chatStore.clearStreamingMessage();
          } else {
            // Finalize the message in the store
            const generationTime = this.state.startTime
              ? Date.now() - this.state.startTime
              : undefined;

            // Build generation metadata
            const gpuInfo = llmService.getGpuInfo();
            const perfStats = llmService.getPerformanceStats();
            const { downloadedModels, activeModelId } = useAppStore.getState();
            const activeModel = downloadedModels.find(m => m.id === activeModelId);
            const meta: GenerationMeta = {
              gpu: gpuInfo.gpu,
              gpuBackend: gpuInfo.gpuBackend,
              gpuLayers: gpuInfo.gpuLayers,
              modelName: activeModel?.name,
              tokensPerSecond: perfStats.lastTokensPerSecond,
              decodeTokensPerSecond: perfStats.lastDecodeTokensPerSecond,
              timeToFirstToken: perfStats.lastTimeToFirstToken,
              tokenCount: perfStats.lastTokenCount,
            };

            chatStore.finalizeStreamingMessage(conversationId, generationTime, meta);
          }
          this.resetState();
        },
        // onError
        (error) => {
          console.error('[GenerationService] ❌ Generation error:', error);
          console.error('[GenerationService] Error message:', error?.message || 'Unknown');
          chatStore.clearStreamingMessage();
          this.resetState();
        },
        // onThinking
        () => {
          this.updateState({ isThinking: true });
        }
      );
    } catch (error) {
      console.error('[GenerationService] Generation failed:', error);
      chatStore.clearStreamingMessage();
      this.resetState();
      throw error;
    }
  }

  /**
   * Stop the current generation
   * Returns the partial content if any was generated
   */
  async stopGeneration(): Promise<string> {
    // Always try to stop native generation first, regardless of our state
    // This handles race conditions and state mismatches
    await llmService.stopGeneration().catch(() => {});

    if (!this.state.isGenerating) {
      return '';
    }

    const conversationId = this.state.conversationId;
    const streamingContent = this.state.streamingContent;
    const generationTime = this.state.startTime
      ? Date.now() - this.state.startTime
      : undefined;

    // Mark as aborted
    this.abortRequested = true;

    // If we have content and a conversation, save it
    const chatStore = useChatStore.getState();
    if (conversationId && streamingContent.trim()) {
      // Build generation metadata
      const gpuInfo = llmService.getGpuInfo();
      const perfStats = llmService.getPerformanceStats();
      const { downloadedModels, activeModelId } = useAppStore.getState();
      const activeModel = downloadedModels.find(m => m.id === activeModelId);
      const meta: GenerationMeta = {
        gpu: gpuInfo.gpu,
        gpuBackend: gpuInfo.gpuBackend,
        gpuLayers: gpuInfo.gpuLayers,
        modelName: activeModel?.name,
        tokensPerSecond: perfStats.lastTokensPerSecond,
        decodeTokensPerSecond: perfStats.lastDecodeTokensPerSecond,
        timeToFirstToken: perfStats.lastTimeToFirstToken,
        tokenCount: perfStats.lastTokenCount,
      };
      chatStore.finalizeStreamingMessage(conversationId, generationTime, meta);
    } else {
      chatStore.clearStreamingMessage();
    }

    this.resetState();
    return streamingContent;
  }

  /**
   * Add a message to the queue (processed after current generation completes)
   */
  enqueueMessage(entry: QueuedMessage): void {
    this.state = {
      ...this.state,
      queuedMessages: [...this.state.queuedMessages, entry],
    };
    this.notifyListeners();
  }

  /**
   * Remove a specific message from the queue
   */
  removeFromQueue(id: string): void {
    this.state = {
      ...this.state,
      queuedMessages: this.state.queuedMessages.filter(m => m.id !== id),
    };
    this.notifyListeners();
  }

  /**
   * Clear all queued messages
   */
  clearQueue(): void {
    this.state = {
      ...this.state,
      queuedMessages: [],
    };
    this.notifyListeners();
  }

  /**
   * Register a callback that processes queued messages.
   * ChatScreen sets this on mount and clears on unmount.
   */
  setQueueProcessor(processor: QueueProcessor | null): void {
    this.queueProcessor = processor;
  }

  /**
   * Drain all queued messages, aggregate into a single combined message,
   * and call the processor once.
   */
  private processNextInQueue(): void {
    if (this.state.queuedMessages.length === 0 || !this.queueProcessor) {
      return;
    }

    const all = this.state.queuedMessages;
    this.state = {
      ...this.state,
      queuedMessages: [],
    };
    this.notifyListeners();

    // Aggregate into a single QueuedMessage
    const combined: QueuedMessage = all.length === 1
      ? all[0]
      : {
          id: all[0].id,
          conversationId: all[0].conversationId,
          text: all.map(m => m.text).join('\n\n'),
          attachments: all.flatMap(m => m.attachments || []),
          messageText: all.map(m => m.messageText).join('\n\n'),
        };

    this.queueProcessor(combined).catch(error => {
      console.error('[GenerationService] Queue processor error:', error);
    });
  }

  private resetState(): void {
    const hasQueuedItems = this.state.queuedMessages.length > 0;

    this.updateState({
      isGenerating: false,
      isThinking: false,
      conversationId: null,
      streamingContent: '',
      startTime: null,
    });

    if (hasQueuedItems) {
      setTimeout(() => this.processNextInQueue(), 100);
    }
  }
}

export const generationService = new GenerationService();
