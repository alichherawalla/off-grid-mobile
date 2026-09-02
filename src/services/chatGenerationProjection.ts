/** Mobile projection of the Shared ChatSessionService lifecycle. */
import type { ChatSessionEvent, ChatTurn } from '@offgrid/models';
import { useAppStore, useChatStore } from '../stores';
import type { GenerationMeta } from '../types';
import { maybeScheduleSharePrompt } from '../utils/sharePrompt';
import { checkProPromptForText } from './proPrompt';
import { buildGenerationMetaImpl, FLUSH_INTERVAL_MS } from './generationServiceHelpers';

const SHARE_PROMPT_DELAY_MS = 1500;
/** Compaction is silent otherwise; you should know the model made room and that nothing here was removed. */
export const COMPACTION_TOOL_NAME = 'context_compaction';
export function compactionNoticeText(before: number, after: number): string {
  const summarized = Math.max(0, before - after);
  return `Made room to keep going. ${summarized} earlier message${summarized === 1 ? '' : 's'} were summarized for the model; the last ${after} stay word for word. Nothing here was removed.`;
}

interface GenerationState {
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
  // Token batching — collect tokens and flush to the store at a controlled rate
  private tokenBuffer = '';
  private reasoningBuffer = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

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
      case 'compacted': this.compacted(event.turn, event.before, event.after); return;
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
    const previousContent = this.state.streamingContent;
    const contentDelta = content.startsWith(previousContent)
      ? content.slice(previousContent.length)
      : content;
    const reasoningDelta = reasoning.slice(this.totalReasoningLength);
    if (contentDelta) {
      if (!previousContent && this.state.startTime) {
        this.remoteTimeToFirstToken = (Date.now() - this.state.startTime) / 1000;
      }
      this.tokenBuffer += contentDelta;
    }
    if (reasoningDelta) this.reasoningBuffer += reasoningDelta;
    if ((contentDelta || reasoningDelta) && !this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushTokenBuffer(), FLUSH_INTERVAL_MS);
    }
    this.totalReasoningLength = reasoning.length;
    this.update({ streamingContent: content, isThinking: !content.length });
  }

  private toolStarted(name: string): void {
    this.forceFlushTokens();
    useChatStore.getState().resetStreamingSegment();
    // Shared reports turn-level cumulative reasoning across tool rounds. Keep
    // the consumed length when the visible segment resets, so the next round
    // appends only its new reasoning instead of repeating the completed round.
    this.update({ streamingContent: '', isThinking: true,
      routedToolNames: [...(this.state.routedToolNames ?? []), name] });
  }

  /** Compaction is forward-looking: text already on screen stays; the continuation streams after it. */
  private compacted(turn: ChatTurn, before: number, after: number): void {
    this.forceFlushTokens();
    const store = useChatStore.getState();
    store.resetStreamingSegment();
    // Rendered like a tool result and kept out of the prompt (isSystemInfo).
    store.addMessage(turn.conversationId, {
      role: 'tool',
      toolName: COMPACTION_TOOL_NAME,
      content: compactionNoticeText(before, after),
      isSystemInfo: true,
    });
    this.update({ streamingContent: '', isThinking: true });
  }

  private complete(turn: ChatTurn): void {
    if (turn.request.operation.type === 'image') return;
    this.forceFlushTokens();
    const store = useChatStore.getState();
    const content = turn.partial?.content || turn.result?.content || '';
    if (!this.state.streamingContent && content) store.appendToStreamingMessage(content);
    store.finalizeStreamingMessage(turn.conversationId, this.elapsed(), this.meta());
    this.checkSharePrompt();
    this.reset();
  }

  private stop(turn: ChatTurn): void {
    if (turn.request.operation.type === 'image') return;
    this.forceFlushTokens();
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
    this.forceFlushTokens();
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

  private flushTokenBuffer(): void {
    const store = useChatStore.getState();
    if (this.tokenBuffer) {
      store.appendToStreamingMessage(this.tokenBuffer);
      this.tokenBuffer = '';
    }
    if (this.reasoningBuffer) {
      store.appendToStreamingReasoningContent(this.reasoningBuffer);
      this.reasoningBuffer = '';
    }
    this.flushTimer = null;
  }

  private forceFlushTokens(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushTokenBuffer();
  }

  private reset(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.tokenBuffer = '';
    this.reasoningBuffer = '';
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
