/** GenerationService - Handles LLM generation independently of UI lifecycle */
import { llmService } from './llm';
import { getActiveEngineService, stopAllTextEngines } from './engines';
import { useAppStore, useChatStore, useRemoteServerStore } from '../stores';
import { Message, GenerationMeta, MediaAttachment } from '../types';
import type { ToolResult } from './tools/types';
import type {
  GenerationContentPart,
  GenerationMessage,
  GenerationReasoning,
  GenerationToolCall,
} from '@offgrid/models';
import { providerRegistry } from './adapters/providers';
import logger from '../utils/logger';
import { maybeScheduleSharePrompt } from '../utils/sharePrompt';
import { checkProPromptForText } from './proPrompt';
import {
  buildGenerationMetaImpl,
  FLUSH_INTERVAL_MS,
} from './generationServiceHelpers';
import { mobileGenerationService } from './modelServices';
import { mobileToolPromptMessages } from './modelServices/toolPromptPolicy';
import { mobileToolDefinitions, mobileToolResult } from './modelServices/toolPorts';
import { modelInputAudioUris } from './modelMedia';

const SHARE_PROMPT_DELAY_MS = 1500;
function attachmentParts(attachment: MediaAttachment): GenerationContentPart[] {
  if (attachment.type === 'image') return [{ type: 'image', uri: attachment.uri, mimeType: attachment.mimeType }];
  if (attachment.type === 'audio') {
    return modelInputAudioUris([attachment]).map(uri => ({ type: 'audio', uri, mimeType: attachment.mimeType }));
  }
  return [{ type: 'file', uri: attachment.uri, mimeType: attachment.mimeType, name: attachment.fileName }];
}

function sharedMessages(messages: Message[]): GenerationMessage[] {
  return messages.map(message => {
    const attachments = message.attachments?.flatMap(attachmentParts) ?? [];
    return {
      role: message.role,
      content: attachments.length
        ? [{ type: 'text' as const, text: message.content }, ...attachments]
        : message.content,
      name: message.toolName,
      toolCallId: message.toolCallId,
      toolCalls: message.toolCalls?.map((call, index) => ({
        id: call.id ?? `${message.id}-tool-${index}`,
        name: call.name,
        arguments: call.arguments,
      })),
    };
  });
}

function sharedReasoning(): GenerationReasoning {
  const { thinkingEnabled, reasoningBudget } = useAppStore.getState().settings;
  return {
    enabled: thinkingEnabled,
    ...(reasoningBudget !== undefined && reasoningBudget > 0 ? { budgetTokens: reasoningBudget } : {}),
  };
}

function turnId(messages: Message[], conversationId: string, attempt: number): string {
  return messages.at(-1)?.uuid ?? messages.at(-1)?.id ?? `${conversationId}-${attempt}`;
}

function decodedToolArguments(call: GenerationToolCall): Record<string, any> {
  try {
    const value: unknown = JSON.parse(call.arguments || '{}');
    return value && !Array.isArray(value) && typeof value === 'object'
      ? value as Record<string, any>
      : {};
  } catch {
    return {};
  }
}

export interface QueuedMessage {
  id: string; conversationId: string; text: string;
  attachments?: MediaAttachment[]; messageText: string;
  /** The modality the user forced for THIS send (force/disabled/auto). Carried through the queue so a
   *  message the user explicitly forced to image mode is dispatched as image on drain — never re-decided
   *  at 'auto' by resolveTurnKind (#510: a queued force-image send generated as text). */
  imageMode?: 'auto' | 'force' | 'disabled';
}

export interface GenerationState {
  isGenerating: boolean;
  isThinking: boolean;
  conversationId: string | null;
  streamingContent: string;
  startTime: number | null;
  queuedMessages: QueuedMessage[];
  routedToolNames?: string[];
}

type GenerationListener = (state: GenerationState) => void;
type QueueProcessor = (item: QueuedMessage) => Promise<void>;

class GenerationService {
  private state: GenerationState = {
    isGenerating: false, isThinking: false, conversationId: null,
    streamingContent: '', startTime: null, queuedMessages: [],
  };

  private listeners: Set<GenerationListener> = new Set();
  private abortRequested: boolean = false;
  /** Monotonic owner for async generation setup. Stop invalidates work that is between awaits. */
  private generationAttempt: number = 0;
  /** Whether the last/active generation was stopped by the user — lets callers skip a
   *  "no response" retry prompt when the empty result was an intentional abort. */
  wasAborted(): boolean { return this.abortRequested; }
  private pendingStop: Promise<void> | null = null;
  private queueProcessor: QueueProcessor | null = null;
  private currentSharedAbortController: AbortController | null = null;
  private remoteTimeToFirstToken: number | undefined;

  // Token batching — collect tokens and flush to UI at a controlled rate
  private tokenBuffer: string = '';
  private reasoningBuffer: string = '';
  private totalReasoningLength: number = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Get the current provider (local or remote) */
  private getCurrentProvider() {
    const activeServerId = useRemoteServerStore.getState().activeServerId;
    if (activeServerId) {
      return providerRegistry.getProvider(activeServerId);
    }
    return providerRegistry.getProvider('local');
  }

  /** Check if using a remote provider */
  private isUsingRemoteProvider(): boolean {
    const { activeServerId } = useRemoteServerStore.getState();
    const hasProvider = activeServerId ? providerRegistry.hasProvider(activeServerId) : false;
    const localLoaded = llmService.isModelLoaded();
    logger.log(`[REMOTE-SM] isUsingRemoteProvider? activeServerId=${activeServerId ?? 'none'} hasProvider=${hasProvider} localLoaded=${localLoaded}`);
    // The explicit remote selection is authoritative. A local resident can still
    // exist briefly while an earlier load drains; it must never steal this turn.
    // A persisted server without its registered provider is not ready yet.
    return !!activeServerId && hasProvider;
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

  getState(): GenerationState { return { ...this.state }; }

  isGeneratingFor(conversationId: string): boolean {
    return this.state.isGenerating && this.state.conversationId === conversationId;
  }

  subscribe(listener: GenerationListener): () => void {
    this.listeners.add(listener); listener(this.getState()); return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void { this.listeners.forEach(l => l(this.getState())); }

  private updateState(partial: Partial<GenerationState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
  }

  private checkSharePrompt(delayMs = SHARE_PROMPT_DELAY_MS): void {
    const s = useAppStore.getState();
    const count = s.incrementTextGenerationCount();
    maybeScheduleSharePrompt({ variant: 'text', count, hasEngaged: s.hasEngagedSharePrompt, delayMs });
    checkProPromptForText(delayMs);
  }

  private buildGenerationMeta(): GenerationMeta { return buildGenerationMetaImpl(this); }

  /** Generate a response for a conversation. Runs independently of UI lifecycle. */
  async generateResponse(
    conversationId: string,
    messages: Message[],
    onFirstToken?: () => void,
  ): Promise<void> {
    logger.log(`[REMOTE-SM] generateResponse entry conv=${conversationId} msgs=${messages.length}`);
    if (this.state.isGenerating) return;
    if (this.pendingStop) await this.pendingStop;
    const attempt = ++this.generationAttempt;
    const controller = new AbortController();
    this.currentSharedAbortController = controller;
    this.beginSharedGeneration(conversationId);
    let firstContent = true;
    try {
      const result = await mobileGenerationService.generate({
        operation: { type: 'text' },
        messages: sharedMessages(messages),
        reasoning: sharedReasoning(),
        identity: { conversationId, turnId: turnId(messages, conversationId, attempt) },
        signal: controller.signal,
      }, {
        chunk: chunk => {
          if (!this.ownsSharedAttempt(controller, attempt)) return;
          if (chunk.content) {
            if (firstContent) {
              firstContent = false;
              this.remoteTimeToFirstToken = this.state.startTime
                ? (Date.now() - this.state.startTime) / 1000
                : undefined;
              this.updateState({ isThinking: false });
              onFirstToken?.();
            }
            this.state.streamingContent += chunk.content;
            this.tokenBuffer += chunk.content;
          }
          if (chunk.reasoning) {
            this.reasoningBuffer += chunk.reasoning;
            this.totalReasoningLength += chunk.reasoning.length;
          }
          this.scheduleSharedFlush(!!(chunk.content || chunk.reasoning));
        },
      });
      if (!this.ownsSharedAttempt(controller, attempt)) return;
      this.finishSharedGeneration(conversationId, result.content);
    } catch (error) {
      if (!this.ownsSharedAttempt(controller, attempt)) return;
      logger.error('[GenerationService] Shared generation error:', error);
      this.keepShownPartialOrClear();
      this.resetState();
      throw error;
    } finally {
      if (this.currentSharedAbortController === controller) this.currentSharedAbortController = null;
    }
  }

  /** Generate a response with tool calling support (LLM → tools → repeat, max 5 iterations). */
  async generateWithTools(
    conversationId: string,
    messages: Message[],
    options: {
      enabledToolIds: string[];
      projectId?: string;
      onToolCallStart?: (name: string, args: Record<string, any>) => void;
      onToolCallComplete?: (name: string, result: ToolResult) => void;
      onFirstToken?: () => void;
    },
  ): Promise<{ interrupted: boolean } | void> {
    if (this.state.isGenerating) return;
    if (this.pendingStop) await this.pendingStop;
    const attempt = ++this.generationAttempt;
    const controller = new AbortController();
    this.currentSharedAbortController = controller;
    this.beginSharedGeneration(conversationId);
    let firstContent = true;
    try {
      const tools = await mobileToolDefinitions(options.enabledToolIds, messages);
      const promptMessages = mobileToolPromptMessages(messages, options.enabledToolIds, tools.length > 0);
      this.state.routedToolNames = tools.map(tool => tool.name);
      const configuredMax = useAppStore.getState().settings.maxToolCalls;
      const maxToolCalls = Number.isInteger(configuredMax) && configuredMax! >= 1 && configuredMax! <= 100
        ? configuredMax!
        : 25;
      const result = await mobileGenerationService.generate({
        operation: { type: 'text' },
        messages: sharedMessages(promptMessages),
        reasoning: sharedReasoning(),
        identity: {
          conversationId,
          turnId: turnId(messages, conversationId, attempt),
          projectId: options.projectId,
        },
        tools,
        maxToolRounds: maxToolCalls,
        maxToolCalls,
        signal: controller.signal,
      }, {
        chunk: chunk => {
          if (!this.ownsSharedAttempt(controller, attempt)) return;
          if (chunk.content) {
            if (firstContent) {
              firstContent = false;
              this.remoteTimeToFirstToken = this.state.startTime
                ? (Date.now() - this.state.startTime) / 1000
                : undefined;
              this.updateState({ isThinking: false });
              options.onFirstToken?.();
            }
            this.state.streamingContent += chunk.content;
            this.tokenBuffer += chunk.content;
          }
          if (chunk.reasoning) {
            this.reasoningBuffer += chunk.reasoning;
            this.totalReasoningLength += chunk.reasoning.length;
          }
          this.scheduleSharedFlush(!!(chunk.content || chunk.reasoning));
        },
        toolStarted: call => options.onToolCallStart?.(call.name, decodedToolArguments(call)),
        toolCompleted: (call, result) => options.onToolCallComplete?.(call.name, mobileToolResult(result, call)),
      });
      if (!this.ownsSharedAttempt(controller, attempt)) return { interrupted: true };
      this.finishSharedGeneration(conversationId, result.content);
      return { interrupted: false };
    } catch (error) {
      if (!this.ownsSharedAttempt(controller, attempt)) return { interrupted: true };
      logger.error('[GenerationService] Shared tool generation error:', error);
      this.keepShownPartialOrClear();
      this.resetState();
      throw error;
    } finally {
      if (this.currentSharedAbortController === controller) this.currentSharedAbortController = null;
    }
  }

  private beginSharedGeneration(conversationId: string): void {
    this.abortRequested = false;
    this.updateState({ isGenerating: true, isThinking: true, conversationId, streamingContent: '', startTime: Date.now() });
    useChatStore.getState().startStreaming(conversationId);
    this.tokenBuffer = '';
    this.reasoningBuffer = '';
    this.totalReasoningLength = 0;
  }

  private ownsSharedAttempt(controller: AbortController, attempt: number): boolean {
    return !controller.signal.aborted && this.generationAttempt === attempt;
  }

  private scheduleSharedFlush(hasData: boolean): void {
    if (hasData && !this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushTokenBuffer(), FLUSH_INTERVAL_MS);
    }
  }

  private finishSharedGeneration(conversationId: string, fallbackContent: string): void {
    this.forceFlushTokens();
    const store = useChatStore.getState();
    if (!this.state.streamingContent && fallbackContent) store.appendToStreamingMessage(fallbackContent);
    const generationTime = this.state.startTime ? Date.now() - this.state.startTime : undefined;
    store.finalizeStreamingMessage(conversationId, generationTime, this.buildGenerationMeta());
    this.checkSharePrompt();
    this.resetState();
  }

  /**
   * Keep whatever is ALREADY on screen. The source of truth is the store's streamingMessage (what the user
   * sees) — NOT generationService.state.streamingContent, which can be empty for LiteRT or after a state
   * reset while a partial is still rendered. If there's shown content, finalize it (an interrupted partial
   * is still the model's output); only clear when the stream is genuinely empty. Once tokens are shown, they
   * are never discarded (device 2026-07-14: Stop dropped the partial because the decision read the wrong source).
   */
  private keepShownPartialOrClear(generationTimeMs?: number): void {
    this.forceFlushTokens(); // flush any batched tokens to the store so a partial isn't lost to a pending timer
    const store = useChatStore.getState();
    const convId = store.streamingForConversationId;
    // There is NO case to discard shown output. finalizeStreamingMessage persists whatever streamed —
    // content OR reasoning (its own guard drops a genuinely-empty stream) — and resets the streaming state
    // either way, so it's a strict superset of clear. ALWAYS finalize when a conversation is streaming; only
    // clear when there is no streaming conversation at all (nothing was ever shown). The old check looked at
    // streamingMessage ONLY, so a reasoning-only partial (LiteRT still THINKING at stop) was wrongly cleared.
    const shownLen = (store.streamingMessage + store.streamingReasoningContent).trim().length;
    logger.log(`[STOP-SM] keepShownPartialOrClear convId=${convId ?? 'null'} shown=${shownLen}ch → ${convId ? 'finalize' : 'clear'}`);
    if (convId) {
      store.finalizeStreamingMessage(convId, generationTimeMs, this.buildGenerationMeta());
    } else {
      store.clearStreamingMessage();
    }
  }

  /** Stop the current generation. Returns partial content if any was generated. */
  async stopGeneration(): Promise<string> {
    // Set this even between native attempts. Conversation compaction runs after the
    // failed completion has reset `isGenerating`; Stop/Eject must still prevent its retry.
    this.abortRequested = true;
    this.generationAttempt += 1;
    this.currentSharedAbortController?.abort();
    this.currentSharedAbortController = null;
    if (!this.state.isGenerating) {
      // Stop generation on every engine through the registry — no engine enumeration leaked into the caller.
      await stopAllTextEngines();
      const provider = this.getCurrentProvider();
      if (provider) provider.stopGeneration().catch(() => { });
      // Generation already reset — but a partial may still be on screen (e.g. generationSession.end ran
      // first, or LiteRT's state diverged). Keep the shown output instead of blindly clearing it.
      this.keepShownPartialOrClear();
      return '';
    }

    this.forceFlushTokens();

    const { startTime } = this.state;
    const generationTime = startTime ? Date.now() - startTime : undefined;
    // Capture the return value BEFORE resetState clears it (prefer the shown text; fall back to state).
    const partialContent = useChatStore.getState().streamingMessage || this.state.streamingContent;

    // Keep whatever is shown (based on the store, not this.state.streamingContent which LiteRT may not fill).
    const hadShownPartial = !!useChatStore.getState().streamingMessage.trim();
    this.keepShownPartialOrClear(generationTime);
    if (hadShownPartial) this.checkSharePrompt();

    this.resetState();

    // Stop both local and remote
    if (this.isUsingRemoteProvider()) {
      // Abort the provider's XHR so the server connection is closed immediately
      const provider = this.getCurrentProvider();
      if (provider) provider.stopGeneration().catch(() => { });
      return partialContent;
    }

    // Stop the native completion after we've already updated UI state,
    // so the user sees immediate feedback. Store the promise so new
    // generations can drain it before starting.
    const engine = getActiveEngineService();
    this.pendingStop = (engine?.stopGeneration() ?? Promise.resolve())
      .catch(() => { })
      .finally(() => { this.pendingStop = null; });

    return partialContent;
  }


  enqueueMessage(entry: QueuedMessage): void {
    this.state = { ...this.state, queuedMessages: [...this.state.queuedMessages, entry] };
    this.notifyListeners();
  }

  removeFromQueue(id: string): void {
    this.state = { ...this.state, queuedMessages: this.state.queuedMessages.filter(m => m.id !== id) };
    this.notifyListeners();
  }

  clearQueue(): void { this.state = { ...this.state, queuedMessages: [] }; this.notifyListeners(); }

  setQueueProcessor(processor: QueueProcessor | null): void { this.queueProcessor = processor; }

  /**
   * Process queued messages now. Text generation drains its own queue on
   * completion, but image generation finishes outside this service, so the
   * image path calls this to release messages that queued behind it. No-op if a
   * text generation is currently running.
   */
  drainQueue(): void {
    if (this.state.isGenerating) return;
    this.processNextInQueue();
  }

  private processNextInQueue(): void {
    if (this.state.queuedMessages.length === 0 || !this.queueProcessor) return;
    const all = this.state.queuedMessages;
    this.state = { ...this.state, queuedMessages: [] };
    this.notifyListeners();
    const combined: QueuedMessage = all.length === 1 ? all[0] : {
      id: all[0].id, conversationId: all[0].conversationId,
      text: all.map(m => m.text).join('\n\n'),
      attachments: all.flatMap(m => m.attachments || []),
      messageText: all.map(m => m.messageText).join('\n\n'),
      // If ANY coalesced send forced image mode, the combined dispatch must force image too — the
      // user's explicit force must never be dropped by the merge (mirror of the single-message carry).
      imageMode: all.some(m => m.imageMode === 'force') ? 'force' : all[0].imageMode,
    };
    this.queueProcessor(combined).catch(e => { logger.error('[GenerationService] Queue processor error:', e); });
  }

  private resetState(): void {
    const hasQueuedItems = this.state.queuedMessages.length > 0;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.tokenBuffer = '';
    this.reasoningBuffer = '';
    this.totalReasoningLength = 0;
    this.remoteTimeToFirstToken = undefined;
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
