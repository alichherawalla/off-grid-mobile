import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Image,
  Dimensions,
  PermissionsAndroid,
  InteractionManager,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import RNFS from 'react-native-fs';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import Animated, { FadeIn } from 'react-native-reanimated';
import {
  ChatMessage,
  ChatInput,
  Button,
  Card,
  ModelSelectorModal,
  GenerationSettingsModal,
  CustomAlert,
  AlertState,
  initialAlertState,
  showAlert,
  hideAlert,
  ProjectSelectorSheet,
  DebugSheet,
} from '../components';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { APP_CONFIG, SPACING, TYPOGRAPHY } from '../constants';
import { useAppStore, useChatStore, useProjectStore } from '../stores';
import { llmService, modelManager, intentClassifier, activeModelService, generationService, imageGenerationService, ImageGenerationState, onnxImageGeneratorService, hardwareService } from '../services';
import { Message, MediaAttachment, Project, DownloadedModel, ImageModeState, GenerationMeta, DebugInfo } from '../types';
import { ChatsStackParamList } from '../navigation/types';

type ChatScreenRouteProp = RouteProp<ChatsStackParamList, 'Chat'>;

export const ChatScreen: React.FC = () => {
  const flatListRef = useRef<FlatList>(null);
  const isNearBottomRef = useRef(true);
  const contentHeightRef = useRef(0);
  const scrollViewHeightRef = useRef(0);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [loadingModel, setLoadingModel] = useState<DownloadedModel | null>(null);
  const [supportsVision, setSupportsVision] = useState(false);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  // Message entry animation gating — only animate newly arriving messages
  const lastMessageCountRef = useRef(0);
  const [animateLastN, setAnimateLastN] = useState(0);
  // Track which conversation a generation was started for
  const generatingForConversationRef = useRef<string | null>(null);
  // Track when generation started for timing
  const generationStartTimeRef = useRef<number | null>(null);
  // Track model load start time for system messages
  const modelLoadStartTimeRef = useRef<number | null>(null);
  const navigation = useNavigation();
  const route = useRoute<ChatScreenRouteProp>();

  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const {
    activeModelId,
    downloadedModels,
    settings,
    setActiveModelId,
    activeImageModelId,
    downloadedImageModels,
    setDownloadedImageModels,
    setIsGeneratingImage: setAppIsGeneratingImage,
    setImageGenerationStatus: setAppImageGenerationStatus,
    removeImagesByConversationId,
  } = useAppStore();

  // Subscribe to image generation service (lifecycle-independent)
  const [imageGenState, setImageGenState] = useState<ImageGenerationState>(
    imageGenerationService.getState()
  );

  useEffect(() => {
    const unsubscribe = imageGenerationService.subscribe((state) => {
      setImageGenState(state);
    });
    return unsubscribe;
  }, []);

  // Derived state from service for convenience
  const isGeneratingImage = imageGenState.isGenerating;
  const imageGenerationProgress = imageGenState.progress;
  const imageGenerationStatus = imageGenState.status;
  const imagePreviewPath = imageGenState.previewPath;
  const {
    activeConversationId,
    conversations,
    createConversation,
    addMessage,
    updateMessage,
    deleteMessagesAfter,
    streamingMessage,
    streamingForConversationId,
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
  const activeProject = activeConversation?.projectId
    ? getProject(activeConversation.projectId)
    : null;
  const activeImageModel = downloadedImageModels.find((m) => m.id === activeImageModelId);
  const imageModelLoaded = !!activeImageModel;

  // Track image mode state
  const [currentImageMode, setCurrentImageMode] = useState<ImageModeState>('auto');

  // Fullscreen image viewer state
  const [viewerImageUri, setViewerImageUri] = useState<string | null>(null);

  // Count images in this conversation for the gallery button
  const conversationImageCount = React.useMemo(() => {
    const messages = activeConversation?.messages || [];
    let count = 0;
    for (const msg of messages) {
      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (att.type === 'image') count++;
        }
      }
    }
    return count;
  }, [activeConversation?.messages]);

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

  // Clear generation ref and KV cache when conversation changes (user switched chats)
  useEffect(() => {
    // If we switched to a different conversation than what's generating,
    // invalidate the generation so tokens don't leak
    if (generatingForConversationRef.current &&
        generatingForConversationRef.current !== activeConversationId) {
      generatingForConversationRef.current = null;
    }

    // Defer KV cache clear until after animations complete to prevent UI lag
    // This helps prevent the slowdown after many messages issue
    const task = InteractionManager.runAfterInteractions(() => {
      if (llmService.isModelLoaded()) {
        llmService.clearKVCache(false).catch(() => {
          // Ignore errors - cache clear is best effort
        });
      }
    });

    return () => task.cancel();
  }, [activeConversationId]);

  useEffect(() => {
    // Ensure model is loaded when entering chat
    if (activeModelId && activeModel) {
      ensureModelLoaded();
    }
  }, [activeModelId]);

  // Check vision support when activeModel changes (based on mmProjPath metadata)
  // Models with mmProjPath are vision models - verify runtime support after load
  useEffect(() => {
    if (activeModel?.mmProjPath && llmService.isModelLoaded()) {
      const multimodalSupport = llmService.getMultimodalSupport();
      if (multimodalSupport?.vision) {
        setSupportsVision(true);
      }
    } else if (!activeModel?.mmProjPath) {
      // Model doesn't have vision projector - no vision support
      setSupportsVision(false);
    }
  }, [activeModel?.mmProjPath]);

  // Load image models on mount - defer to avoid blocking navigation
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(async () => {
      const models = await modelManager.getDownloadedImageModels();
      setDownloadedImageModels(models);
    });
    return () => task.cancel();
  }, []);

  // Preload classifier model when LLM classification is enabled with a specific model
  useEffect(() => {
    const preloadClassifierModel = async () => {
      // Only preload if:
      // 1. Auto mode with LLM detection
      // 2. A specific classifier model is selected
      // 3. An image model is available (so classification will be used)
      // 4. Performance mode is enabled (keep models loaded)
      if (
        settings.imageGenerationMode === 'auto' &&
        settings.autoDetectMethod === 'llm' &&
        settings.classifierModelId &&
        activeImageModelId &&
        settings.modelLoadingStrategy === 'performance'
      ) {
        const classifierModel = downloadedModels.find(m => m.id === settings.classifierModelId);
        if (classifierModel && classifierModel.filePath) {
          const currentPath = llmService.getLoadedModelPath();
          // Don't preload if the main model is different and already loaded
          // (we don't want to replace the user's selected model)
          // Only preload if no model is loaded yet
          if (!currentPath) {
            console.log('[ChatScreen] Preloading classifier model:', classifierModel.name);
            try {
              // Use activeModelService singleton
              await activeModelService.loadTextModel(settings.classifierModelId);
            } catch (error) {
              console.warn('[ChatScreen] Failed to preload classifier model:', error);
            }
          }
        }
      }
    };
    preloadClassifierModel();
  }, [settings.imageGenerationMode, settings.autoDetectMethod, settings.classifierModelId, activeImageModelId, settings.modelLoadingStrategy]);

  useEffect(() => {
    // Scroll to bottom when new messages arrive, but only if user is already near bottom
    if (activeConversation?.messages.length && isNearBottomRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [activeConversation?.messages.length]);

  // Handle scroll position tracking
  const handleScroll = (event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const nearBottom = distanceFromBottom < 100;
    isNearBottomRef.current = nearBottom;
    setShowScrollToBottom(!nearBottom);
  };

  const handleContentSizeChange = (width: number, height: number) => {
    contentHeightRef.current = height;
    // Only auto-scroll if user is near bottom
    if (isNearBottomRef.current) {
      flatListRef.current?.scrollToEnd({ animated: false });
    }
  };

  const handleLayout = (event: any) => {
    scrollViewHeightRef.current = event.nativeEvent.layout.height;
  };

  // Helper to add system message to current conversation
  const addSystemMessage = (content: string) => {
    if (!activeConversationId || !settings.showGenerationDetails) return;
    addMessage(activeConversationId, {
      role: 'assistant',
      content: `_${content}_`,
      isSystemInfo: true,
    });
  };

  const ensureModelLoaded = async () => {
    if (!activeModel || !activeModelId) return;

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

    // Check if model is already being loaded by activeModelService (e.g., from HomeScreen)
    const modelInfo = activeModelService.getActiveModels();
    const alreadyLoading = modelInfo.text.isLoading;

    // Check memory before loading (only if we're initiating the load)
    if (!alreadyLoading) {
      const memoryCheck = await activeModelService.checkMemoryForModel(activeModelId, 'text');

      if (!memoryCheck.canLoad) {
        // Critical: Not enough memory
        setAlertState(showAlert(
          'Insufficient Memory',
          `Cannot load ${activeModel.name}. ${memoryCheck.message}\n\nTry unloading other models from the Home screen.`
        ));
        return;
      }

      // For warnings, add a system message but proceed with loading
      if (memoryCheck.severity === 'warning' && settings.showGenerationDetails) {
        // Will add warning message after load attempt
      }
    }

    // Only show our own loading indicator if we're the one starting the load
    if (!alreadyLoading) {
      setIsModelLoading(true);
      setLoadingModel(activeModel);
      modelLoadStartTimeRef.current = Date.now();

      // Give UI time to render the full-screen loading state before heavy native operation
      // Use a longer delay to ensure React has time to complete the re-render
      await new Promise(resolve => requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(resolve, 200); // Increased from 50ms to allow full render
        });
      }));
    }

    try {
      // Use activeModelService singleton - prevents duplicate loads
      // If already loading, this will wait for the existing load to complete
      await activeModelService.loadTextModel(activeModelId);
      const multimodalSupport = llmService.getMultimodalSupport();
      setSupportsVision(multimodalSupport?.vision || false);

      // Add system message about model loading (if we did the load and details are enabled)
      if (!alreadyLoading && modelLoadStartTimeRef.current && settings.showGenerationDetails) {
        const loadTime = ((Date.now() - modelLoadStartTimeRef.current) / 1000).toFixed(1);
        addSystemMessage(`Model loaded: ${activeModel.name} (${loadTime}s)`);
      }
    } catch (error: any) {
      // Only show error if we were the one doing the load
      if (!alreadyLoading) {
        setAlertState(showAlert('Error', `Failed to load model: ${error?.message || 'Unknown error'}`));
      }
    } finally {
      if (!alreadyLoading) {
        setIsModelLoading(false);
        setLoadingModel(null);
        modelLoadStartTimeRef.current = null;
      }
    }
  };

  const handleModelSelect = async (model: DownloadedModel) => {
    // If already loaded, just close
    if (llmService.getLoadedModelPath() === model.filePath) {
      setShowModelSelector(false);
      return;
    }

    // Check memory before loading
    const memoryCheck = await activeModelService.checkMemoryForModel(model.id, 'text');

    if (!memoryCheck.canLoad) {
      // Critical: Not enough memory, don't allow loading
      setAlertState(showAlert('Insufficient Memory', memoryCheck.message));
      return;
    }

    if (memoryCheck.severity === 'warning') {
      // Warning: Ask user to confirm
      setAlertState(showAlert(
        'Low Memory Warning',
        memoryCheck.message,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Load Anyway',
            style: 'default',
            onPress: () => {
              setAlertState(hideAlert());
              proceedWithModelLoad(model);
            },
          },
        ]
      ));
      return;
    }

    // Safe to load
    proceedWithModelLoad(model);
  };

  const proceedWithModelLoad = async (model: DownloadedModel) => {
    setIsModelLoading(true);
    setLoadingModel(model);
    modelLoadStartTimeRef.current = Date.now();

    // Give UI time to render the full-screen loading state before heavy native operation
    await new Promise(resolve => requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 200);
      });
    }));

    try {
      // Use activeModelService singleton - prevents duplicate loads
      await activeModelService.loadTextModel(model.id);
      // Check vision support after loading
      const multimodalSupport = llmService.getMultimodalSupport();
      setSupportsVision(multimodalSupport?.vision || false);

      // Add system message about model loading
      if (modelLoadStartTimeRef.current && settings.showGenerationDetails) {
        const loadTime = ((Date.now() - modelLoadStartTimeRef.current) / 1000).toFixed(1);
        // We need to add to the conversation after it might be created
        const convId = activeConversationId || createConversation(model.id);
        if (convId) {
          addMessage(convId, {
            role: 'assistant',
            content: `_Model loaded: ${model.name} (${loadTime}s)_`,
            isSystemInfo: true,
          });
        }
      } else if (!activeConversationId) {
        // Create a new conversation if none exists
        createConversation(model.id);
      }
    } catch (error) {
      setAlertState(showAlert('Error', `Failed to load model: ${(error as Error).message}`));
    } finally {
      setIsModelLoading(false);
      setLoadingModel(null);
      setShowModelSelector(false);
      modelLoadStartTimeRef.current = null;
    }
  };

  const handleUnloadModel = async () => {
    // Stop any ongoing generation first
    if (isStreaming) {
      await llmService.stopGeneration();
      clearStreamingMessage();
    }

    const modelName = activeModel?.name;
    setIsModelLoading(true);
    setLoadingModel(activeModel);
    try {
      await activeModelService.unloadTextModel();
      setSupportsVision(false);

      // Add system message about model unloading
      if (settings.showGenerationDetails && modelName) {
        addSystemMessage(`Model unloaded: ${modelName}`);
      }
    } catch (error) {
      setAlertState(showAlert('Error', `Failed to unload model: ${(error as Error).message}`));
    } finally {
      setIsModelLoading(false);
      setLoadingModel(null);
      setShowModelSelector(false);
    }
  };

  // Determine if message should be routed to image generation
  const shouldRouteToImageGeneration = async (text: string, forceImageMode?: boolean): Promise<boolean> => {
    // If already generating image, don't start another one - route to text
    if (isGeneratingImage) {
      return false;
    }

    // Manual mode: only generate image when explicitly forced
    if (settings.imageGenerationMode === 'manual') {
      return forceImageMode === true;
    }

    // Force mode: always generate image
    if (forceImageMode) {
      return true;
    }

    // Auto mode: use intent classifier
    if (!imageModelLoaded) {
      return false;
    }

    try {
      // Use LLM for classification only if autoDetectMethod is 'llm'
      const useLLM = settings.autoDetectMethod === 'llm';
      const classifierModel = settings.classifierModelId
        ? downloadedModels.find(m => m.id === settings.classifierModelId)
        : null;

      // Show status when using LLM classification (only if not already generating)
      if (useLLM && !isGeneratingImage) {
        setAppIsGeneratingImage(true);
        setAppImageGenerationStatus('Preparing classifier...');
      }

      const intent = await intentClassifier.classifyIntent(text, {
        useLLM,
        classifierModel,
        currentModelPath: llmService.getLoadedModelPath(),
        onStatusChange: useLLM ? setAppImageGenerationStatus : undefined,
        modelLoadingStrategy: settings.modelLoadingStrategy,
      });

      // Clear status if not generating image (and we set it during classification)
      if (intent !== 'image' && useLLM) {
        setAppImageGenerationStatus(null);
        setAppIsGeneratingImage(false);
      }

      return intent === 'image';
    } catch (error) {
      console.warn('[ChatScreen] Intent classification failed:', error);
      setAppImageGenerationStatus(null);
      setAppIsGeneratingImage(false);
      return false;
    }
  };

  // Handle image generation - delegates to lifecycle-independent service
  const handleImageGeneration = async (prompt: string, conversationId: string, skipUserMessage = false) => {
    if (!activeImageModel) {
      setAlertState(showAlert('Error', 'No image model loaded.'));
      return;
    }

    // Add user message (skip when generating from existing message via long-press)
    if (!skipUserMessage) {
      addMessage(
        conversationId,
        {
          role: 'user',
          content: prompt,
        }
      );
    }

    // Delegate to service - this survives navigation
    const result = await imageGenerationService.generateImage({
      prompt,
      conversationId,
      steps: settings.imageSteps || 8,
      guidanceScale: settings.imageGuidanceScale || 2.0,
      previewInterval: 2,
    });

    // Reset image mode after completion
    setCurrentImageMode('auto');

    // Show error if generation failed (and wasn't cancelled)
    if (!result && imageGenState.error && !imageGenState.error.includes('cancelled')) {
      setAlertState(showAlert('Error', `Image generation failed: ${imageGenState.error}`));
    }
  };

  const handleSend = async (text: string, attachments?: MediaAttachment[], forceImageMode?: boolean) => {
    if (!activeConversationId || !activeModel) {
      setAlertState(showAlert('No Model Selected', 'Please select a model first.'));
      return;
    }

    // Capture the conversation ID at the start - this won't change even if user switches chats
    const targetConversationId = activeConversationId;

    // Append document content to the message text
    let messageText = text;
    if (attachments) {
      const documentAttachments = attachments.filter(a => a.type === 'document' && a.textContent);
      for (const doc of documentAttachments) {
        const fileName = doc.fileName || 'document';
        messageText += `\n\n---\n📄 **Attached Document: ${fileName}**\n\`\`\`\n${doc.textContent}\n\`\`\`\n---`;
      }
    }

    // Check if this should be routed to image generation
    const shouldGenerateImage = await shouldRouteToImageGeneration(messageText, forceImageMode);

    if (shouldGenerateImage && activeImageModel) {
      await handleImageGeneration(text, targetConversationId);
      return;
    }

    // If image was requested but no model loaded, add a note
    if (shouldGenerateImage && !activeImageModel) {
      // Continue with text response but mention image capability
      messageText = `[User wanted an image but no image model is loaded] ${messageText}`;
    }

    generatingForConversationRef.current = targetConversationId;

    // Ensure the correct model is loaded (not just any model)
    // This is important after LLM classification in memory mode, where the classifier
    // model may be loaded instead of the text generation model
    const currentLoadedPath = llmService.getLoadedModelPath();
    const needsModelLoad = !currentLoadedPath || currentLoadedPath !== activeModel.filePath;

    if (needsModelLoad) {
      await ensureModelLoaded();
      if (!llmService.isModelLoaded() || llmService.getLoadedModelPath() !== activeModel.filePath) {
        setAlertState(showAlert('Error', 'Failed to load model. Please try again.'));
        generatingForConversationRef.current = null;
        return;
      }
    }

    // Add user message with attachments (show original text, not with document content appended)
    const userMessage = addMessage(
      targetConversationId,
      {
        role: 'user',
        content: text, // Keep original text for display
      },
      attachments
    );

    // Prepare messages for context
    const conversationMessages = activeConversation?.messages || [];

    // Use project system prompt if available, otherwise use default
    const systemPrompt = activeProject?.systemPrompt
      || settings.systemPrompt
      || APP_CONFIG.defaultSystemPrompt;

    // Create a version of the user message with document content for the LLM context
    const userMessageForContext: Message = {
      ...userMessage,
      content: messageText, // Include document content for the LLM
    };

    const messagesForContext: Message[] = [
      {
        id: 'system',
        role: 'system',
        content: systemPrompt,
        timestamp: 0,
      },
      ...conversationMessages,
      userMessageForContext,
    ];

    // Update debug info and check if truncation occurred
    let shouldClearCache = false;
    try {
      const contextDebug = await llmService.getContextDebugInfo(messagesForContext);
      setDebugInfo({
        systemPrompt,
        ...contextDebug,
      });

      // If messages were truncated or context is > 70% full, clear KV cache
      // This helps prevent inconsistent state and performance degradation
      if (contextDebug.truncatedCount > 0 || contextDebug.contextUsagePercent > 70) {
        shouldClearCache = true;
      }
    } catch (e) {
      console.log('Debug info error:', e);
    }

    // Clear KV cache if needed to prevent performance degradation
    if (shouldClearCache) {
      await llmService.clearKVCache(false).catch(() => {});
    }

    // Use generationService for background-safe generation
    try {
      await generationService.generateResponse(
        targetConversationId,
        messagesForContext,
        () => {
          // onFirstToken callback - generation has started producing tokens
          console.log('[ChatScreen] First token received for conversation:', targetConversationId);
        }
      );
    } catch (error: any) {
      setAlertState(showAlert('Generation Error', error.message || 'Failed to generate response'));
    }
    generatingForConversationRef.current = null;
  };

  const handleStop = async () => {
    console.log('[ChatScreen] handleStop called');
    generatingForConversationRef.current = null;

    // Stop text generation - call both services to ensure it stops
    // generationService.stopGeneration() calls llmService.stopGeneration() internally,
    // but we also call it directly as a fallback
    try {
      await Promise.all([
        generationService.stopGeneration().catch(() => {}),
        llmService.stopGeneration().catch(() => {}),
      ]);
    } catch (e) {
      // Ignore errors - generation may have already finished
    }

    // Stop image generation if in progress
    if (isGeneratingImage) {
      imageGenerationService.cancelGeneration().catch(() => {});
    }
  };

  const handleDeleteConversation = () => {
    if (!activeConversationId || !activeConversation) return;

    setAlertState(showAlert(
      'Delete Conversation',
      'Are you sure you want to delete this conversation? This will also delete all images generated in this chat.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setAlertState(hideAlert());
            // Stop any ongoing generation first
            if (isStreaming) {
              await llmService.stopGeneration();
              clearStreamingMessage();
            }
            // Delete associated images from disk and store
            const imageIds = removeImagesByConversationId(activeConversationId);
            for (const imageId of imageIds) {
              await onnxImageGeneratorService.deleteGeneratedImage(imageId);
            }
            deleteConversation(activeConversationId);
            setActiveConversation(null);
            navigation.goBack();
          },
        },
      ]
    ));
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
    if (!activeConversationId || !activeModel) return;

    // Capture the conversation ID at the start
    const targetConversationId = activeConversationId;

    // Check if this should be routed to image generation
    const shouldGenerateImage = await shouldRouteToImageGeneration(userMessage.content);

    if (shouldGenerateImage && activeImageModel) {
      await handleImageGeneration(userMessage.content, targetConversationId, true);
      return;
    }

    // Continue with text generation
    if (!llmService.isModelLoaded()) return;

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

    // Use generationService for background-safe generation
    try {
      await generationService.generateResponse(
        targetConversationId,
        messagesForContext
      );
    } catch (error: any) {
      setAlertState(showAlert('Generation Error', error.message || 'Failed to generate response'));
    }
    generatingForConversationRef.current = null;
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

  const handleGenerateImageFromMessage = async (prompt: string) => {
    if (!activeConversationId || !activeImageModel) {
      setAlertState(showAlert('No Image Model', 'Please load an image model first from the Models screen.'));
      return;
    }

    // Skip adding user message since we're generating from an existing message
    await handleImageGeneration(prompt, activeConversationId, true);
  };

  // Handle image tap to show fullscreen viewer
  const handleImagePress = (uri: string) => {
    setViewerImageUri(uri);
  };

  // Save image to device gallery/downloads
  const handleSaveImage = async () => {
    if (!viewerImageUri) return;

    try {
      // Request permission on Android
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          {
            title: 'Storage Permission',
            message: 'App needs access to save images',
            buttonNeutral: 'Ask Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        // Continue anyway on Android 10+ (scoped storage)
      }

      // Get the source path (remove file:// prefix if present)
      const sourcePath = viewerImageUri.replace('file://', '');

      // Create destination path in Pictures/OffgridMobile folder
      const picturesDir = Platform.OS === 'android'
        ? `${RNFS.ExternalStorageDirectoryPath}/Pictures/OffgridMobile`
        : `${RNFS.DocumentDirectoryPath}/OffgridMobile_Images`;

      // Create directory if it doesn't exist
      if (!(await RNFS.exists(picturesDir))) {
        await RNFS.mkdir(picturesDir);
      }

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `generated_${timestamp}.png`;
      const destPath = `${picturesDir}/${fileName}`;

      // Copy the file
      await RNFS.copyFile(sourcePath, destPath);

      setAlertState(showAlert(
        'Image Saved',
        Platform.OS === 'android'
          ? `Saved to Pictures/OffgridMobile/${fileName}`
          : `Saved to ${fileName}`
      ));
    } catch (error: any) {
      console.error('[ChatScreen] Failed to save image:', error);
      setAlertState(showAlert('Error', `Failed to save image: ${error?.message || 'Unknown error'}`));
    }
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => (
    <ChatMessage
      message={item}
      isStreaming={item.id === 'streaming'}
      onCopy={handleCopyMessage}
      onRetry={handleRetryMessage}
      onEdit={handleEditMessage}
      onGenerateImage={handleGenerateImageFromMessage}
      onImagePress={handleImagePress}
      canGenerateImage={imageModelLoaded && !isStreaming && !isGeneratingImage}
      showGenerationDetails={settings.showGenerationDetails}
      animateEntry={animateLastN > 0 && index >= displayMessages.length - animateLastN}
    />
  );

  // Create streaming/thinking message object for display
  // Only show if the streaming is for the current conversation
  const allMessages = activeConversation?.messages || [];
  const isStreamingForThisConversation = streamingForConversationId === activeConversationId;
  const displayMessages = isThinking && isStreamingForThisConversation
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
    : streamingMessage && isStreamingForThisConversation
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

  // Track new messages for entry animation
  useEffect(() => {
    const prev = lastMessageCountRef.current;
    const curr = displayMessages.length;
    if (curr > prev && prev > 0) {
      setAnimateLastN(curr - prev);
    }
    lastMessageCountRef.current = curr;
  }, [displayMessages.length]);

  // Reset animation count on conversation switch
  useEffect(() => {
    lastMessageCountRef.current = 0;
    setAnimateLastN(0);
  }, [activeConversationId]);

  if (!activeModelId || !activeModel) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.noModelContainer}>
          <View style={styles.noModelIconContainer}>
            <Icon name="cpu" size={32} color={colors.textMuted} />
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
    const loadingModelName = loadingModel?.name || activeModel?.name || 'model';
    const modelSize = loadingModel ? hardwareService.formatModelSize(loadingModel) : activeModel ? hardwareService.formatModelSize(activeModel) : '';
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading {loadingModelName}</Text>
          {modelSize ? (
            <Text style={styles.loadingSubtext}>{modelSize}</Text>
          ) : null}
          <Text style={styles.loadingHint}>
            Preparing model for inference. This may take a moment for larger models.
          </Text>
          {(loadingModel?.mmProjPath || activeModel?.mmProjPath) && (
            <Text style={styles.loadingHint}>
              Vision capabilities will be enabled.
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        testID="chat-screen"
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
                testID="model-selector"
              >
                <Text style={styles.headerSubtitle} numberOfLines={1} testID="model-loaded-indicator">
                  {activeModel.name}
                </Text>
                <Text style={styles.modelSelectorArrow}>▼</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.headerActions}>
              {conversationImageCount > 0 && (
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => (navigation as any).navigate('Gallery', { conversationId: activeConversationId })}
                >
                  <Icon name="image" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => setShowSettingsPanel(true)}
                testID="chat-settings-icon"
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
            <AnimatedEntry index={0} staggerMs={60}>
              <View style={styles.emptyChatIconContainer}>
                <Icon name="message-square" size={32} color={colors.textMuted} />
              </View>
            </AnimatedEntry>
            <AnimatedEntry index={1} staggerMs={60}>
              <Text style={styles.emptyChatTitle}>Start a Conversation</Text>
            </AnimatedEntry>
            <AnimatedEntry index={2} staggerMs={60}>
              <Text style={styles.emptyChatText}>
                Type a message below to begin chatting with {activeModel.name}.
              </Text>
            </AnimatedEntry>
            <AnimatedEntry index={3} staggerMs={60}>
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
            </AnimatedEntry>
            <AnimatedEntry index={4} staggerMs={60}>
              <Text style={styles.privacyText}>
                This conversation is completely private. All processing
                happens on your device.
              </Text>
            </AnimatedEntry>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={displayMessages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            onScroll={handleScroll}
            onContentSizeChange={handleContentSizeChange}
            onLayout={handleLayout}
            scrollEventThrottle={16}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            maintainVisibleContentPosition={{
              minIndexForVisible: 0,
              autoscrollToTopThreshold: 100,
            }}
          />
        )}

        {/* Scroll-to-bottom button */}
        {showScrollToBottom && displayMessages.length > 0 && (
          <Animated.View
            entering={FadeIn.duration(150)}
            style={styles.scrollToBottomContainer}
          >
            <AnimatedPressable
              hapticType="impactLight"
              style={styles.scrollToBottomButton}
              onPress={() => flatListRef.current?.scrollToEnd({ animated: true })}
            >
              <Icon name="chevron-down" size={20} color={colors.textSecondary} />
            </AnimatedPressable>
          </Animated.View>
        )}

        {/* Image generation progress indicator with preview */}
        {isGeneratingImage && (
          <View style={styles.imageProgressContainer}>
            <View style={styles.imageProgressCard}>
              <View style={styles.imageProgressRow}>
                {/* Preview image - small thumbnail */}
                {imagePreviewPath && (
                  <Image
                    source={{ uri: imagePreviewPath }}
                    style={styles.imagePreview}
                    resizeMode="cover"
                  />
                )}
                <View style={styles.imageProgressContent}>
                  <View style={styles.imageProgressHeader}>
                    <View style={styles.imageProgressIconContainer}>
                      <Icon name="image" size={18} color={colors.primary} />
                    </View>
                    <View style={styles.imageProgressInfo}>
                      <Text style={styles.imageProgressTitle}>
                        {imagePreviewPath ? 'Refining Image' : 'Generating Image'}
                      </Text>
                      {imageGenerationStatus && (
                        <Text style={styles.imageProgressStatus}>
                          {imageGenerationStatus}
                        </Text>
                      )}
                    </View>
                    {imageGenerationProgress && (
                      <Text style={styles.imageProgressSteps}>
                        {imageGenerationProgress.step}/{imageGenerationProgress.totalSteps}
                      </Text>
                    )}
                    <TouchableOpacity
                      style={styles.imageStopButton}
                      onPress={handleStop}
                    >
                      <Icon name="x" size={16} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                  {imageGenerationProgress && (
                    <View style={styles.imageProgressBarContainer}>
                      <View style={styles.imageProgressBar}>
                        <View
                          style={[
                            styles.imageProgressFill,
                            { width: `${(imageGenerationProgress.step / imageGenerationProgress.totalSteps) * 100}%` }
                          ]}
                        />
                      </View>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          onStop={handleStop}
          disabled={!llmService.isModelLoaded()}
          isGenerating={isStreaming}
          supportsVision={supportsVision}
          conversationId={activeConversationId}
          imageModelLoaded={imageModelLoaded}
          onImageModeChange={setCurrentImageMode}
          onOpenSettings={() => setShowSettingsPanel(true)}
          activeImageModelName={activeImageModel?.name || null}
          placeholder={
            llmService.isModelLoaded()
              ? supportsVision
                ? 'Type a message or add an image...'
                : 'Type a message...'
              : 'Loading model...'
          }
        />

      {/* Project Selector Sheet */}
      <ProjectSelectorSheet
        visible={showProjectSelector}
        onClose={() => setShowProjectSelector(false)}
        projects={projects}
        activeProject={activeProject || null}
        onSelectProject={handleSelectProject}
      />

      {/* Debug Sheet */}
      <DebugSheet
        visible={showDebugPanel}
        onClose={() => setShowDebugPanel(false)}
        debugInfo={debugInfo}
        activeProject={activeProject || null}
        settings={settings}
        activeConversation={activeConversation || null}
      />

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

      {/* Fullscreen Image Viewer Modal */}
      <Modal
        visible={!!viewerImageUri}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerImageUri(null)}
      >
        <View style={styles.imageViewerContainer}>
          <TouchableOpacity
            style={styles.imageViewerBackdrop}
            activeOpacity={1}
            onPress={() => setViewerImageUri(null)}
          />
          {viewerImageUri && (
            <View style={styles.imageViewerContent}>
              <Image
                source={{ uri: viewerImageUri }}
                style={styles.fullscreenImage}
                resizeMode="contain"
              />
              <View style={styles.imageViewerActions}>
                <TouchableOpacity
                  style={styles.imageViewerButton}
                  onPress={handleSaveImage}
                >
                  <Icon name="download" size={24} color={colors.text} />
                  <Text style={styles.imageViewerButtonText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.imageViewerButton}
                  onPress={() => setViewerImageUri(null)}
                >
                  <Icon name="x" size={24} color={colors.text} />
                  <Text style={styles.imageViewerButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Custom Alert Modal */}
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
    zIndex: 10,
  },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  headerLeft: {
    flex: 1,
    marginRight: 12,
  },
  headerTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    marginBottom: 2,
  },
  headerSubtitle: {
    ...TYPOGRAPHY.h3,
    color: colors.textMuted,
  },
  modelSelector: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  modelSelectorArrow: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginLeft: SPACING.xs,
  },
  headerActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  iconButtonText: {
    ...TYPOGRAPHY.body,
    fontSize: 15,
    color: colors.textSecondary,
  },
  projectButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.primary + '30',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  projectButtonText: {
    ...TYPOGRAPHY.body,
    fontWeight: '600' as const,
    color: colors.primary,
  },
  messageList: {
    paddingVertical: 16,
  },
  scrollToBottomContainer: {
    position: 'absolute' as const,
    bottom: 80,
    right: 16,
    zIndex: 10,
  },
  scrollToBottomButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  emptyChat: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 32,
  },
  emptyChatIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: SPACING.lg,
  },
  emptyChatTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  emptyChatText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    marginBottom: SPACING.xl,
  },
  projectHint: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: 8,
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  projectHintIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: colors.primary + '30',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  projectHintIconText: {
    ...TYPOGRAPHY.bodySmall,
    fontWeight: '600' as const,
    color: colors.primary,
  },
  projectHintText: {
    ...TYPOGRAPHY.h3,
    color: colors.primary,
    fontWeight: '500' as const,
  },
  privacyText: {
    ...TYPOGRAPHY.h3,
    color: colors.textMuted,
    textAlign: 'center' as const,
    maxWidth: 300,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 16,
    paddingHorizontal: 24,
  },
  loadingText: {
    ...TYPOGRAPHY.h1,
    fontSize: 18,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
    color: colors.text,
  },
  loadingSubtext: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  loadingHint: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: SPACING.lg,
    textAlign: 'center' as const,
    paddingHorizontal: 32,
  },
  noModelContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.xxl,
  },
  noModelIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: SPACING.lg,
  },
  noModelTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  noModelText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
  },
  selectModelButton: {
    marginTop: SPACING.xl,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: 8,
  },
  selectModelButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
  },
  imageProgressContainer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  imageProgressCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  imageProgressRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  imageProgressContent: {
    flex: 1,
  },
  imageProgressHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  imageProgressIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.primary + '20',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: 10,
  },
  imageProgressInfo: {
    flex: 1,
  },
  imageProgressTitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '600' as const,
    color: colors.text,
  },
  imageProgressStatus: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    fontStyle: 'normal' as const,
  },
  imageProgressBarContainer: {
    marginTop: 10,
  },
  imageProgressBar: {
    height: 4,
    backgroundColor: colors.surfaceLight,
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  imageProgressFill: {
    height: '100%' as const,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  imageProgressSteps: {
    ...TYPOGRAPHY.bodySmall,
    fontWeight: '600' as const,
    color: colors.primary,
    marginRight: SPACING.sm,
  },
  imagePreview: {
    width: 100,
    height: 100,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: colors.surfaceLight,
  },
  imageStopButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.error + '20',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  // Fullscreen image viewer styles
  imageViewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  imageViewerBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  imageViewerContent: {
    width: '100%' as const,
    height: '100%' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  fullscreenImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height * 0.7,
  },
  imageViewerActions: {
    flexDirection: 'row' as const,
    position: 'absolute' as const,
    bottom: 60,
    gap: 40,
  },
  imageViewerButton: {
    alignItems: 'center' as const,
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    minWidth: 80,
  },
  imageViewerButtonText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
    marginTop: SPACING.xs,
    fontWeight: '500' as const,
  },
});
