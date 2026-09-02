import {
  projectChatMessage,
  type ChatSessionRepositoryPort,
  type ChatTurn,
  type GenerationMessage,
  type GenerationOperation,
} from '@offgrid/models';
import { modelInputAudioUris } from '../../services/modelMedia';
import { useChatStore } from '../../stores';
import type { MediaAttachment, Message } from '../../types';

export function generationMessage(message: Message): GenerationMessage {
  return projectChatMessage(message, {
    audioUris: attachment =>
      modelInputAudioUris([attachment as MediaAttachment]),
  });
}

export function generationMessageText(message: GenerationMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter(part => part.type === 'text')
    .map(part => (part.type === 'text' ? part.text : ''))
    .join('\n');
}

/** A round the session committed during the running turn, shaped for the Mobile compaction planner. */
export function committedRoundMessage(
  conversationId: string,
  message: GenerationMessage,
  index: number,
): Message {
  return {
    id: `${conversationId}-round-${index}`,
    role: message.role,
    content: generationMessageText(message),
    timestamp: Date.now(),
    toolCallId: message.toolCallId,
    toolName: message.name,
    toolCalls: message.toolCalls?.map(call => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    })),
  };
}

/** Reconstruct Shared turn records from the durable Mobile conversation projection. */
function persistedTurns(conversationId: string): ChatTurn[] {
  const conversation = useChatStore
    .getState()
    .conversations.find(candidate => candidate.id === conversationId);
  if (!conversation) return [];
  const turns: ChatTurn[] = [];
  for (let index = 0; index < conversation.messages.length; index += 1) {
    const user = conversation.messages[index];
    if (user.role !== 'user' || user.isSystemInfo) continue;
    const replies = conversation.messages.slice(index + 1);
    const nextUser = replies.findIndex(message => message.role === 'user');
    const segment = nextUser < 0 ? replies : replies.slice(0, nextUser);
    const responseMessages = segment
      .filter(
        message => message.role === 'assistant' || message.role === 'tool',
      )
      .map(generationMessage);
    const assistant = [...responseMessages]
      .reverse()
      .find(message => message.role === 'assistant');
    const operation: GenerationOperation =
      user.turnKind === 'image'
        ? { type: 'image', prompt: user.content }
        : user.attachments?.some(attachment => attachment.type === 'image')
        ? { type: 'vision' }
        : { type: 'text' };
    turns.push({
      id: user.id,
      conversationId,
      projectId: conversation.projectId,
      userMessage: generationMessage(user),
      responseMessages: responseMessages.length ? responseMessages : undefined,
      status: assistant ? 'completed' : 'queued',
      request: { operation, request: {} },
    });
  }
  return turns;
}

export class MobileChatTurnRepository implements ChatSessionRepositoryPort {
  private readonly sessions = new Map<string, ChatTurn[]>();

  async read(conversationId: string): Promise<readonly ChatTurn[]> {
    const current = this.sessions.get(conversationId);
    if (current) return current;
    const hydrated = persistedTurns(conversationId);
    this.sessions.set(conversationId, hydrated);
    return hydrated;
  }

  async write(
    conversationId: string,
    turns: readonly ChatTurn[],
  ): Promise<void> {
    this.sessions.set(conversationId, [...turns]);
  }

  invalidate(conversationId: string): void {
    this.sessions.delete(conversationId);
  }

  /** Seed durable history without the new row before ChatSessionService appends it. */
  prepareNew(conversationId: string, turnId: string): Message | null {
    const conversation = useChatStore
      .getState()
      .conversations.find(candidate => candidate.id === conversationId);
    const message =
      conversation?.messages.find(candidate => candidate.id === turnId) ?? null;
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
