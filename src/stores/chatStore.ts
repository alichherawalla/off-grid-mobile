import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message, Conversation, MediaAttachment, GenerationMeta } from '../types';
import { stripControlTokens } from '../utils/messageContent';

interface ChatState {
  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;

  // Current message being streamed
  streamingMessage: string;
  streamingForConversationId: string | null; // Which conversation is being generated for
  isStreaming: boolean;
  isThinking: boolean; // True when processing prompt, before first token

  // Actions
  createConversation: (modelId: string, title?: string, projectId?: string) => string;
  deleteConversation: (conversationId: string) => void;
  setActiveConversation: (conversationId: string | null) => void;
  getActiveConversation: () => Conversation | null;
  setConversationProject: (conversationId: string, projectId: string | null) => void;

  // Messages
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'timestamp'>, attachments?: MediaAttachment[], generationTimeMs?: number, generationMeta?: GenerationMeta) => Message;
  updateMessage: (conversationId: string, messageId: string, content: string, isThinking?: boolean) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  deleteMessagesAfter: (conversationId: string, messageId: string) => void;

  // Streaming
  startStreaming: (conversationId: string) => void;
  setStreamingMessage: (content: string) => void;
  appendToStreamingMessage: (token: string) => void;
  setIsStreaming: (streaming: boolean) => void;
  setIsThinking: (thinking: boolean) => void;
  finalizeStreamingMessage: (conversationId: string, generationTimeMs?: number, generationMeta?: GenerationMeta) => void;
  clearStreamingMessage: () => void;
  getStreamingState: () => { conversationId: string | null; content: string; isStreaming: boolean; isThinking: boolean };

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
      streamingForConversationId: null,
      isStreaming: false,
      isThinking: false,

      createConversation: (modelId, title, projectId) => {
        const id = generateId();
        const conversation: Conversation = {
          id,
          title: title || 'New Conversation',
          modelId,
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          projectId: projectId,
        };

        set((state) => ({
          conversations: [conversation, ...state.conversations],
          activeConversationId: id,
          // Don't clear streaming state - generation may be in progress for another conversation
          // The UI checks streamingForConversationId to scope streaming display to the correct chat
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
        // Don't clear streaming state - generation may be in progress for another conversation
        // The UI should check streamingForConversationId to know if streaming applies to current view
        set({ activeConversationId: conversationId });
      },

      getActiveConversation: () => {
        const state = get();
        return state.conversations.find((c) => c.id === state.activeConversationId) || null;
      },

      setConversationProject: (conversationId, projectId) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? { ...conv, projectId: projectId || undefined, updatedAt: new Date().toISOString() }
              : conv
          ),
        }));
      },

      addMessage: (conversationId, messageData, attachments, generationTimeMs, generationMeta) => {
        const message: Message = {
          id: generateId(),
          ...messageData,
          timestamp: Date.now(),
          attachments: attachments,
          generationTimeMs: generationTimeMs,
          generationMeta: generationMeta,
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

      updateMessage: (conversationId, messageId, content, isThinking) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === messageId
                      ? { ...msg, content, ...(isThinking !== undefined && { isThinking }) }
                      : msg
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

      startStreaming: (conversationId) => {
        set({
          streamingForConversationId: conversationId,
          streamingMessage: '',
          isStreaming: false,
          isThinking: true,
        });
      },

      setStreamingMessage: (content) => {
        set({ streamingMessage: content });
      },

      appendToStreamingMessage: (token) => {
        set((state) => ({
          streamingMessage: stripControlTokens(state.streamingMessage + token),
          isStreaming: true,
          isThinking: false,
        }));
      },

      setIsStreaming: (streaming) => {
        set({ isStreaming: streaming, isThinking: false });
      },

      setIsThinking: (thinking) => {
        set({ isThinking: thinking });
      },

      finalizeStreamingMessage: (conversationId, generationTimeMs, generationMeta) => {
        const { streamingMessage, streamingForConversationId, addMessage } = get();
        // Only finalize if this is the conversation we were generating for
        const sanitizedMessage = stripControlTokens(streamingMessage).trim();
        if (streamingForConversationId === conversationId && sanitizedMessage) {
          addMessage(conversationId, {
            role: 'assistant',
            content: sanitizedMessage,
          }, undefined, generationTimeMs, generationMeta);
        }
        set({
          streamingMessage: '',
          streamingForConversationId: null,
          isStreaming: false,
          isThinking: false,
        });
      },

      clearStreamingMessage: () => {
        set({
          streamingMessage: '',
          streamingForConversationId: null,
          isStreaming: false,
          isThinking: false,
        });
      },

      getStreamingState: () => {
        const state = get();
        return {
          conversationId: state.streamingForConversationId,
          content: state.streamingMessage,
          isStreaming: state.isStreaming,
          isThinking: state.isThinking,
        };
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
