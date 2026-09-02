import {
  ChatSessionService,
  ChatContextApplicationService,
  ChatOperationApplicationService,
  CHAT_GENERATION_RECLAIM_POLICY,
  chatGenerationRequestDefaults,
  isMemoryToolAllowed,
  type ChatSessionEvent,
  type ChatQueueProjection,
  type ChatTurn,
  type GenerationEvents,
  type GenerationMessage,
  type GenerationOperation,
  type GenerationRequest,
  type GenerationResult,
  runtimeModelRouteId,
} from '@offgrid/models';
import { APP_CONFIG } from '../../constants';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { mobileChatGenerationProjection } from '../../services/chatGenerationProjection';
import { mobileImageChatGeneration } from '../../services/modelServices/imageChatGenerationPort';
import { contextCompactionService } from '../../services/contextCompaction';
import { intentClassifier } from '../../services/intentClassifier';
import { ensureDefaultClassifier } from '../../services/classifierProvisioning';
import { ragService, retrievalService } from '../../services';
import { mobileToolDefinitions } from '../../services/modelServices/toolPorts';
import { activeMobileRoute } from '../../services/modelServices/mobileLLMService';
import { mobileLLMService } from '../../services/modelServices/mobileLLMService';
import { refreshMobileModelServices } from '../../services/modelServices';
import { generateMobileChat } from '../../services/modelServices/chatGenerationApplication';
import { modelResidencyManager } from '../../services/modelServices/residencyBootstrap';
import { registerMobileChatSessionControl } from '../../services/modelServices/chatSessionControl';
import { modelInputAudioUris } from '../../services/modelMedia';
import { useAppStore, useChatStore, useProjectStore } from '../../stores';
import type { MediaAttachment, Message } from '../../types';
import { isLiteRTModel } from '../../types';
import logger from '../../utils/logger';
import { reportModelFailure } from '../../services/modelFailureHandler';
import {
  generationMessage,
  MobileChatTurnRepository,
} from './mobileChatTurnRepository';

function messageText(message: GenerationMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter(part => part.type === 'text')
    .map(part => (part.type === 'text' ? part.text : ''))
    .join('\n');
}


const repository = new MobileChatTurnRepository();
let queue: ChatQueueProjection = {
  entries: [],
  runningCount: 0,
  queuedCount: 0,
};
const queueListeners = new Set<(projection: ChatQueueProjection) => void>();

export interface MobileChatCommandOptions {
  imageMode?: 'auto' | 'force' | 'disabled';
  onClassifying?: (active: boolean) => void;
  onClassifierStatus?: (status: string | null) => void;
  onClassifierTextFallback?: () => void;
  ensureTextRoute?: () => Promise<boolean>;
}

const commandOptions = new Map<string, MobileChatCommandOptions>();

type ClassifierFailureStage = 'provisioning' | 'classification';

export function projectClassifierFailure(
  stage: ClassifierFailureStage,
  error: unknown,
): void {
  logger.warn(
    `[ChatSession] Intent classifier ${stage} failed; using the selected text route`,
    error,
  );
  reportModelFailure('text', error, {
    severity: 'warning',
    id: 'mobile-chat-classifier',
    title: 'Automatic routing is unavailable',
    message: 'Off Grid will use the selected text model for this message.',
  });
}

const operationService = new ChatOperationApplicationService({
  inspect() {
    const state = useAppStore.getState();
    return {
      imageEnabled: true,
      imageGenerationRunning: mobileImageChatGeneration.isGenerating(),
      imageRoutingMode:
        state.settings.imageGenerationMode === 'manual' ? 'manual' : 'auto',
      imageRouteAvailable: !!activeMobileRoute('image').model,
      textRouteAvailable: !!activeMobileRoute('text').model,
      modelAutoDetection: state.settings.autoDetectMethod === 'llm',
      dedicatedClassifierAvailable:
        !!state.settings.classifierModelId &&
        state.downloadedModels.some(
          model => model.id === state.settings.classifierModelId,
        ),
    };
  },
  provisionClassifier: () => {
    ensureDefaultClassifier().catch(error =>
      projectClassifierFailure('provisioning', error),
    );
  },
  classify(text, input) {
    const state = useAppStore.getState();
    const classifierModel = state.settings.classifierModelId
      ? state.downloadedModels.find(
          model => model.id === state.settings.classifierModelId,
        )
      : null;
    return intentClassifier.classifyIntent(text, {
      useLLM: input.useModel,
      classifierModel,
      onStatusChange: input.onStatusChange,
    });
  },
  refreshRoutes: async () => {
    await refreshMobileModelServices();
  },
  onClassificationError: error =>
    projectClassifierFailure('classification', error),
});

async function resolveMobileChatOperation(input: {
  userMessage: GenerationMessage;
  requestedOperation?: GenerationOperation;
  recordedOperation?: GenerationOperation;
  signal: AbortSignal;
  identity: { turnId: string };
}): Promise<GenerationOperation> {
  const options = commandOptions.get(input.identity.turnId);
  const hasImage =
    Array.isArray(input.userMessage.content) &&
    input.userMessage.content.some(part => part.type === 'image');
  return operationService.resolve({
    text: messageText(input.userMessage),
    hasImage,
    requestedOperation: input.requestedOperation,
    recordedOperation: input.recordedOperation,
    imageMode: options?.imageMode,
    onClassifying: options?.onClassifying,
    onClassifierStatus: options?.onClassifierStatus,
    onClassifierTextFallback: options?.onClassifierTextFallback,
    ensureTextRoute: options?.ensureTextRoute,
  });
}

const chatContext = new ChatContextApplicationService({
  conversation: id =>
    useChatStore
      .getState()
      .conversations.find(candidate => candidate.id === id) ?? null,
  project: id => useProjectStore.getState().getProject(id) ?? null,
  defaultSystemPrompt: () =>
    useAppStore.getState().settings.systemPrompt ||
    APP_CONFIG.defaultSystemPrompt,
  augmentSystemPrompt: prompt =>
    callHook<string>(HOOKS.audioAugmentPrompt, prompt) ?? prompt,
  async enabledDocumentNames(projectId) {
    return (await ragService.getDocumentsByProject(projectId))
      .filter(document => document.enabled)
      .map(document => document.name);
  },
  async retrieve(projectId, query) {
    const result = await ragService.searchProject(projectId, query);
    return result.chunks.length
      ? retrievalService.formatForPrompt(result)
      : undefined;
  },
  audioUris: attachment => modelInputAudioUris([attachment as MediaAttachment]),
  onRetrievalError: error =>
    logger.error('[ChatSession] RAG augmentation failed', error),
});

function publishSessionEvent(event: ChatSessionEvent): void {
  if (event.type === 'started') {
    useChatStore
      .getState()
      .updateMessageTurnKind(
        event.turn.conversationId,
        event.turn.id,
        event.turn.request.operation.type === 'image' ? 'image' : 'text',
      );
  }
  mobileChatGenerationProjection.publish(event);
  if (event.type === 'queue_changed') {
    queue = event.queue;
    queueListeners.forEach(listener => listener(queue));
    return;
  }
  if (event.type === 'invalidated') {
    const first = event.turnIds[0];
    if (first)
      useChatStore.getState().deleteMessagesAfter(event.conversationId, first);
  }
}

async function generateForSession(
  request: GenerationRequest,
  events: GenerationEvents = {},
): Promise<GenerationResult> {
  if (request.operation?.type !== 'image') {
    return generateMobileChat(request, events);
  }
  const identity = request.identity;
  if (!identity?.conversationId)
    throw new Error('Image generation requires a conversation identity');
  await refreshMobileModelServices();
  const abort = () => {
    mobileImageChatGeneration.cancel().catch(() => undefined);
  };
  request.signal?.addEventListener('abort', abort, { once: true });
  try {
    const generated = await mobileImageChatGeneration.generate({
      prompt: request.operation.prompt,
      routeId: request.routeId,
      negativePrompt: request.operation.negativePrompt,
      steps: request.operation.steps,
      guidanceScale: request.operation.guidanceScale,
      seed: request.operation.seed,
      previewInterval: request.operation.previewInterval,
      conversationId: identity.conversationId,
    });
    if (!generated) throw new Error('Image generation returned no image');
    const model =
      (request.routeId ? mobileLLMService.get(request.routeId) : null) ??
      activeMobileRoute('image').model;
    if (!model) throw new Error('The selected image model is unavailable');
    const routeId = model.routeId ?? runtimeModelRouteId(model);
    return {
      model,
      output: {
        type: 'image',
        images: [
          {
            id: generated.id,
            mimeType: 'image/png',
            uri: `file://${generated.imagePath}`,
            width: generated.width,
            height: generated.height,
            seed: generated.seed,
          },
        ],
      },
      content: '',
      reasoning: '',
      toolCalls: [],
      finishReason: 'stop',
      attemptedModelIds: [model.id],
      attemptedRouteIds: [routeId],
    };
  } finally {
    request.signal?.removeEventListener('abort', abort);
  }
}

function chatRequestDefaults(): ChatTurn['request']['request'] {
  const state = useAppStore.getState();
  const selected = state.downloadedModels.find(
    model => model.id === state.activeModelId,
  );
  return chatGenerationRequestDefaults({
    runtime: selected && isLiteRTModel(selected) ? 'litert' : 'standard',
    standard: {
      maxTokens: state.settings.maxTokens,
      temperature: state.settings.temperature,
      topP: state.settings.topP,
      repetitionPenalty: state.settings.repeatPenalty,
    },
    litert: {
      maxTokens: state.settings.liteRTMaxTokens,
      temperature: state.settings.liteRTTemperature,
      topP: state.settings.liteRTTopP,
    },
    thinkingEnabled: state.settings.thinkingEnabled,
    reasoningBudget: state.settings.reasoningBudget,
    maxToolCalls: state.settings.maxToolCalls,
  });
}

const service = new ChatSessionService(
  { generate: generateForSession },
  repository,
  {
    rag: {
      augment: ({ identity, signal }) =>
        chatContext.compose({
          conversationId: identity.conversationId,
          projectId: identity.projectId,
          signal,
        }),
    },
    tools: {
      resolve: async ({ identity }) => {
        const enabledToolIds =
          useAppStore.getState().settings.enabledTools ?? [];
        const admittedToolIds = enabledToolIds.filter(toolId =>
          isMemoryToolAllowed(toolId, {
            projectActive:
              !!identity.projectId &&
              !!useProjectStore.getState().getProject(identity.projectId),
            allMemory: true,
          }),
        );
        if (!admittedToolIds.length) return {};
        const messages = useChatStore
          .getState()
          .getConversationMessages(identity.conversationId)
          .filter(message => !message.isSystemInfo);
        const tools = await mobileToolDefinitions(admittedToolIds, messages);
        return tools.length ? { tools, toolChoice: 'auto' } : {};
      },
    },
    operation: { resolve: resolveMobileChatOperation },
    compactionRetry: {
      shouldRetry: ({ error }) =>
        contextCompactionService.isContextFullError(error),
      mayReplaceCommittedPartial: () => false,
    },
    compaction: {
      compact: async ({ identity, messages }) => {
        const system = messages.find(message => message.role === 'system');
        const mobileMessages = useChatStore
          .getState()
          .getConversationMessages(identity.conversationId)
          .filter(message => !message.isSystemInfo);
        const conversation = useChatStore
          .getState()
          .conversations.find(
            candidate => candidate.id === identity.conversationId,
          );
        const compacted = await contextCompactionService.compact({
          conversationId: identity.conversationId,
          systemPrompt: system
            ? messageText(system)
            : APP_CONFIG.defaultSystemPrompt,
          allMessages: mobileMessages,
          previousSummary: conversation?.compactionSummary,
        });
        return compacted.map(generationMessage);
      },
    },
    events: { publish: publishSessionEvent },
  },
);

function stopActiveTurn(): boolean {
  const running = queue.entries.find(entry => entry.status === 'running');
  return running ? service.stop(running.turnId) : false;
}

registerMobileChatSessionControl({
  stopActive: stopActiveTurn,
  stopConversation: conversationId => service.stopConversation(conversationId),
});

/** Application lifecycle step. Shared owns the reclaim rule; Mobile supplies the runtime port. */
export async function prepareMobileChatGeneration(): Promise<void> {
  await modelResidencyManager.reclaim(CHAT_GENERATION_RECLAIM_POLICY);
}

export const mobileChatSession = {
  /** Execute a user row that Mobile has already persisted. */
  async sendPersisted(
    conversationId: string,
    turnId: string,
    options: MobileChatCommandOptions = {},
  ): Promise<ChatTurn> {
    const conversation = useChatStore
      .getState()
      .conversations.find(candidate => candidate.id === conversationId);
    const message = repository.prepareNew(conversationId, turnId);
    if (!message || message.role !== 'user')
      throw new Error(`Chat turn not found: ${turnId}`);
    const recordedOperation: GenerationOperation | undefined =
      message.turnKind === 'image'
        ? { type: 'image', prompt: message.content }
        : message.turnKind === 'text'
        ? message.attachments?.some(attachment => attachment.type === 'image')
          ? { type: 'vision' }
          : { type: 'text' }
        : options.imageMode === 'force'
        ? { type: 'image', prompt: message.content }
        : options.imageMode === 'disabled'
        ? { type: 'text' }
        : undefined;
    commandOptions.set(turnId, options);
    try {
      return await service.send({
        conversationId,
        turnId,
        projectId: conversation?.projectId,
        userMessage: generationMessage(message),
        operation: recordedOperation,
        allowFallback: false,
        request: chatRequestDefaults(),
      });
    } finally {
      commandOptions.delete(turnId);
    }
  },

  async regenerate(
    conversationId: string,
    turnId: string,
    input?:
      | GenerationOperation
      | {
          operation?: GenerationOperation;
          options?: MobileChatCommandOptions;
        },
  ): Promise<ChatTurn> {
    const operation = input && 'type' in input ? input : input?.operation;
    const options = input && 'type' in input ? {} : input?.options ?? {};
    repository.invalidate(conversationId);
    commandOptions.set(turnId, options);
    try {
      return await service.regenerate({ conversationId, turnId, operation });
    } finally {
      commandOptions.delete(turnId);
    }
  },

  async edit(
    conversationId: string,
    turnId: string,
    message: Message,
  ): Promise<ChatTurn> {
    repository.invalidate(conversationId);
    return service.edit({
      conversationId,
      turnId,
      userMessage: generationMessage(message),
    });
  },

  stop(): boolean {
    return stopActiveTurn();
  },

  stopConversation(conversationId: string): number {
    return service.stopConversation(conversationId);
  },

  clearQueued(): void {
    for (const entry of queue.entries) {
      if (entry.status === 'queued')
        service.stop(entry.turnId, 'Queue cleared');
    }
  },

  subscribeQueue(
    listener: (projection: ChatQueueProjection) => void,
  ): () => void {
    queueListeners.add(listener);
    listener(queue);
    return () => queueListeners.delete(listener);
  },

  invalidate(conversationId: string): void {
    repository.invalidate(conversationId);
  },
};
