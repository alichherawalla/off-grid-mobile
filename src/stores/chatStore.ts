import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message, Conversation, MediaAttachment } from '../types';

interface ChatState {
  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;

  // Current message being streamed
  streamingMessage: string;
  isStreaming: boolean;

  // Actions
  createConversation: (modelId: string, title?: string, personaId?: string) => string;
  deleteConversation: (conversationId: string) => void;
  setActiveConversation: (conversationId: string | null) => void;
  getActiveConversation: () => Conversation | null;
  setConversationPersona: (conversationId: string, personaId: string | null) => void;

  // Messages
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'timestamp'>, attachments?: MediaAttachment[]) => Message;
  updateMessage: (conversationId: string, messageId: string, content: string) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  deleteMessagesAfter: (conversationId: string, messageId: string) => void;

  // Streaming
  setStreamingMessage: (content: string) => void;
  appendToStreamingMessage: (token: string) => void;
  setIsStreaming: (streaming: boolean) => void;
  finalizeStreamingMessage: (conversationId: string) => void;
  clearStreamingMessage: () => void;

  // Utilities
  clearAllConversations: () => void;
  getConversationMessages: (conversationId: string) => Message[];
}

const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      streamingMessage: '',
      isStreaming: false,

      createConversation: (modelId, title, personaId) => {
        const id = generateId();
        const conversation: Conversation = {
          id,
          title: title || 'New Conversation',
          modelId,
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          personaId: personaId,
        };

        set((state) => ({
          conversations: [conversation, ...state.conversations],
          activeConversationId: id,
        }));

        return id;
      },

      deleteConversation: (conversationId) => {
        set((state) => ({
          conversations: state.conversations.filter((c) => c.id !== conversationId),
          activeConversationId:
            state.activeConversationId === conversationId
              ? null
              : state.activeConversationId,
        }));
      },

      setActiveConversation: (conversationId) => {
        set({ activeConversationId: conversationId });
      },

      getActiveConversation: () => {
        const state = get();
        return state.conversations.find((c) => c.id === state.activeConversationId) || null;
      },

      setConversationPersona: (conversationId, personaId) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? { ...conv, personaId: personaId || undefined, updatedAt: new Date().toISOString() }
              : conv
          ),
        }));
      },

      addMessage: (conversationId, messageData, attachments) => {
        const message: Message = {
          id: generateId(),
          ...messageData,
          timestamp: Date.now(),
          attachments: attachments,
        };

        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: [...conv.messages, message],
                  updatedAt: new Date().toISOString(),
                  // Update title from first user message if still default
                  title: conv.title === 'New Conversation' && messageData.role === 'user'
                    ? messageData.content.slice(0, 50) + (messageData.content.length > 50 ? '...' : '')
                    : conv.title,
                }
              : conv
          ),
        }));

        return message;
      },

      updateMessage: (conversationId, messageId, content) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === messageId ? { ...msg, content } : msg
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : conv
          ),
        }));
      },

      deleteMessage: (conversationId, messageId) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.filter((msg) => msg.id !== messageId),
                  updatedAt: new Date().toISOString(),
                }
              : conv
          ),
        }));
      },

      deleteMessagesAfter: (conversationId, messageId) => {
        set((state) => ({
          conversations: state.conversations.map((conv) => {
            if (conv.id !== conversationId) return conv;
            const messageIndex = conv.messages.findIndex((msg) => msg.id === messageId);
            if (messageIndex === -1) return conv;
            return {
              ...conv,
              messages: conv.messages.slice(0, messageIndex + 1),
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
      },

      setStreamingMessage: (content) => {
        set({ streamingMessage: content });
      },

      appendToStreamingMessage: (token) => {
        set((state) => ({
          streamingMessage: state.streamingMessage + token,
        }));
      },

      setIsStreaming: (streaming) => {
        set({ isStreaming: streaming });
      },

      finalizeStreamingMessage: (conversationId) => {
        const { streamingMessage, addMessage } = get();
        if (streamingMessage.trim()) {
          addMessage(conversationId, {
            role: 'assistant',
            content: streamingMessage.trim(),
          });
        }
        set({ streamingMessage: '', isStreaming: false });
      },

      clearStreamingMessage: () => {
        set({ streamingMessage: '', isStreaming: false });
      },

      clearAllConversations: () => {
        set({ conversations: [], activeConversationId: null });
      },

      getConversationMessages: (conversationId) => {
        const conversation = get().conversations.find((c) => c.id === conversationId);
        return conversation?.messages || [];
      },
    }),
    {
      name: 'local-llm-chat-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
      }),
    }
  )
);
