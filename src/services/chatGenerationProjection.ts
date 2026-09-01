/** Mobile projection of the Shared ChatSessionService lifecycle. */
import type { ChatSessionEvent, ChatTurn } from '@offgrid/models';
import { useAppStore, useChatStore } from '../stores';
import type { GenerationMeta } from '../types';
import { maybeScheduleSharePrompt } from '../utils/sharePrompt';
import { checkProPromptForText } from './proPrompt';
import { buildGenerationMetaImpl } from './generationServiceHelpers';

const SHARE_PROMPT_DELAY_MS = 1500;

export interface GenerationState {
  isGenerating: boolean;
  isThinking: boolean;
  conversationId: string | null;
  streamingContent: string;
  startTime: number | null;
  routedToolNames?: string[];
}

type GenerationListener = (state: GenerationState) => void;

/** Projects Shared chat events into Mobile UI state. It owns no generation policy. */
class MobileGenerationProjection {
  private state: GenerationState = {
    isGenerating: false,
    isThinking: false,
    conversationId: null,
    streamingContent: '',
    startTime: null,
  };
  private readonly listeners = new Set<GenerationListener>();
  private totalReasoningLength = 0;
  private remoteTimeToFirstToken: number | undefined;

  getState(): GenerationState { return { ...this.state }; }

  isGeneratingFor(conversationId: string): boolean {
    return this.state.isGenerating && this.state.conversationId === conversationId;
  }

  subscribe(listener: GenerationListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  publish(event: ChatSessionEvent): void {
    switch (event.type) {
      case 'started': this.start(event.turn); return;
      case 'partial': this.partial(event.turn, event.partial.content, event.partial.reasoning); return;
      case 'tool_started': this.toolStarted(event.call.name); return;
      case 'completed': this.complete(event.turn); return;
      case 'stopped': this.stop(event.turn); return;
      case 'failed': this.fail(event.turn); return;
      default: return;
    }
  }

  private start(turn: ChatTurn): void {
    if (turn.request.operation.type === 'image') return;
    this.totalReasoningLength = 0;
    this.remoteTimeToFirstToken = undefined;
    this.update({ isGenerating: true, isThinking: true, conversationId: turn.conversationId,
      streamingContent: '', startTime: Date.now(), routedToolNames: [] });
    useChatStore.getState().startStreaming(turn.conversationId);
  }

  private partial(turn: ChatTurn, content: string, reasoning: string): void {
    if (this.state.conversationId !== turn.conversationId) return;
    const store = useChatStore.getState();
    const previousContent = this.state.streamingContent;
    const contentDelta = content.startsWith(previousContent)
      ? content.slice(previousContent.length)
      : content;
    const reasoningDelta = reasoning.slice(this.totalReasoningLength);
    if (contentDelta) {
      if (!previousContent && this.state.startTime) {
        this.remoteTimeToFirstToken = (Date.now() - this.state.startTime) / 1000;
      }
      store.appendToStreamingMessage(contentDelta);
    }
    if (reasoningDelta) store.appendToStreamingReasoningContent(reasoningDelta);
    this.totalReasoningLength = reasoning.length;
    this.update({ streamingContent: content, isThinking: !content.length });
  }

  private toolStarted(name: string): void {
    useChatStore.getState().resetStreamingSegment();
    this.totalReasoningLength = 0;
    this.update({ streamingContent: '', isThinking: true,
      routedToolNames: [...(this.state.routedToolNames ?? []), name] });
  }

  private complete(turn: ChatTurn): void {
    if (turn.request.operation.type === 'image') return;
    const store = useChatStore.getState();
    const content = turn.partial?.content || turn.result?.content || '';
    if (!this.state.streamingContent && content) store.appendToStreamingMessage(content);
    store.finalizeStreamingMessage(turn.conversationId, this.elapsed(), this.meta());
    this.checkSharePrompt();
    this.reset();
  }

  private stop(turn: ChatTurn): void {
    if (turn.request.operation.type === 'image') return;
    const store = useChatStore.getState();
    const partial = turn.partial?.content ?? store.streamingMessage;
    if (partial && !store.streamingMessage) store.appendToStreamingMessage(partial);
    if (store.streamingForConversationId) {
      store.finalizeStreamingMessage(turn.conversationId, this.elapsed(), this.meta());
      if (partial.trim()) this.checkSharePrompt();
    } else store.clearStreamingMessage();
    this.reset();
  }

  private fail(turn: ChatTurn): void {
    if (turn.request.operation.type === 'image') return;
    const store = useChatStore.getState();
    if (store.streamingForConversationId) {
      store.finalizeStreamingMessage(turn.conversationId, this.elapsed(), this.meta());
    } else store.clearStreamingMessage();
    this.reset();
  }

  private elapsed(): number | undefined {
    return this.state.startTime ? Date.now() - this.state.startTime : undefined;
  }

  private meta(): GenerationMeta { return buildGenerationMetaImpl(this); }

  private checkSharePrompt(): void {
    const state = useAppStore.getState();
    const count = state.incrementTextGenerationCount();
    maybeScheduleSharePrompt({ variant: 'text', count, hasEngaged: state.hasEngagedSharePrompt,
      delayMs: SHARE_PROMPT_DELAY_MS });
    checkProPromptForText(SHARE_PROMPT_DELAY_MS);
  }

  private reset(): void {
    this.totalReasoningLength = 0;
    this.remoteTimeToFirstToken = undefined;
    this.update({ isGenerating: false, isThinking: false, conversationId: null,
      streamingContent: '', startTime: null, routedToolNames: [] });
  }

  private update(partial: Partial<GenerationState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener(this.getState());
  }
}

export const mobileChatGenerationProjection = new MobileGenerationProjection();
