/* eslint-disable max-lines -- Mobile streaming is one native/UI projection boundary; shared ChatSessionService owns turn policy. */
/** GenerationService - Handles LLM generation independently of UI lifecycle */
import { getActiveEngineService, stopAllTextEngines } from './engines';
import { useAppStore, useChatStore } from '../stores';
import { Message, GenerationMeta, MediaAttachment, isLiteRTModel } from '../types';
import type { ToolResult } from './tools/types';
import type {
  GenerationEvents,
  GenerationContentPart,
  GenerationMessage,
  GenerationRequest,
  GenerationResult,
  GenerationReasoning,
  GenerationToolCall,
} from '@offgrid/models';
import logger from '../utils/logger';
import { maybeScheduleSharePrompt } from '../utils/sharePrompt';
import { checkProPromptForText } from './proPrompt';
import {
  buildGenerationMetaImpl,
  FLUSH_INTERVAL_MS,
} from './generationServiceHelpers';
import { mobileGenerationService, refreshMobileModelServices } from './modelServices';
import {
  activeMobileRoute,
  activeMobileTextProvider,
} from './modelServices/mobileLLMService';
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

function sharedRequestSettings(): {
  maxTokens: number;
  sampling: {
    temperature: number;
    topP: number;
    repetitionPenalty?: number;
  };
} {
  const state = useAppStore.getState();
  const selected = state.downloadedModels.find(model => model.id === state.activeModelId);
  if (selected && isLiteRTModel(selected)) {
    return {
      maxTokens: state.settings.liteRTMaxTokens,
      sampling: {
        temperature: state.settings.liteRTTemperature,
        topP: state.settings.liteRTTopP,
      },
    };
  }
  return {
    maxTokens: state.settings.maxTokens,
    sampling: {
      temperature: state.settings.temperature,
      topP: state.settings.topP,
      repetitionPenalty: state.settings.repeatPenalty,
    },
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

  /** Pin every text request to the one canonical shared selection. */
  private selectedTextRoute(): { routeId?: string; allowFallback: false } {
    const selectedId = activeMobileRoute('text').selectedId;
    return { routeId: selectedId ?? undefined, allowFallback: false };
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
    let firstContent = true;
    await this.generateForChatSession({
        operation: { type: 'text' },
        ...this.selectedTextRoute(),
        messages: sharedMessages(messages),
        ...sharedRequestSettings(),
        reasoning: sharedReasoning(),
        identity: {
          conversationId,
          turnId: turnId(messages, conversationId, this.generationAttempt + 1),
        },
      }, {
        chunk: chunk => {
          if (firstContent && chunk.content) {
            firstContent = false;
            onFirstToken?.();
          }
        },
      });
  }

  /**
   * Mobile projection for the shared ChatSessionService generation port.
   * Shared owns the turn lifecycle. This class only projects native stream state,
   * metrics, and persistence into the existing Mobile UI store.
   */
  async generateForChatSession(
    request: GenerationRequest,
    events: GenerationEvents = {},
  ): Promise<GenerationResult> {
    const conversationId = request.identity?.conversationId;
    if (!conversationId) throw new Error('Chat generation requires a conversation identity');
    if (this.state.isGenerating) throw new Error('A generation is already running');
    if (this.pendingStop) await this.pendingStop;

    const attempt = ++this.generationAttempt;
    const controller = new AbortController();
    const abortFromSession = () => controller.abort();
    request.signal?.addEventListener('abort', abortFromSession, { once: true });
    this.currentSharedAbortController = controller;
    this.beginSharedGeneration(conversationId);
    let firstContent = true;

    try {
      await refreshMobileModelServices();
      const result = await mobileGenerationService.generate(
        {
          ...request,
          ...(!request.routeId ? this.selectedTextRoute() : {}),
          ...(!request.sampling && request.maxTokens == null
            ? sharedRequestSettings()
            : {}),
          reasoning: request.reasoning ?? sharedReasoning(),
          signal: controller.signal,
        },
        {
          ...events,
          chunk: chunk => {
            events.chunk?.(chunk);
            if (!this.ownsSharedAttempt(controller, attempt)) return;
            if (chunk.content) {
              if (firstContent) {
                firstContent = false;
                this.remoteTimeToFirstToken = this.state.startTime
                  ? (Date.now() - this.state.startTime) / 1000
                  : undefined;
                this.updateState({ isThinking: false });
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
          toolStarted: call => {
            events.toolStarted?.(call);
            this.forceFlushTokens();
            useChatStore.getState().resetStreamingSegment();
            this.tokenBuffer = '';
            this.reasoningBuffer = '';
            this.state.streamingContent = '';
          },
          toolCompleted: (call, toolResult) => events.toolCompleted?.(call, toolResult),
        },
      );
      if (!this.ownsSharedAttempt(controller, attempt)) return result;
      this.finishSharedGeneration(conversationId, result.content);
      return result;
    } catch (error) {
      if (this.ownsSharedAttempt(controller, attempt)) {
        logger.error('[GenerationService] Chat session generation error:', error);
        this.keepShownPartialOrClear();
        this.resetState();
      }
      throw error;
    } finally {
      request.signal?.removeEventListener('abort', abortFromSession);
      if (this.currentSharedAbortController === controller) {
        this.currentSharedAbortController = null;
      }
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
      await refreshMobileModelServices();
      const tools = await mobileToolDefinitions(options.enabledToolIds, messages);
      const promptMessages = mobileToolPromptMessages(messages, options.enabledToolIds, tools.length > 0);
      this.state.routedToolNames = tools.map(tool => tool.name);
      const configuredMax = useAppStore.getState().settings.maxToolCalls;
      const maxToolCalls = Number.isInteger(configuredMax) && configuredMax! >= 1 && configuredMax! <= 100
        ? configuredMax!
        : 25;
      const result = await mobileGenerationService.generate({
        operation: { type: 'text' },
        ...this.selectedTextRoute(),
        messages: sharedMessages(promptMessages),
        ...sharedRequestSettings(),
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
        toolStarted: call => {
          // The shared loop has persisted the completed assistant/tool-call round.
          // Start the next live segment empty so its Thinking block contains only
          // the current round, not reasoning already shown in the completed round.
          this.forceFlushTokens();
          useChatStore.getState().resetStreamingSegment();
          this.tokenBuffer = '';
          this.reasoningBuffer = '';
          this.state.streamingContent = '';
          options.onToolCallStart?.(call.name, decodedToolArguments(call));
        },
        toolCompleted: (call, toolResult) => options.onToolCallComplete?.(call.name, mobileToolResult(toolResult, call)),
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

  /** Preserve all content already shown when generation stops. */
  private keepShownPartialOrClear(generationTimeMs?: number): void {
    this.forceFlushTokens(); // flush any batched tokens to the store so a partial isn't lost to a pending timer
    const store = useChatStore.getState();
    const convId = store.streamingForConversationId;
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
    this.abortRequested = true;
    this.generationAttempt += 1;
    this.currentSharedAbortController?.abort();
    this.currentSharedAbortController = null;
    if (!this.state.isGenerating) {
      await stopAllTextEngines();
      const provider = activeMobileTextProvider();
      if (provider) provider.stopGeneration().catch(() => { });
      this.keepShownPartialOrClear();
      return '';
    }

    this.forceFlushTokens();

    const { startTime } = this.state;
    const generationTime = startTime ? Date.now() - startTime : undefined;
    const partialContent = useChatStore.getState().streamingMessage || this.state.streamingContent;

    const hadShownPartial = !!useChatStore.getState().streamingMessage.trim();
    this.keepShownPartialOrClear(generationTime);
    if (hadShownPartial) this.checkSharePrompt();

    this.resetState();

    if (activeMobileRoute('text').model?.source === 'remote') {
      const provider = activeMobileTextProvider();
      if (provider) provider.stopGeneration().catch(() => { });
      return partialContent;
    }

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

  /** Release messages queued behind an image generation. */
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
