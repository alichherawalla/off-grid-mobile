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
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import {
  ChatMessage,
  ChatInput,
  Button,
  Card,
  ModelSelectorModal,
  GenerationSettingsModal,
} from '../components';
import { COLORS, APP_CONFIG } from '../constants';
import { useAppStore, useChatStore, useProjectStore } from '../stores';
import { llmService, modelManager } from '../services';
import { Message, MediaAttachment, Project, DownloadedModel } from '../types';
import { ChatsStackParamList } from '../navigation/types';

type ChatScreenRouteProp = RouteProp<ChatsStackParamList, 'Chat'>;

interface DebugInfo {
  systemPrompt: string;
  originalMessageCount: number;
  managedMessageCount: number;
  truncatedCount: number;
  formattedPrompt: string;
  estimatedTokens: number;
  maxContextLength: number;
  contextUsagePercent: number;
}

export const ChatScreen: React.FC = () => {
  const flatListRef = useRef<FlatList>(null);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [supportsVision, setSupportsVision] = useState(false);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  // Track which conversation a generation was started for
  const generatingForConversationRef = useRef<string | null>(null);
  const navigation = useNavigation();
  const route = useRoute<ChatScreenRouteProp>();

  const { activeModelId, downloadedModels, settings, setActiveModelId } = useAppStore();
  const {
    activeConversationId,
    conversations,
    createConversation,
    addMessage,
    updateMessage,
    deleteMessagesAfter,
    streamingMessage,
    isStreaming,
    isThinking,
    setIsStreaming,
    setIsThinking,
    appendToStreamingMessage,
    finalizeStreamingMessage,
    clearStreamingMessage,
    deleteConversation,
    setActiveConversation,
    setConversationProject,
  } = useChatStore();
  const { projects, getProject } = useProjectStore();

  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId
  );
  const activeModel = downloadedModels.find((m) => m.id === activeModelId);
  const activeProject = activeConversation?.personaId
    ? getProject(activeConversation.personaId)
    : null;

  // Handle route params - set active conversation or create new one
  useEffect(() => {
    const { conversationId, projectId } = route.params || {};

    if (conversationId) {
      // Navigate to existing conversation
      setActiveConversation(conversationId);
    } else if (activeModelId) {
      // No conversation specified - create a new one
      // This handles the "New Chat" button from ChatsListScreen
      createConversation(activeModelId, undefined, projectId);
    }
  }, [route.params?.conversationId, route.params?.projectId]);

  // Clear generation ref when conversation changes (user switched chats)
  useEffect(() => {
    // If we switched to a different conversation than what's generating,
    // invalidate the generation so tokens don't leak
    if (generatingForConversationRef.current &&
        generatingForConversationRef.current !== activeConversationId) {
      generatingForConversationRef.current = null;
    }
  }, [activeConversationId]);

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
    const currentVisionSupport = llmService.getMultimodalSupport()?.vision || false;

    // Check if we need to reload: different model OR vision model loaded without mmproj
    const needsReload = loadedPath !== activeModel.filePath ||
      (activeModel.mmProjPath && !currentVisionSupport);

    if (!needsReload && loadedPath === activeModel.filePath) {
      // Already loaded correctly
      setSupportsVision(currentVisionSupport);
      return;
    }

    setIsModelLoading(true);
    try {
      if (!activeModel.filePath) {
        throw new Error('Model filePath is undefined');
      }

      // Force unload if reloading for mmproj
      if (loadedPath === activeModel.filePath && activeModel.mmProjPath) {
        await llmService.unloadModel();
      }

      await llmService.loadModel(activeModel.filePath, activeModel.mmProjPath);
      const multimodalSupport = llmService.getMultimodalSupport();
      setSupportsVision(multimodalSupport?.vision || false);
    } catch (error: any) {
      Alert.alert('Error', `Failed to load model: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsModelLoading(false);
    }
  };

  const handleModelSelect = async (model: DownloadedModel) => {
    // If already loaded, just close
    if (llmService.getLoadedModelPath() === model.filePath) {
      setShowModelSelector(false);
      return;
    }

    setIsModelLoading(true);
    try {
      await llmService.loadModel(model.filePath, model.mmProjPath);
      setActiveModelId(model.id);
      // Check vision support after loading
      const multimodalSupport = llmService.getMultimodalSupport();
      setSupportsVision(multimodalSupport?.vision || false);

      // Create a new conversation if none exists
      if (!activeConversationId) {
        createConversation(model.id);
      }
    } catch (error) {
      Alert.alert('Error', `Failed to load model: ${(error as Error).message}`);
    } finally {
      setIsModelLoading(false);
      setShowModelSelector(false);
    }
  };

  const handleUnloadModel = async () => {
    // Stop any ongoing generation first
    if (isStreaming) {
      await llmService.stopGeneration();
      clearStreamingMessage();
    }

    setIsModelLoading(true);
    try {
      await llmService.unloadModel();
      setSupportsVision(false);
    } catch (error) {
      Alert.alert('Error', `Failed to unload model: ${(error as Error).message}`);
    } finally {
      setIsModelLoading(false);
      setShowModelSelector(false);
    }
  };

  const handleSend = async (text: string, attachments?: MediaAttachment[]) => {
    if (!activeConversationId || !activeModel) {
      Alert.alert('No Model Selected', 'Please select a model first.');
      return;
    }

    // Capture the conversation ID at the start - this won't change even if user switches chats
    const targetConversationId = activeConversationId;
    generatingForConversationRef.current = targetConversationId;

    // Ensure model is loaded
    if (!llmService.isModelLoaded()) {
      await ensureModelLoaded();
      if (!llmService.isModelLoaded()) {
        Alert.alert('Error', 'Failed to load model. Please try again.');
        generatingForConversationRef.current = null;
        return;
      }
    }

    // Add user message with attachments
    const userMessage = addMessage(
      targetConversationId,
      {
        role: 'user',
        content: text,
      },
      attachments
    );

    // Prepare messages for context
    const conversationMessages = activeConversation?.messages || [];

    // Use project system prompt if available, otherwise use default
    const systemPrompt = activeProject?.systemPrompt
      || settings.systemPrompt
      || APP_CONFIG.defaultSystemPrompt;

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

    // Update debug info
    try {
      const contextDebug = await llmService.getContextDebugInfo(messagesForContext);
      setDebugInfo({
        systemPrompt,
        ...contextDebug,
      });
    } catch (e) {
      console.log('Debug info error:', e);
    }

    // Start thinking state (before first token)
    setIsThinking(true);

    // Track first token locally to avoid stale closure issues with React state
    let firstTokenReceived = false;

    try {
      await llmService.generateResponse(
        messagesForContext,
        (token) => {
          // Only append if we're still generating for the same conversation
          if (generatingForConversationRef.current !== targetConversationId) {
            return; // User switched chats, ignore tokens
          }
          // First token received - switch from thinking to streaming
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            setIsThinking(false);
            setIsStreaming(true);
          }
          appendToStreamingMessage(token);
        },
        () => {
          // Use the captured conversation ID, not the current active one
          if (generatingForConversationRef.current === targetConversationId) {
            finalizeStreamingMessage(targetConversationId);
          }
          generatingForConversationRef.current = null;
        },
        (error) => {
          if (generatingForConversationRef.current === targetConversationId) {
            clearStreamingMessage();
            Alert.alert('Generation Error', error.message);
          }
          generatingForConversationRef.current = null;
        },
        () => {
          // onThinking - prompt is being processed
          if (generatingForConversationRef.current === targetConversationId) {
            setIsThinking(true);
          }
        }
      );
    } catch (error) {
      if (generatingForConversationRef.current === targetConversationId) {
        clearStreamingMessage();
      }
      generatingForConversationRef.current = null;
    }
  };

  const handleStop = async () => {
    const targetConversationId = generatingForConversationRef.current;
    generatingForConversationRef.current = null;
    await llmService.stopGeneration();
    if (targetConversationId && streamingMessage.trim()) {
      finalizeStreamingMessage(targetConversationId);
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
          onPress: async () => {
            // Stop any ongoing generation first
            if (isStreaming) {
              await llmService.stopGeneration();
              clearStreamingMessage();
            }
            deleteConversation(activeConversationId);
            setActiveConversation(null);
            navigation.goBack();
          },
        },
      ]
    );
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

    // Capture the conversation ID at the start
    const targetConversationId = activeConversationId;
    generatingForConversationRef.current = targetConversationId;

    const messages = activeConversation?.messages || [];
    const messageIndex = messages.findIndex((m) => m.id === userMessage.id);
    const messagesUpToUser = messages.slice(0, messageIndex + 1);

    // Use project system prompt if available, otherwise use default
    const systemPrompt = activeProject?.systemPrompt
      || settings.systemPrompt
      || APP_CONFIG.defaultSystemPrompt;

    const messagesForContext: Message[] = [
      {
        id: 'system',
        role: 'system',
        content: systemPrompt,
        timestamp: 0,
      },
      ...messagesUpToUser,
    ];

    setIsThinking(true);

    // Track first token locally to avoid stale closure issues
    let firstTokenReceived = false;

    try {
      await llmService.generateResponse(
        messagesForContext,
        (token) => {
          if (generatingForConversationRef.current !== targetConversationId) {
            return;
          }
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            setIsThinking(false);
            setIsStreaming(true);
          }
          appendToStreamingMessage(token);
        },
        () => {
          if (generatingForConversationRef.current === targetConversationId) {
            finalizeStreamingMessage(targetConversationId);
          }
          generatingForConversationRef.current = null;
        },
        (error) => {
          if (generatingForConversationRef.current === targetConversationId) {
            clearStreamingMessage();
            Alert.alert('Generation Error', error.message);
          }
          generatingForConversationRef.current = null;
        },
        () => {
          if (generatingForConversationRef.current === targetConversationId) {
            setIsThinking(true);
          }
        }
      );
    } catch (error) {
      if (generatingForConversationRef.current === targetConversationId) {
        clearStreamingMessage();
      }
      generatingForConversationRef.current = null;
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

  const handleSelectProject = (project: Project | null) => {
    if (activeConversationId) {
      setConversationProject(activeConversationId, project?.id || null);
    }
    setShowProjectSelector(false);
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

  // Create streaming/thinking message object for display
  const allMessages = activeConversation?.messages || [];
  const displayMessages = isThinking
    ? [
        ...allMessages,
        {
          id: 'thinking',
          role: 'assistant' as const,
          content: '',
          timestamp: Date.now(),
          isThinking: true,
        },
      ]
    : streamingMessage
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
          <View style={styles.noModelIconContainer}>
            <Text style={styles.noModelIconText}>AI</Text>
          </View>
          <Text style={styles.noModelTitle}>No Model Selected</Text>
          <Text style={styles.noModelText}>
            {downloadedModels.length > 0
              ? 'Select a model to start chatting.'
              : 'Download a model from the Models tab to start chatting.'}
          </Text>
          {downloadedModels.length > 0 && (
            <TouchableOpacity
              style={styles.selectModelButton}
              onPress={() => setShowModelSelector(true)}
            >
              <Text style={styles.selectModelButtonText}>Select Model</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Model Selector Modal - available even when no model selected */}
        <ModelSelectorModal
          visible={showModelSelector}
          onClose={() => setShowModelSelector(false)}
          onSelectModel={handleModelSelect}
          onUnloadModel={handleUnloadModel}
          isLoading={isModelLoading}
          currentModelPath={llmService.getLoadedModelPath()}
        />
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
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {activeConversation?.title || 'New Chat'}
              </Text>
              <TouchableOpacity
                style={styles.modelSelector}
                onPress={() => setShowModelSelector(true)}
              >
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {activeModel.name}
                </Text>
                <Text style={styles.modelSelectorArrow}>▼</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => setShowSettingsPanel(true)}
              >
                <Text style={styles.iconButtonText}>⚙</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.projectButton}
                onPress={() => setShowProjectSelector(true)}
              >
                <Text style={styles.projectButtonText}>
                  {activeProject?.name?.charAt(0).toUpperCase() || 'D'}
                </Text>
              </TouchableOpacity>
              {activeConversation && (
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={handleDeleteConversation}
                >
                  <Text style={styles.iconButtonText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Messages */}
        {displayMessages.length === 0 ? (
          <View style={styles.emptyChat}>
            <View style={styles.emptyChatIconContainer}>
              <Text style={styles.emptyChatIconText}>Chat</Text>
            </View>
            <Text style={styles.emptyChatTitle}>Start a Conversation</Text>
            <Text style={styles.emptyChatText}>
              Type a message below to begin chatting with {activeModel.name}.
            </Text>
            <TouchableOpacity
              style={styles.projectHint}
              onPress={() => setShowProjectSelector(true)}
            >
              <View style={styles.projectHintIcon}>
                <Text style={styles.projectHintIconText}>
                  {activeProject?.name?.charAt(0).toUpperCase() || 'D'}
                </Text>
              </View>
              <Text style={styles.projectHintText}>
                Project: {activeProject?.name || 'Default'} — tap to change
              </Text>
            </TouchableOpacity>
            <Card style={styles.privacyReminder}>
              <Text style={styles.privacyText}>
                This conversation is completely private. All processing
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
          conversationId={activeConversationId}
          placeholder={
            llmService.isModelLoaded()
              ? supportsVision
                ? 'Type a message or add an image...'
                : 'Type a message...'
              : 'Loading model...'
          }
        />
      </KeyboardAvoidingView>

      {/* Project Selector Modal */}
      <Modal
        visible={showProjectSelector}
        transparent
        animationType="slide"
        onRequestClose={() => setShowProjectSelector(false)}
      >
        <View style={styles.projectModalOverlay}>
          <View style={styles.projectModal}>
            <View style={styles.projectModalHeader}>
              <Text style={styles.projectModalTitle}>Select Project</Text>
              <TouchableOpacity onPress={() => setShowProjectSelector(false)}>
                <Text style={styles.projectModalClose}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.projectList}>
              {/* Default option */}
              <TouchableOpacity
                style={[
                  styles.projectOption,
                  !activeProject && styles.projectOptionSelected,
                ]}
                onPress={() => handleSelectProject(null)}
              >
                <View style={styles.projectOptionIcon}>
                  <Text style={styles.projectOptionIconText}>D</Text>
                </View>
                <View style={styles.projectOptionInfo}>
                  <Text style={styles.projectOptionName}>Default</Text>
                  <Text style={styles.projectOptionDesc} numberOfLines={1}>
                    Use default system prompt from settings
                  </Text>
                </View>
                {!activeProject && (
                  <Text style={styles.projectCheckmark}>✓</Text>
                )}
              </TouchableOpacity>

              {projects.map((project) => (
                <TouchableOpacity
                  key={project.id}
                  style={[
                    styles.projectOption,
                    activeProject?.id === project.id && styles.projectOptionSelected,
                  ]}
                  onPress={() => handleSelectProject(project)}
                >
                  <View style={styles.projectOptionIcon}>
                    <Text style={styles.projectOptionIconText}>
                      {project.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.projectOptionInfo}>
                    <Text style={styles.projectOptionName}>{project.name}</Text>
                    <Text style={styles.projectOptionDesc} numberOfLines={1}>
                      {project.description}
                    </Text>
                  </View>
                  {activeProject?.id === project.id && (
                    <Text style={styles.projectCheckmark}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Debug Panel Modal */}
      <Modal
        visible={showDebugPanel}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDebugPanel(false)}
      >
        <View style={styles.debugModalOverlay}>
          <View style={styles.debugModal}>
            <View style={styles.debugModalHeader}>
              <Text style={styles.debugModalTitle}>Debug Info</Text>
              <TouchableOpacity onPress={() => setShowDebugPanel(false)}>
                <Text style={styles.debugModalClose}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.debugContent}>
              {/* Context Stats */}
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>Context Stats</Text>
                <View style={styles.debugStats}>
                  <View style={styles.debugStat}>
                    <Text style={styles.debugStatValue}>
                      {debugInfo?.estimatedTokens || 0}
                    </Text>
                    <Text style={styles.debugStatLabel}>Tokens Used</Text>
                  </View>
                  <View style={styles.debugStat}>
                    <Text style={styles.debugStatValue}>
                      {debugInfo?.maxContextLength || APP_CONFIG.maxContextLength}
                    </Text>
                    <Text style={styles.debugStatLabel}>Max Context</Text>
                  </View>
                  <View style={styles.debugStat}>
                    <Text style={styles.debugStatValue}>
                      {(debugInfo?.contextUsagePercent || 0).toFixed(1)}%
                    </Text>
                    <Text style={styles.debugStatLabel}>Usage</Text>
                  </View>
                </View>
                <View style={styles.contextBar}>
                  <View
                    style={[
                      styles.contextBarFill,
                      { width: `${Math.min(debugInfo?.contextUsagePercent || 0, 100)}%` }
                    ]}
                  />
                </View>
              </View>

              {/* Message Stats */}
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>Message Stats</Text>
                <View style={styles.debugRow}>
                  <Text style={styles.debugLabel}>Original Messages:</Text>
                  <Text style={styles.debugValue}>{debugInfo?.originalMessageCount || 0}</Text>
                </View>
                <View style={styles.debugRow}>
                  <Text style={styles.debugLabel}>After Context Mgmt:</Text>
                  <Text style={styles.debugValue}>{debugInfo?.managedMessageCount || 0}</Text>
                </View>
                <View style={styles.debugRow}>
                  <Text style={styles.debugLabel}>Truncated:</Text>
                  <Text style={[styles.debugValue, debugInfo?.truncatedCount ? styles.debugWarning : null]}>
                    {debugInfo?.truncatedCount || 0}
                  </Text>
                </View>
              </View>

              {/* Active Project */}
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>Active Project</Text>
                <View style={styles.debugRow}>
                  <Text style={styles.debugLabel}>Name:</Text>
                  <Text style={styles.debugValue}>{activeProject?.name || 'Default'}</Text>
                </View>
              </View>

              {/* System Prompt */}
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>System Prompt</Text>
                <View style={styles.debugCodeBlock}>
                  <Text style={styles.debugCode} selectable>
                    {debugInfo?.systemPrompt || settings.systemPrompt || APP_CONFIG.defaultSystemPrompt}
                  </Text>
                </View>
              </View>

              {/* Formatted Prompt (Last Sent) */}
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>Last Formatted Prompt</Text>
                <Text style={styles.debugHint}>
                  This is the exact prompt sent to the LLM (ChatML format)
                </Text>
                <View style={styles.debugCodeBlock}>
                  <Text style={styles.debugCode} selectable>
                    {debugInfo?.formattedPrompt || 'Send a message to see the formatted prompt'}
                  </Text>
                </View>
              </View>

              {/* Current Conversation Messages */}
              <View style={styles.debugSection}>
                <Text style={styles.debugSectionTitle}>
                  Conversation Messages ({activeConversation?.messages.length || 0})
                </Text>
                {(activeConversation?.messages || []).map((msg, index) => (
                  <View key={msg.id} style={styles.debugMessage}>
                    <View style={styles.debugMessageHeader}>
                      <Text style={[
                        styles.debugMessageRole,
                        msg.role === 'user' ? styles.debugRoleUser : styles.debugRoleAssistant
                      ]}>
                        {msg.role.toUpperCase()}
                      </Text>
                      <Text style={styles.debugMessageIndex}>#{index + 1}</Text>
                    </View>
                    <Text style={styles.debugMessageContent} numberOfLines={3}>
                      {msg.content}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Model Selector Modal */}
      <ModelSelectorModal
        visible={showModelSelector}
        onClose={() => setShowModelSelector(false)}
        onSelectModel={handleModelSelect}
        onUnloadModel={handleUnloadModel}
        isLoading={isModelLoading}
        currentModelPath={llmService.getLoadedModelPath()}
      />

      {/* Generation Settings Modal */}
      <GenerationSettingsModal
        visible={showSettingsPanel}
        onClose={() => setShowSettingsPanel(false)}
      />
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flex: 1,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  modelSelector: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modelSelectorArrow: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginLeft: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonText: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  projectButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
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
  emptyChatIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyChatIconText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
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
  projectHint: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginBottom: 16,
    gap: 8,
  },
  projectHintIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectHintIconText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  projectHintText: {
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
  noModelIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: COLORS.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  noModelIconText: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textMuted,
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
  selectModelButton: {
    marginTop: 24,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  selectModelButtonText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  projectModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  projectModal: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  projectModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  projectModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  projectModalClose: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '500',
  },
  projectList: {
    padding: 16,
  },
  projectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: COLORS.surface,
  },
  projectOptionSelected: {
    backgroundColor: COLORS.primary + '20',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  projectOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  projectOptionIconText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
  projectOptionInfo: {
    flex: 1,
  },
  projectOptionName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  projectOptionDesc: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  projectCheckmark: {
    fontSize: 18,
    color: COLORS.primary,
    fontWeight: '600',
    marginLeft: 8,
  },
  debugModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  debugModal: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  debugModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  debugModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  debugModalClose: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '500',
  },
  debugContent: {
    padding: 16,
  },
  debugSection: {
    marginBottom: 20,
  },
  debugSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  debugStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  debugStat: {
    alignItems: 'center',
  },
  debugStatValue: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  debugStatLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  contextBar: {
    height: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 4,
    overflow: 'hidden',
  },
  contextBarFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
  },
  debugRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surface,
  },
  debugLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  debugValue: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '500',
  },
  debugWarning: {
    color: COLORS.warning,
  },
  debugCodeBlock: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  debugCode: {
    fontSize: 11,
    color: COLORS.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  debugHint: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  debugMessage: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  debugMessageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  debugMessageRole: {
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  debugRoleUser: {
    backgroundColor: COLORS.primary + '30',
    color: COLORS.primary,
  },
  debugRoleAssistant: {
    backgroundColor: COLORS.secondary + '30',
    color: COLORS.secondary,
  },
  debugMessageIndex: {
    fontSize: 10,
    color: COLORS.textMuted,
  },
  debugMessageContent: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
});
