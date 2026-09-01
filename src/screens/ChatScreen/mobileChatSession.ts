import {
  ChatSessionService,
  type ChatSessionEvent,
  type ChatSessionRepositoryPort,
  type ChatTurn,
  type GenerationContentPart,
  type GenerationMessage,
  type GenerationOperation,
} from '@offgrid/models';
import { APP_CONFIG } from '../../constants';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { generationService } from '../../services/generationService';
import { contextCompactionService } from '../../services/contextCompaction';
import { ragService, retrievalService } from '../../services';
import { mobileToolDefinitions } from '../../services/modelServices/toolPorts';
import { activeMobileRoute } from '../../services/modelServices/mobileLLMService';
import { modelInputAudioUris } from '../../services/modelMedia';
import { useAppStore, useChatStore, useProjectStore } from '../../stores';
import type { MediaAttachment, Message } from '../../types';
import logger from '../../utils/logger';

function attachmentParts(attachment: MediaAttachment): GenerationContentPart[] {
  if (attachment.type === 'image') {
    return [{ type: 'image', uri: attachment.uri, mimeType: attachment.mimeType }];
  }
  if (attachment.type === 'audio') {
    return modelInputAudioUris([attachment]).map(uri => ({
      type: 'audio',
      uri,
      mimeType: attachment.mimeType,
    }));
  }
  return [{
    type: 'file',
    uri: attachment.uri,
    mimeType: attachment.mimeType,
    name: attachment.fileName,
  }];
}

function generationMessage(message: Message): GenerationMessage {
  const parts = message.attachments?.flatMap(attachmentParts) ?? [];
  const documents = message.attachments
    ?.filter(attachment => attachment.type === 'document' && attachment.textContent)
    .map(attachment => `---\nAttached document: ${attachment.fileName || 'document'}\n${attachment.textContent}\n---`)
    .join('\n\n');
  const text = documents ? `${message.content}\n\n${documents}` : message.content;
  return {
    role: message.role,
    content: parts.length
      ? [{ type: 'text', text }, ...parts]
      : text,
    reasoning: message.reasoningContent,
    name: message.toolName,
    toolCallId: message.toolCallId,
    toolCalls: message.toolCalls?.map((call, index) => ({
      id: call.id ?? `${message.id}-tool-${index}`,
      name: call.name,
      arguments: call.arguments,
    })),
  };
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
    const assistant = [...segment].reverse().find(message => message.role === 'assistant');
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
      assistantMessage: assistant ? generationMessage(assistant) : undefined,
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
}

const repository = new MobileChatTurnRepository();
let activeTurnId: string | null = null;

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
  let systemPrompt = project?.systemPrompt
    || useAppStore.getState().settings.systemPrompt
    || APP_CONFIG.defaultSystemPrompt;
  systemPrompt = callHook<string>(HOOKS.audioAugmentPrompt, systemPrompt) ?? systemPrompt;

  if (projectId && !signal.aborted) {
    try {
      const documents = await ragService.getDocumentsByProject(projectId);
      const enabled = documents.filter(document => document.enabled);
      if (enabled.length) {
        const query = [...(conversation?.messages ?? [])]
          .reverse()
          .find(message => message.role === 'user')?.content ?? '';
        const result = await ragService.searchProject(projectId, query);
        systemPrompt += `\n\nYou have a knowledge base with these documents:\n${enabled
          .map(document => `- ${document.name}`)
          .join('\n')}`;
        if (result.chunks.length) systemPrompt += `\n\n${retrievalService.formatForPrompt(result)}`;
      }
    } catch (error) {
      logger.error('[ChatSession] RAG augmentation failed', error);
    }
  }

  const messages = (conversation?.messages ?? [])
    .filter(message => !message.isSystemInfo)
    .map(generationMessage);
  const cutoff = conversation?.compactionCutoffMessageId;
  const cutoffIndex = cutoff
    ? (conversation?.messages ?? []).findIndex(message => message.id === cutoff)
    : -1;
  const activeMessages = cutoffIndex >= 0
    ? (conversation?.messages ?? []).slice(cutoffIndex + 1)
      .filter(message => !message.isSystemInfo)
      .map(generationMessage)
    : messages;
  return [
    { role: 'system', content: systemPrompt },
    ...(conversation?.compactionSummary
      ? [{ role: 'assistant' as const, content: `[Previous conversation summary]\n${conversation.compactionSummary}` }]
      : []),
    ...activeMessages,
  ];
}

function publishSessionEvent(event: ChatSessionEvent): void {
  if (event.type === 'started') {
    activeTurnId = event.turn.id;
    return;
  }
  if (
    (event.type === 'completed' || event.type === 'stopped' || event.type === 'failed')
    && activeTurnId === event.turn.id
  ) activeTurnId = null;
}

const service = new ChatSessionService(
  { generate: (request, events) => generationService.generateForChatSession(request, events) },
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

export const mobileChatSession = {
  /** Execute a user row that Mobile has already persisted. */
  async sendPersisted(conversationId: string, turnId: string): Promise<ChatTurn> {
    repository.invalidate(conversationId);
    return service.resend({ conversationId, turnId });
  },

  async regenerate(conversationId: string, turnId: string): Promise<ChatTurn> {
    repository.invalidate(conversationId);
    return service.regenerate({ conversationId, turnId });
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

  invalidate(conversationId: string): void {
    repository.invalidate(conversationId);
  },
};
