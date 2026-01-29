import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ChatMessage, ChatInput, Button, Card } from '../components';
import { COLORS, APP_CONFIG } from '../constants';
import { useAppStore, useChatStore, usePersonaStore } from '../stores';
import { llmService, modelManager } from '../services';
import { Message, MediaAttachment, Persona } from '../types';

export const ChatScreen: React.FC = () => {
  const flatListRef = useRef<FlatList>(null);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [supportsVision, setSupportsVision] = useState(false);
  const [showPersonaSelector, setShowPersonaSelector] = useState(false);
  const navigation = useNavigation();

  const { activeModelId, downloadedModels, settings } = useAppStore();
  const {
    activeConversationId,
    conversations,
    createConversation,
    addMessage,
    updateMessage,
    deleteMessagesAfter,
    streamingMessage,
    isStreaming,
    setIsStreaming,
    appendToStreamingMessage,
    finalizeStreamingMessage,
    clearStreamingMessage,
    deleteConversation,
    setActiveConversation,
    setConversationPersona,
  } = useChatStore();
  const { personas, getPersona } = usePersonaStore();

  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId
  );
  const activeModel = downloadedModels.find((m) => m.id === activeModelId);
  const activePersona = activeConversation?.personaId
    ? getPersona(activeConversation.personaId)
    : null;

  useEffect(() => {
    // Ensure model is loaded when entering chat
    if (activeModelId && activeModel) {
      ensureModelLoaded();
    }
  }, [activeModelId]);

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    if (activeConversation?.messages.length || streamingMessage) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [activeConversation?.messages.length, streamingMessage]);

  const ensureModelLoaded = async () => {
    if (!activeModel) return;

    const loadedPath = llmService.getLoadedModelPath();
    if (loadedPath === activeModel.filePath) {
      return; // Already loaded
    }

    setIsModelLoading(true);
    try {
      await llmService.loadModel(activeModel.filePath);
      // Check vision support after loading
      const multimodalSupport = llmService.getMultimodalSupport();
      setSupportsVision(multimodalSupport?.vision || false);
    } catch (error) {
      Alert.alert('Error', `Failed to load model: ${(error as Error).message}`);
    } finally {
      setIsModelLoading(false);
    }
  };

  const handleSend = async (text: string, attachments?: MediaAttachment[]) => {
    if (!activeConversationId || !activeModel) {
      Alert.alert('No Model Selected', 'Please select a model first.');
      return;
    }

    // Ensure model is loaded
    if (!llmService.isModelLoaded()) {
      await ensureModelLoaded();
      if (!llmService.isModelLoaded()) {
        Alert.alert('Error', 'Failed to load model. Please try again.');
        return;
      }
    }

    // Add user message with attachments
    const userMessage = addMessage(
      activeConversationId,
      {
        role: 'user',
        content: text,
      },
      attachments
    );

    // Prepare messages for context
    const conversationMessages = activeConversation?.messages || [];
    const systemPrompt = activePersona?.systemPrompt || settings.systemPrompt;
    const messagesForContext: Message[] = [
      {
        id: 'system',
        role: 'system',
        content: systemPrompt,
        timestamp: 0,
      },
      ...conversationMessages,
      userMessage,
    ];

    // Start streaming response
    setIsStreaming(true);

    try {
      await llmService.generateResponse(
        messagesForContext,
        (token) => {
          appendToStreamingMessage(token);
        },
        () => {
          finalizeStreamingMessage(activeConversationId);
        },
        (error) => {
          clearStreamingMessage();
          Alert.alert('Generation Error', error.message);
        }
      );
    } catch (error) {
      clearStreamingMessage();
    }
  };

  const handleStop = async () => {
    await llmService.stopGeneration();
    if (activeConversationId && streamingMessage.trim()) {
      finalizeStreamingMessage(activeConversationId);
    } else {
      clearStreamingMessage();
    }
  };

  const handleDeleteConversation = () => {
    if (!activeConversationId || !activeConversation) return;

    Alert.alert(
      'Delete Conversation',
      'Are you sure you want to delete this conversation?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteConversation(activeConversationId);
            setActiveConversation(null);
            navigation.goBack();
          },
        },
      ]
    );
  };

  const handleNewChat = () => {
    if (activeModelId) {
      createConversation(activeModelId, undefined, activePersona?.id);
    }
  };

  const handleCopyMessage = (content: string) => {
    // Copy is handled in ChatMessage component with Alert
  };

  const handleRetryMessage = async (message: Message) => {
    if (!activeConversationId || !activeModel) return;

    if (message.role === 'user') {
      // Delete all messages after this one and resend
      deleteMessagesAfter(activeConversationId, message.id);
      // Remove the user message too, then resend
      const content = message.content;
      const attachments = message.attachments;
      // Actually we want to keep the message and regenerate the response
      // So just delete the assistant responses after

      // Find the next message (should be assistant response)
      const messages = activeConversation?.messages || [];
      const messageIndex = messages.findIndex((m) => m.id === message.id);
      if (messageIndex !== -1 && messageIndex < messages.length - 1) {
        // Delete messages after this one
        deleteMessagesAfter(activeConversationId, message.id);
      }

      // Regenerate response
      await regenerateResponse(message);
    } else {
      // For assistant messages, find the previous user message and regenerate
      const messages = activeConversation?.messages || [];
      const messageIndex = messages.findIndex((m) => m.id === message.id);
      if (messageIndex > 0) {
        const previousUserMessage = messages.slice(0, messageIndex).reverse()
          .find((m) => m.role === 'user');
        if (previousUserMessage) {
          // Delete this assistant message and any after it
          const prevIndex = messages.findIndex((m) => m.id === previousUserMessage.id);
          deleteMessagesAfter(activeConversationId, previousUserMessage.id);
          await regenerateResponse(previousUserMessage);
        }
      }
    }
  };

  const regenerateResponse = async (userMessage: Message) => {
    if (!activeConversationId || !activeModel || !llmService.isModelLoaded()) return;

    const messages = activeConversation?.messages || [];
    const messageIndex = messages.findIndex((m) => m.id === userMessage.id);
    const messagesUpToUser = messages.slice(0, messageIndex + 1);

    const systemPrompt = activePersona?.systemPrompt || settings.systemPrompt;
    const messagesForContext: Message[] = [
      {
        id: 'system',
        role: 'system',
        content: systemPrompt,
        timestamp: 0,
      },
      ...messagesUpToUser,
    ];

    setIsStreaming(true);

    try {
      await llmService.generateResponse(
        messagesForContext,
        (token) => {
          appendToStreamingMessage(token);
        },
        () => {
          finalizeStreamingMessage(activeConversationId);
        },
        (error) => {
          clearStreamingMessage();
          Alert.alert('Generation Error', error.message);
        }
      );
    } catch (error) {
      clearStreamingMessage();
    }
  };

  const handleEditMessage = async (message: Message, newContent: string) => {
    if (!activeConversationId || !activeModel) return;

    // Update the message content
    updateMessage(activeConversationId, message.id, newContent);

    // Delete all messages after this one
    deleteMessagesAfter(activeConversationId, message.id);

    // Create updated message object for regeneration
    const updatedMessage: Message = { ...message, content: newContent };

    // Regenerate response with new content
    await regenerateResponse(updatedMessage);
  };

  const handleSelectPersona = (persona: Persona | null) => {
    if (activeConversationId) {
      setConversationPersona(activeConversationId, persona?.id || null);
    }
    setShowPersonaSelector(false);
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <ChatMessage
      message={item}
      isStreaming={item.id === 'streaming'}
      onCopy={handleCopyMessage}
      onRetry={handleRetryMessage}
      onEdit={handleEditMessage}
    />
  );

  // Create streaming message object for display
  const allMessages = activeConversation?.messages || [];
  const displayMessages = streamingMessage
    ? [
        ...allMessages,
        {
          id: 'streaming',
          role: 'assistant' as const,
          content: streamingMessage,
          timestamp: Date.now(),
          isStreaming: true,
        },
      ]
    : allMessages;

  if (!activeModelId || !activeModel) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.noModelContainer}>
          <Text style={styles.noModelIcon}>🤖</Text>
          <Text style={styles.noModelTitle}>No Model Selected</Text>
          <Text style={styles.noModelText}>
            Select a model from the Home screen to start chatting.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isModelLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading model...</Text>
          <Text style={styles.loadingSubtext}>
            This may take a moment for larger models.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Header */}
        <View style={styles.header}>
          {/* Top row: Title and actions */}
          <View style={styles.headerTopRow}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {activeConversation?.title || 'New Chat'}
            </Text>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.headerButton}
                onPress={handleNewChat}
              >
                <Text style={styles.headerButtonText}>+ New</Text>
              </TouchableOpacity>
              {activeConversation && (
                <TouchableOpacity
                  style={styles.deleteIconButton}
                  onPress={handleDeleteConversation}
                >
                  <Text style={styles.deleteIconText}>🗑</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Bottom row: Model and Persona */}
          <View style={styles.headerBottomRow}>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {activeModel.name}
            </Text>
            <TouchableOpacity
              style={styles.personaSelector}
              onPress={() => setShowPersonaSelector(true)}
            >
              <Text style={styles.personaSelectorIcon}>
                {activePersona?.icon || '🤖'}
              </Text>
              <Text style={styles.personaSelectorText} numberOfLines={1}>
                {activePersona?.name || 'Default'}
              </Text>
              <Text style={styles.personaSelectorArrow}>▼</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Messages */}
        {displayMessages.length === 0 ? (
          <View style={styles.emptyChat}>
            <Text style={styles.emptyChatIcon}>💬</Text>
            <Text style={styles.emptyChatTitle}>Start a Conversation</Text>
            <Text style={styles.emptyChatText}>
              Type a message below to begin chatting with {activeModel.name}.
            </Text>
            <TouchableOpacity
              style={styles.personaHint}
              onPress={() => setShowPersonaSelector(true)}
            >
              <Text style={styles.personaHintIcon}>{activePersona?.icon || '🤖'}</Text>
              <Text style={styles.personaHintText}>
                Persona: {activePersona?.name || 'Default'} — tap to change
              </Text>
            </TouchableOpacity>
            <Card style={styles.privacyReminder}>
              <Text style={styles.privacyText}>
                🔒 This conversation is completely private. All processing
                happens on your device.
              </Text>
            </Card>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={displayMessages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={() =>
              flatListRef.current?.scrollToEnd({ animated: true })
            }
          />
        )}

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          onStop={handleStop}
          disabled={!llmService.isModelLoaded()}
          isGenerating={isStreaming}
          supportsVision={supportsVision}
          placeholder={
            llmService.isModelLoaded()
              ? supportsVision
                ? 'Type a message or add an image...'
                : 'Type a message...'
              : 'Loading model...'
          }
        />
      </KeyboardAvoidingView>

      {/* Persona Selector Modal */}
      <Modal
        visible={showPersonaSelector}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPersonaSelector(false)}
      >
        <View style={styles.personaModalOverlay}>
          <View style={styles.personaModal}>
            <View style={styles.personaModalHeader}>
              <Text style={styles.personaModalTitle}>Select Persona</Text>
              <TouchableOpacity onPress={() => setShowPersonaSelector(false)}>
                <Text style={styles.personaModalClose}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.personaList}>
              {/* Default option */}
              <TouchableOpacity
                style={[
                  styles.personaOption,
                  !activePersona && styles.personaOptionSelected,
                ]}
                onPress={() => handleSelectPersona(null)}
              >
                <Text style={styles.personaOptionIcon}>🤖</Text>
                <View style={styles.personaOptionInfo}>
                  <Text style={styles.personaOptionName}>Default</Text>
                  <Text style={styles.personaOptionDesc} numberOfLines={1}>
                    Use default system prompt from settings
                  </Text>
                </View>
                {!activePersona && (
                  <Text style={styles.personaCheckmark}>✓</Text>
                )}
              </TouchableOpacity>

              {personas.map((persona) => (
                <TouchableOpacity
                  key={persona.id}
                  style={[
                    styles.personaOption,
                    activePersona?.id === persona.id && styles.personaOptionSelected,
                  ]}
                  onPress={() => handleSelectPersona(persona)}
                >
                  <Text style={styles.personaOptionIcon}>{persona.icon || '🤖'}</Text>
                  <View style={styles.personaOptionInfo}>
                    <Text style={styles.personaOptionName}>{persona.name}</Text>
                    <Text style={styles.personaOptionDesc} numberOfLines={1}>
                      {persona.description}
                    </Text>
                  </View>
                  {activePersona?.id === persona.id && (
                    <Text style={styles.personaCheckmark}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  headerBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
    marginRight: 12,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
  },
  headerButtonText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  deleteIconButton: {
    padding: 6,
  },
  deleteIconText: {
    fontSize: 16,
  },
  personaSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  personaSelectorIcon: {
    fontSize: 14,
  },
  personaSelectorText: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '500',
    maxWidth: 80,
  },
  personaSelectorArrow: {
    fontSize: 8,
    color: COLORS.textMuted,
    marginLeft: 2,
  },
  messageList: {
    paddingVertical: 16,
  },
  emptyChat: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyChatIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyChatTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptyChatText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  personaHint: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginBottom: 16,
    gap: 8,
  },
  personaHintIcon: {
    fontSize: 18,
  },
  personaHintText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '500',
  },
  privacyReminder: {
    backgroundColor: COLORS.secondary + '15',
    borderWidth: 1,
    borderColor: COLORS.secondary + '40',
    maxWidth: 300,
  },
  privacyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  loadingSubtext: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  noModelContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  noModelIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  noModelTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  noModelText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  personaModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  personaModal: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  personaModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  personaModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  personaModalClose: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '500',
  },
  personaList: {
    padding: 16,
  },
  personaOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: COLORS.surface,
  },
  personaOptionSelected: {
    backgroundColor: COLORS.primary + '20',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  personaOptionIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  personaOptionInfo: {
    flex: 1,
  },
  personaOptionName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  personaOptionDesc: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  personaCheckmark: {
    fontSize: 18,
    color: COLORS.primary,
    fontWeight: '600',
    marginLeft: 8,
  },
});
