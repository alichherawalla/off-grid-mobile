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
  ScrollView,
  Image,
  Dimensions,
  PermissionsAndroid,
  InteractionManager,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import RNFS from 'react-native-fs';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
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
} from '../components';
import { COLORS, APP_CONFIG, SPACING, TYPOGRAPHY } from '../constants';
import { useAppStore, useChatStore, useProjectStore } from '../stores';
import { llmService, modelManager, intentClassifier, activeModelService, generationService, imageGenerationService, ImageGenerationState, onnxImageGeneratorService, hardwareService } from '../services';
import { Message, MediaAttachment, Project, DownloadedModel, ImageModeState, GenerationMeta } from '../types';
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
  // Track which conversation a generation was started for
  const generatingForConversationRef = useRef<string | null>(null);
  // Track when generation started for timing
  const generationStartTimeRef = useRef<number | null>(null);
  // Track model load start time for system messages
  const modelLoadStartTimeRef = useRef<number | null>(null);
  const navigation = useNavigation();
  const route = useRoute<ChatScreenRouteProp>();

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
    // Consider "near bottom" if within 100 pixels of the bottom
    isNearBottomRef.current = distanceFromBottom < 100;
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

      // Create destination path in Pictures/LocalLLM folder
      const picturesDir = Platform.OS === 'android'
        ? `${RNFS.ExternalStorageDirectoryPath}/Pictures/LocalLLM`
        : `${RNFS.DocumentDirectoryPath}/LocalLLM_Images`;

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
          ? `Saved to Pictures/LocalLLM/${fileName}`
          : `Saved to ${fileName}`
      ));
    } catch (error: any) {
      console.error('[ChatScreen] Failed to save image:', error);
      setAlertState(showAlert('Error', `Failed to save image: ${error?.message || 'Unknown error'}`));
    }
  };

  const renderMessage = ({ item }: { item: Message }) => (
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

  if (!activeModelId || !activeModel) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.noModelContainer}>
          <View style={styles.noModelIconContainer}>
            <Icon name="cpu" size={32} color={COLORS.textMuted} />
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
          <ActivityIndicator size="large" color={COLORS.primary} />
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
                  <Icon name="image" size={14} color={COLORS.textSecondary} />
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
            <View style={styles.emptyChatIconContainer}>
              <Icon name="message-square" size={32} color={COLORS.textMuted} />
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
                      <Icon name="image" size={18} color={COLORS.primary} />
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
                      <Icon name="x" size={16} color={COLORS.error} />
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

      {/* Project Selector Modal */}
      <Modal
        visible={showProjectSelector}
        transparent
        animationType="slide"
        onRequestClose={() => setShowProjectSelector(false)}
      >
        <TouchableOpacity
          style={styles.projectModalOverlay}
          activeOpacity={1}
          onPress={() => setShowProjectSelector(false)}
        >
          <View style={styles.projectModal} onStartShouldSetResponder={() => true}>
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
        </TouchableOpacity>
      </Modal>

      {/* Debug Panel Modal */}
      <Modal
        visible={showDebugPanel}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDebugPanel(false)}
      >
        <TouchableOpacity
          style={styles.debugModalOverlay}
          activeOpacity={1}
          onPress={() => setShowDebugPanel(false)}
        >
          <View style={styles.debugModal} onStartShouldSetResponder={() => true}>
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
        </TouchableOpacity>
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
                  <Icon name="download" size={24} color={COLORS.text} />
                  <Text style={styles.imageViewerButtonText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.imageViewerButton}
                  onPress={() => setViewerImageUri(null)}
                >
                  <Icon name="x" size={24} color={COLORS.text} />
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
    backgroundColor: COLORS.background,
    zIndex: 10,
    elevation: 4,
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
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
    marginBottom: 2,
  },
  headerSubtitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textMuted,
  },
  modelSelector: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modelSelectorArrow: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
    marginLeft: SPACING.xs,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonText: {
    ...TYPOGRAPHY.body,
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  projectButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectButtonText: {
    ...TYPOGRAPHY.body,
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
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  emptyChatTitle: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  emptyChatText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  projectHint: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
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
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectHintIconText: {
    ...TYPOGRAPHY.bodySmall,
    fontWeight: '600',
    color: COLORS.primary,
  },
  projectHintText: {
    ...TYPOGRAPHY.h3,
    color: COLORS.primary,
    fontWeight: '500',
  },
  privacyReminder: {
    backgroundColor: COLORS.info + '15',
    borderWidth: 1,
    borderColor: COLORS.info + '40',
    maxWidth: 300,
  },
  privacyText: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  loadingText: {
    ...TYPOGRAPHY.h1,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    color: COLORS.text,
  },
  loadingSubtext: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  loadingHint: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textMuted,
    marginTop: SPACING.lg,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  noModelContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xxl,
  },
  noModelIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  noModelTitle: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  noModelText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  selectModelButton: {
    marginTop: SPACING.xl,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: 8,
  },
  selectModelButtonText: {
    ...TYPOGRAPHY.body,
    color: COLORS.primary,
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
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
  },
  projectModalClose: {
    ...TYPOGRAPHY.h2,
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
    ...TYPOGRAPHY.h2,
    fontWeight: '600',
    color: COLORS.primary,
  },
  projectOptionInfo: {
    flex: 1,
  },
  projectOptionName: {
    ...TYPOGRAPHY.h2,
    fontWeight: '600',
    color: COLORS.text,
  },
  projectOptionDesc: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  projectCheckmark: {
    ...TYPOGRAPHY.h1,
    fontSize: 18,
    color: COLORS.primary,
    fontWeight: '600',
    marginLeft: SPACING.sm,
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
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
  },
  debugModalClose: {
    ...TYPOGRAPHY.h2,
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
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: SPACING.sm,
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
    ...TYPOGRAPHY.h1,
    fontWeight: '700',
    color: COLORS.text,
  },
  debugStatLabel: {
    ...TYPOGRAPHY.meta,
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
    ...TYPOGRAPHY.h3,
    color: COLORS.textSecondary,
  },
  debugValue: {
    ...TYPOGRAPHY.h3,
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
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
    lineHeight: 16,
  },
  debugHint: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginBottom: SPACING.sm,
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
    ...TYPOGRAPHY.meta,
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
    backgroundColor: COLORS.info + '30',
    color: COLORS.info,
  },
  debugMessageIndex: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
  },
  debugMessageContent: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
  imageProgressContainer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  imageProgressCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
  },
  imageProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  imageProgressContent: {
    flex: 1,
  },
  imageProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  imageProgressIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: COLORS.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  imageProgressInfo: {
    flex: 1,
  },
  imageProgressTitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.text,
  },
  imageProgressStatus: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
    fontStyle: 'normal',
  },
  imageProgressBarContainer: {
    marginTop: 10,
  },
  imageProgressBar: {
    height: 4,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 2,
    overflow: 'hidden',
  },
  imageProgressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  imageProgressSteps: {
    ...TYPOGRAPHY.bodySmall,
    fontWeight: '600',
    color: COLORS.primary,
    marginRight: SPACING.sm,
  },
  imagePreview: {
    width: 100,
    height: 100,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: COLORS.surfaceLight,
  },
  imageStopButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.error + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Fullscreen image viewer styles
  imageViewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageViewerBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  imageViewerContent: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height * 0.7,
  },
  imageViewerActions: {
    flexDirection: 'row',
    position: 'absolute',
    bottom: 60,
    gap: 40,
  },
  imageViewerButton: {
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    minWidth: 80,
  },
  imageViewerButtonText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.text,
    marginTop: SPACING.xs,
    fontWeight: '500',
  },
});
