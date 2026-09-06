import {
  projectChatMessage,
  type ChatSessionRepositoryPort,
  type ChatTurn,
  type GenerationMessage,
  type GenerationOperation,
} from '@offgrid/application';
import { useChatStore } from '../../../stores';
import type { MediaAttachment, Message } from '../../../types';
import { modelInputAudioUris } from '../../modelMedia';

export function generationMessage(message: Message): GenerationMessage {
  return projectChatMessage(message, {
    audioUris: attachment =>
      modelInputAudioUris([attachment as MediaAttachment]),
  });
}

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
        message =>
          (message.role === 'assistant' || message.role === 'tool') &&
          !message.isSystemInfo,
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
