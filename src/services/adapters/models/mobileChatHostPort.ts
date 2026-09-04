import {
  DEFAULT_IMAGE_MIME,
  chatGenerationRequestDefaults,
  generationMessageText,
  isMemoryToolAllowed,
  runtimeModelRouteId,
  type ChatContextApplicationPorts,
  type ChatGenerationPort,
  type ChatOperationApplicationPorts,
  type ChatOperationCommand,
  type ChatOperationPolicyPort,
  type ChatQueueProjection,
  type ChatRagPort,
  type ChatSessionEvent,
  type ChatSessionRepositoryPort,
  type ChatSessionServiceOptions,
  type ChatTurn,
  type GenerationEvents,
  type GenerationMessage,
  type GenerationOperation,
  type GenerationRequest,
  type GenerationResult,
} from '@offgrid/application';
import type {
  CompactableGenerationMessage,
  ContextCompactionService,
  GenerationIntentService,
} from '@offgrid/models';
import { callHook, HOOKS } from '../../../bootstrap/hookRegistry';
import { APP_CONFIG } from '../../../constants';
import {
  generationMessage,
  MobileChatTurnRepository,
} from './mobileChatTurnRepository';
import { generateChatWithModelsFacade } from './modelsFacadeGeneration';
import { useAppStore, useChatStore, useProjectStore } from '../../../stores';
import type { MediaAttachment, Message } from '../../../types';
import { isLiteRTModel } from '../../../types';
import logger from '../../../utils/logger';
import { applicationFacade } from '../../applicationFacade';
import { ensureDefaultClassifier } from '../../classifierProvisioning';
import { mobileChatGenerationProjection } from '../../chatGenerationProjection';
import { mobileCompactionOptions } from '../../contextCompactionPorts';
import { classifyMobileIntent, configuredClassifierModel } from '../../intentClassifierPorts';
import { reportModelFailure } from '../../modelFailureHandler';
import { modelInputAudioUris } from '../../modelMedia';
import { requireRagSuccess } from '../../ragOutcome';
import { activeLocalModelId } from '../../modelServices/activeRoute';
import { mobileImageChatGeneration } from '../../modelServices/imageChatGenerationPort';
import { activeMobileRoute } from '../../modelServices/mobileLLMService';
import { refreshMobileModelServices } from '../../modelServices';
import { mobileToolDefinitions } from '../../modelServices/toolPorts';

export interface MobileChatCommandOptions {
  imageMode?: 'auto' | 'force' | 'disabled';
  onClassifying?: (active: boolean) => void;
  onClassifierStatus?: (status: string | null) => void;
  onClassifierTextFallback?: () => void;
  ensureTextRoute?: () => Promise<boolean>;
}

const repository = new MobileChatTurnRepository();
const commandOptions = new Map<string, MobileChatCommandOptions>();
let queue: ChatQueueProjection = {
  entries: [],
  runningCount: 0,
  queuedCount: 0,
};
const queueListeners = new Set<(projection: ChatQueueProjection) => void>();
const sessionEventListeners = new Set<(event: ChatSessionEvent) => void>();

export function prepareMobileChatMessage(
  conversationId: string,
  turnId: string,
): Message | null {
  return repository.prepareNew(conversationId, turnId);
}

export function mobileGenerationMessage(message: Message): GenerationMessage {
  return generationMessage(message);
}

export async function withMobileChatCommandOptions<T>(
  turnId: string,
  options: MobileChatCommandOptions,
  run: () => Promise<T>,
): Promise<T> {
  commandOptions.set(turnId, options);
  try {
    return await run();
  } finally {
    commandOptions.delete(turnId);
  }
}

export const mobileChatQueueSnapshot = (): ChatQueueProjection => queue;
export function subscribeMobileChatQueue(
  listener: (projection: ChatQueueProjection) => void,
): () => void {
  queueListeners.add(listener);
  return () => queueListeners.delete(listener);
}
export function subscribeMobileChatSessionEvents(
  listener: (event: ChatSessionEvent) => void,
): () => void {
  sessionEventListeners.add(listener);
  return () => sessionEventListeners.delete(listener);
}
export function invalidateMobileChatSession(conversationId: string): void {
  repository.invalidate(conversationId);
}

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

/** The composition root passes the composed intent service; this module stays port-only. */
export function mobileChatOperationPorts(
  intent: GenerationIntentService,
): ChatOperationApplicationPorts {
  return {
    inspect() {
      const state = useAppStore.getState();
      const facts = {
        imageEnabled: true,
        imageGenerationRunning: mobileImageChatGeneration.isGenerating(),
        imageRoutingMode:
          state.settings.imageGenerationMode === 'manual' ? ('manual' as const) : ('auto' as const),
        imageRouteAvailable: !!activeMobileRoute('image').model,
        textRouteAvailable: !!activeMobileRoute('text').model,
        modelAutoDetection: state.settings.autoDetectMethod === 'llm',
        dedicatedClassifierAvailable:
          !!state.settings.classifierModelId &&
          state.downloadedModels.some(
            model => model.id === state.settings.classifierModelId,
          ),
      };
      logger.log(`[ROUTE-SM] facts ${JSON.stringify(facts)}`);
      return facts;
    },
    provisionClassifier: () => {
      ensureDefaultClassifier().catch(error =>
        projectClassifierFailure('provisioning', error),
      );
    },
    classify(text, input) {
      return classifyMobileIntent(intent, text, {
        useLLM: input.useModel,
        classifierModel: configuredClassifierModel(),
        onStatusChange: input.onStatusChange,
      });
    },
    refreshRoutes: async () => {
      await refreshMobileModelServices();
    },
    onClassificationError: error =>
      projectClassifierFailure('classification', error),
  };
}

export function mobileChatOperationCommand(input: {
  userMessage: GenerationMessage;
  requestedOperation?: GenerationOperation;
  signal: AbortSignal;
  identity: { turnId: string };
}): ChatOperationCommand {
  const options = commandOptions.get(input.identity.turnId);
  const hasImage =
    Array.isArray(input.userMessage.content) &&
    input.userMessage.content.some(part => part.type === 'image');
  return {
    text: generationMessageText(input.userMessage),
    hasImage,
    requestedOperation: input.requestedOperation,
    imageMode: options?.imageMode,
    onClassifying: options?.onClassifying,
    onClassifierStatus: options?.onClassifierStatus,
    onClassifierTextFallback: options?.onClassifierTextFallback,
    ensureTextRoute: options?.ensureTextRoute,
  };
}

export function mobileChatContextPorts(): ChatContextApplicationPorts {
  return {
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
      return requireRagSuccess(
        await applicationFacade().rag.listDocuments(projectId),
      )
        .filter(document => document.enabled)
        .map(document => document.name);
    },
    async retrieve(projectId, query) {
      return requireRagSuccess(
        await applicationFacade().rag.buildContext(projectId, query),
      ) || undefined;
    },
    audioUris: attachment => modelInputAudioUris([attachment as MediaAttachment]),
    onRetrievalError: error =>
      logger.error('[ChatSession] RAG augmentation failed', error),
  };
}

function publishSessionEvent(event: ChatSessionEvent): void {
  sessionEventListeners.forEach(listener => listener(event));
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
    await refreshMobileModelServices();
    return generateChatWithModelsFacade(request, events);
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
    if (!generated) {
      throw new Error(mobileImageChatGeneration.lastError() ?? 'Image generation returned no image');
    }
    const model =
      (request.routeId ? applicationFacade().models.lookup(request.routeId) : null) ??
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
            mimeType: DEFAULT_IMAGE_MIME,
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

export function mobileChatRequestDefaults(): ChatTurn['request']['request'] {
  const state = useAppStore.getState();
  const selected = state.downloadedModels.find(
    model => model.id === activeLocalModelId('text'),
  );
  return { profile: 'chat', ...chatGenerationRequestDefaults({
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
  }) };
}

export function mobileChatSessionPorts(
  rag: ChatRagPort,
  operation: ChatOperationPolicyPort,
  compaction: ContextCompactionService<CompactableGenerationMessage>,
): [ChatGenerationPort, ChatSessionRepositoryPort, ChatSessionServiceOptions] {
  return [
    { generate: generateForSession },
    repository,
    {
      rag,
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
      operation,
      compactionRetry: {
        shouldRetry: ({ error }) => compaction.isCapacityError(error),
      },
      compaction: {
        compact: context =>
          compaction.compactChat(context, mobileCompactionOptions(context)),
      },
      events: { publish: publishSessionEvent },
    },
  ];
}
