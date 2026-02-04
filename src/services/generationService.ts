/**
 * GenerationService - Handles LLM generation independently of UI lifecycle
 * This allows generation to continue even when the user navigates away from the chat screen
 */

import { Platform } from 'react-native';
import { llmService } from './llm';
import { activeModelService } from './activeModelService';
import { useAppStore, useChatStore } from '../stores';
import { Message, GenerationMeta } from '../types';

export interface GenerationState {
  isGenerating: boolean;
  isThinking: boolean;
  conversationId: string | null;
  streamingContent: string;
  startTime: number | null;
}

type GenerationListener = (state: GenerationState) => void;

class GenerationService {
  private state: GenerationState = {
    isGenerating: false,
    isThinking: false,
    conversationId: null,
    streamingContent: '',
    startTime: null,
  };

  private listeners: Set<GenerationListener> = new Set();
  private abortRequested: boolean = false;

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
    if (!llmService.isModelLoaded()) {
      throw new Error('No model loaded');
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
          console.error('[GenerationService] Generation error:', error);
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

  private resetState(): void {
    this.updateState({
      isGenerating: false,
      isThinking: false,
      conversationId: null,
      streamingContent: '',
      startTime: null,
    });
  }
}

export const generationService = new GenerationService();
