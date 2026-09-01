import {
  ChatSessionService,
  CHAT_GENERATION_RECLAIM_POLICY,
  appendProjectKnowledge,
  composeChatContext,
  type ChatSessionEvent,
  type ChatQueueProjection,
  type ChatSessionRepositoryPort,
  type ChatTurn,
  type GenerationMessage,
  type GenerationOperation,
  type GenerationRequest,
  type GenerationResult,
  runtimeModelRouteId,
  projectChatMessage,
} from '@offgrid/models';
import { APP_CONFIG } from '../../constants';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { generationService } from '../../services/generationService';
import { mobileImageChatGeneration } from '../../services/modelServices/imageChatGenerationPort';
import { contextCompactionService } from '../../services/contextCompaction';
import { ragService, retrievalService } from '../../services';
import { mobileToolDefinitions } from '../../services/modelServices/toolPorts';
import { activeMobileRoute } from '../../services/modelServices/mobileLLMService';
import { mobileLLMService } from '../../services/modelServices/mobileLLMService';
import { refreshMobileModelServices } from '../../services/modelServices';
import { modelResidencyManager } from '../../services/modelServices/residencyBootstrap';
import { modelInputAudioUris } from '../../services/modelMedia';
import { useAppStore, useChatStore, useProjectStore } from '../../stores';
import type { MediaAttachment, Message } from '../../types';
import logger from '../../utils/logger';

function generationMessage(message: Message): GenerationMessage {
  return projectChatMessage(message, {
    audioUris: attachment => modelInputAudioUris([attachment as MediaAttachment]),
  });
}

function messageText(message: GenerationMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter(part => part.type === 'text')
    .map(part => part.type === 'text' ? part.text : '')
    .join('\n');
}

/** Reconstruct shared turn records from the durable Mobile conversation projection. */
function persistedTurns(conversationId: string): ChatTurn[] {
  const conversation = useChatStore.getState().conversations.find(
    candidate => candidate.id === conversationId,
  );
  if (!conversation) return [];
  const turns: ChatTurn[] = [];
  for (let index = 0; index < conversation.messages.length; index += 1) {
    const user = conversation.messages[index];
    if (user.role !== 'user' || user.isSystemInfo) continue;
    const replies = conversation.messages.slice(index + 1);
    const nextUser = replies.findIndex(message => message.role === 'user');
    const segment = nextUser < 0 ? replies : replies.slice(0, nextUser);
    const responseMessages = segment
      .filter(message => message.role === 'assistant' || message.role === 'tool')
      .map(generationMessage);
    const assistant = [...responseMessages].reverse().find(message => message.role === 'assistant');
    const operation: GenerationOperation = user.turnKind === 'image'
      ? { type: 'image', prompt: user.content }
      : user.attachments?.some(attachment => attachment.type === 'image')
        ? { type: 'vision' }
        : { type: 'text' };
    turns.push({
      id: user.id,
      conversationId,
      projectId: conversation.projectId,
      userMessage: generationMessage(user),
      assistantMessage: assistant,
      responseMessages: responseMessages.length ? responseMessages : undefined,
      status: assistant ? 'completed' : 'queued',
      request: { operation, request: {} },
    });
  }
  return turns;
}

class MobileChatTurnRepository implements ChatSessionRepositoryPort {
  private readonly sessions = new Map<string, ChatTurn[]>();

  async read(conversationId: string): Promise<readonly ChatTurn[]> {
    const current = this.sessions.get(conversationId);
    if (current) return current;
    const hydrated = persistedTurns(conversationId);
    this.sessions.set(conversationId, hydrated);
    return hydrated;
  }

  async write(conversationId: string, turns: readonly ChatTurn[]): Promise<void> {
    this.sessions.set(conversationId, [...turns]);
  }

  invalidate(conversationId: string): void {
    this.sessions.delete(conversationId);
  }

  /** Seed durable history without the new row before ChatSessionService appends it. */
  prepareNew(conversationId: string, turnId: string): Message | null {
    const conversation = useChatStore.getState().conversations.find(
      candidate => candidate.id === conversationId,
    );
    const message = conversation?.messages.find(candidate => candidate.id === turnId) ?? null;
    if (!message) return null;
    if (!this.sessions.has(conversationId)) {
      this.sessions.set(
        conversationId,
        persistedTurns(conversationId).filter(turn => turn.id !== turnId),
      );
    }
    return message;
  }
}

const repository = new MobileChatTurnRepository();
let activeTurnId: string | null = null;
let queue: ChatQueueProjection = { entries: [], runningCount: 0, queuedCount: 0 };
const queueListeners = new Set<(projection: ChatQueueProjection) => void>();

async function ragMessages(
  conversationId: string,
  projectId: string | undefined,
  signal: AbortSignal,
): Promise<GenerationMessage[]> {
  const conversation = useChatStore.getState().conversations.find(
    candidate => candidate.id === conversationId,
  );
  const project = projectId
    ? useProjectStore.getState().getProject(projectId)
    : null;
  const baseSystemPrompt = project?.systemPrompt
    || useAppStore.getState().settings.systemPrompt
    || APP_CONFIG.defaultSystemPrompt;
  let systemPrompt = callHook<string>(HOOKS.audioAugmentPrompt, baseSystemPrompt) ?? baseSystemPrompt;

  if (projectId && !signal.aborted) {
    try {
      const documents = await ragService.getDocumentsByProject(projectId);
      const enabled = documents.filter(document => document.enabled);
      if (enabled.length) {
        const query = [...(conversation?.messages ?? [])]
          .reverse()
          .find(message => message.role === 'user')?.content ?? '';
        const result = await ragService.searchProject(projectId, query);
        systemPrompt = appendProjectKnowledge({
          systemPrompt,
          documentNames: enabled.map(document => document.name),
          retrievalContext: result.chunks.length
            ? retrievalService.formatForPrompt(result)
            : undefined,
        });
      }
    } catch (error) {
      logger.error('[ChatSession] RAG augmentation failed', error);
    }
  }

  return composeChatContext({
    systemPrompt,
    messages: conversation?.messages ?? [],
    compactionSummary: conversation?.compactionSummary,
    compactionCutoffMessageId: conversation?.compactionCutoffMessageId,
    audioUris: attachment => modelInputAudioUris([attachment as MediaAttachment]),
  });
}

function publishSessionEvent(event: ChatSessionEvent): void {
  if (event.type === 'queue_changed') {
    queue = event.queue;
    queueListeners.forEach(listener => listener(queue));
    return;
  }
  if (event.type === 'started') {
    activeTurnId = event.turn.id;
    return;
  }
  if (
    (event.type === 'completed' || event.type === 'stopped' || event.type === 'failed')
    && activeTurnId === event.turn.id
  ) activeTurnId = null;
}

async function generateForSession(
  request: GenerationRequest,
  events: Parameters<typeof generationService.generateForChatSession>[1] = {},
): Promise<GenerationResult> {
  if (request.operation?.type !== 'image') {
    return generationService.generateForChatSession(request, events);
  }
  const identity = request.identity;
  if (!identity?.conversationId) throw new Error('Image generation requires a conversation identity');
  await refreshMobileModelServices();
  const abort = () => { mobileImageChatGeneration.cancel().catch(() => undefined); };
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
    const model = (request.routeId ? mobileLLMService.get(request.routeId) : null)
      ?? activeMobileRoute('image').model;
    if (!model) throw new Error('The selected image model is unavailable');
    const routeId = model.routeId ?? runtimeModelRouteId(model);
    return {
      model,
      output: {
        type: 'image',
        images: [{
          id: generated.id,
          mimeType: 'image/png',
          uri: `file://${generated.imagePath}`,
          width: generated.width,
          height: generated.height,
          seed: generated.seed,
        }],
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

const service = new ChatSessionService(
  { generate: generateForSession },
  repository,
  {
    rag: {
      augment: ({ identity, signal }) => ragMessages(
        identity.conversationId,
        identity.projectId,
        signal,
      ),
    },
    tools: {
      resolve: async ({ identity }) => {
        const enabledToolIds = useAppStore.getState().settings.enabledTools ?? [];
        const active = activeMobileRoute('text').model;
        if (!enabledToolIds.length || !active?.capabilities.tools) return {};
        const messages = useChatStore.getState()
          .getConversationMessages(identity.conversationId)
          .filter(message => !message.isSystemInfo);
        const tools = await mobileToolDefinitions(enabledToolIds, messages);
        return tools.length ? { tools, toolChoice: 'auto' } : {};
      },
    },
    compactionRetry: {
      shouldRetry: ({ error }) => contextCompactionService.isContextFullError(error),
      mayReplaceCommittedPartial: () => false,
    },
    compaction: {
      compact: async ({ identity, messages }) => {
        const system = messages.find(message => message.role === 'system');
        const mobileMessages = useChatStore.getState()
          .getConversationMessages(identity.conversationId)
          .filter(message => !message.isSystemInfo);
        const conversation = useChatStore.getState().conversations.find(
          candidate => candidate.id === identity.conversationId,
        );
        const compacted = await contextCompactionService.compact({
          conversationId: identity.conversationId,
          systemPrompt: system ? messageText(system) : APP_CONFIG.defaultSystemPrompt,
          allMessages: mobileMessages,
          previousSummary: conversation?.compactionSummary,
        });
        return compacted.map(generationMessage);
      },
    },
    events: { publish: publishSessionEvent },
  },
);

/** Application lifecycle step. Shared owns the reclaim rule; Mobile supplies the runtime port. */
export async function prepareMobileChatGeneration(): Promise<void> {
  await modelResidencyManager.reclaim(CHAT_GENERATION_RECLAIM_POLICY);
}

export const mobileChatSession = {
  /** Execute a user row that Mobile has already persisted. */
  async sendPersisted(conversationId: string, turnId: string): Promise<ChatTurn> {
    const conversation = useChatStore.getState().conversations.find(
      candidate => candidate.id === conversationId,
    );
    const message = repository.prepareNew(conversationId, turnId);
    if (!message || message.role !== 'user') throw new Error(`Chat turn not found: ${turnId}`);
    const operation: GenerationOperation = message.turnKind === 'image'
      ? { type: 'image', prompt: message.content }
      : message.attachments?.some(attachment => attachment.type === 'image')
        ? { type: 'vision' }
        : { type: 'text' };
    return service.send({
      conversationId,
      turnId,
      projectId: conversation?.projectId,
      userMessage: generationMessage(message),
      operation,
      allowFallback: false,
    });
  },

  async regenerate(
    conversationId: string,
    turnId: string,
    operation?: GenerationOperation,
  ): Promise<ChatTurn> {
    repository.invalidate(conversationId);
    return service.regenerate({ conversationId, turnId, operation });
  },

  async edit(conversationId: string, turnId: string, message: Message): Promise<ChatTurn> {
    repository.invalidate(conversationId);
    return service.edit({
      conversationId,
      turnId,
      userMessage: generationMessage(message),
    });
  },

  stop(): boolean {
    return activeTurnId ? service.stop(activeTurnId) : false;
  },

  stopConversation(conversationId: string): number {
    return service.stopConversation(conversationId);
  },

  clearQueued(): void {
    for (const entry of queue.entries) {
      if (entry.status === 'queued') service.stop(entry.turnId, 'Queue cleared');
    }
  },

  subscribeQueue(listener: (projection: ChatQueueProjection) => void): () => void {
    queueListeners.add(listener);
    listener(queue);
    return () => queueListeners.delete(listener);
  },

  invalidate(conversationId: string): void {
    repository.invalidate(conversationId);
  },
};
