import type { Conversation, Message } from '../types';
import { CORE_SYNC_ENTITIES } from '@offgrid/application';
import {
  deleteSyncMutation,
  emitSyncMutation,
  messagePutMutation,
} from '../services/sync/mutation';

export interface ChatMessageMutationActions {
  updateMessageContent: (
    conversationId: string,
    messageId: string,
    content: string,
  ) => void;
  updateMessageThinking: (
    conversationId: string,
    messageId: string,
    isThinking: boolean,
  ) => void;
  /** Stamp the modality a USER message's turn was dispatched as, so a resend replays the
   *  DECISION rather than re-deriving it from the replies that happen to have survived. */
  updateMessageTurnKind: (
    conversationId: string,
    messageId: string,
    turnKind: NonNullable<Message['turnKind']>,
  ) => void;
  updateMessageAudio: (
    conversationId: string,
    messageId: string,
    audio: {
      audioPath?: string;
      waveformData?: number[];
      audioDurationSeconds?: number;
      isGeneratingAudio?: boolean;
      isAudioModeMessage?: boolean;
    },
  ) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  deleteMessagesAfter: (conversationId: string, messageId: string) => void;
}

interface ChatMessageMutationOwner {
  updateConversations(
    update: (conversations: Conversation[]) => Conversation[],
  ): void;
  getConversationMessages(conversationId: string): Message[];
}

export function nextUpdatedAt(previousUpdatedAt?: string): string {
  const now = Date.now();
  if (!previousUpdatedAt) return new Date(now).toISOString();
  const previousTime = Date.parse(previousUpdatedAt);
  const nextTime = Number.isNaN(previousTime)
    ? now
    : Math.max(now, previousTime + 1);
  return new Date(nextTime).toISOString();
}

function updateMessageInConversation(
  conversation: Conversation,
  messageId: string,
  update: (message: Message) => Message,
): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map(message =>
      message.id === messageId ? update(message) : message,
    ),
    updatedAt: nextUpdatedAt(conversation.updatedAt),
  };
}

function mapConversation(
  conversations: Conversation[],
  conversationId: string,
  update: (conversation: Conversation) => Conversation,
): Conversation[] {
  return conversations.map(conversation =>
    conversation.id === conversationId ? update(conversation) : conversation,
  );
}

export function createMessageMutationActions(
  owner: ChatMessageMutationOwner,
): ChatMessageMutationActions {
  return {
    updateMessageContent: (conversationId, messageId, content) => {
      owner.updateConversations(conversations =>
        mapConversation(conversations, conversationId, conversation =>
          updateMessageInConversation(conversation, messageId, message => ({
            ...message,
            content,
          })),
        ),
      );
      const message = owner
        .getConversationMessages(conversationId)
        .find(candidate => candidate.id === messageId);
      if (message) {
        emitSyncMutation(messagePutMutation(conversationId, message));
      }
    },

    updateMessageThinking: (conversationId, messageId, isThinking) => {
      owner.updateConversations(conversations =>
        mapConversation(conversations, conversationId, conversation =>
          updateMessageInConversation(conversation, messageId, message => ({
            ...message,
            isThinking,
          })),
        ),
      );
    },

    updateMessageTurnKind: (conversationId, messageId, turnKind) => {
      owner.updateConversations(conversations =>
        mapConversation(conversations, conversationId, conversation =>
          updateMessageInConversation(conversation, messageId, message => ({
            ...message,
            turnKind,
          })),
        ),
      );
      const message = owner
        .getConversationMessages(conversationId)
        .find(candidate => candidate.id === messageId);
      if (message) {
        emitSyncMutation(messagePutMutation(conversationId, message));
      }
    },

    updateMessageAudio: (conversationId, messageId, audio) => {
      owner.updateConversations(conversations =>
        mapConversation(conversations, conversationId, conversation =>
          updateMessageInConversation(conversation, messageId, message => ({
            ...message,
            ...audio,
          })),
        ),
      );
    },

    deleteMessage: (conversationId, messageId) => {
      const removed = owner
        .getConversationMessages(conversationId)
        .find(message => message.id === messageId);
      owner.updateConversations(conversations =>
        mapConversation(conversations, conversationId, conversation => ({
          ...conversation,
          messages: conversation.messages.filter(
            message => message.id !== messageId,
          ),
          updatedAt: nextUpdatedAt(conversation.updatedAt),
        })),
      );
      if (removed?.uuid) {
        emitSyncMutation(
          deleteSyncMutation(CORE_SYNC_ENTITIES.message, removed.uuid),
        );
      }
    },

    deleteMessagesAfter: (conversationId, messageId) => {
      const before = owner.getConversationMessages(conversationId);
      const keepIndex = before.findIndex(message => message.id === messageId);
      const removed = keepIndex === -1 ? [] : before.slice(keepIndex + 1);
      owner.updateConversations(conversations =>
        mapConversation(conversations, conversationId, conversation => {
          const messageIndex = conversation.messages.findIndex(
            message => message.id === messageId,
          );
          if (messageIndex === -1) return conversation;
          return {
            ...conversation,
            messages: conversation.messages.slice(0, messageIndex + 1),
            updatedAt: nextUpdatedAt(conversation.updatedAt),
          };
        }),
      );
      for (const message of removed) {
        if (message.uuid) {
          emitSyncMutation(
            deleteSyncMutation(CORE_SYNC_ENTITIES.message, message.uuid),
          );
        }
      }
    },
  };
}
