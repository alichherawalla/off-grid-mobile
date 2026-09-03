import { useModelResidencyStore } from '../../stores/modelResidencyStore';
import { useRef, useState, useCallback } from 'react';
import {
  NavigationProp,
  useNavigation,
  useRoute,
  RouteProp,
} from '@react-navigation/native';
import { AlertState, initialAlertState } from '../../components';
import {
  useAppStore,
  useChatStore,
  useProjectStore,
} from '../../stores';
import { useDiscoveredRemoteModels } from '../../hooks/useDiscoveredRemoteModels';
import { useActiveTextCapabilities } from '../../hooks/useActiveTextCapabilities';
import { useSyncIdentityStore } from '../../stores/syncIdentityStore';
import { useRemoteChatStreamPreviews } from './useRemoteChatStreamPreviews';
import { useActiveTextModel } from '../../hooks/useActiveTextModel';
import { useActiveMobileModel } from '../../hooks/useActiveMobileModel';
import { useMobileModelInventory } from '../../hooks/useMobileModelInventory';
import { hardwareService } from '../../services';
import { useGeneratingConversationId } from '../../hooks/useGenerationSession';
import {
  MediaAttachment,
  DownloadedModel,
  DebugInfo,
  RemoteModel,
} from '../../types';
import { RootStackParamList } from '../../navigation/types';
import {
  ensureModelLoadedFn,
  forceLoadModelFn,
  ensureTextModelForChatFn,
  useChatImageModelEffects,
} from './useChatModelActions';
import type { GenerationDeps } from './useChatGenerationActions';
import { getDisplayMessages } from './types';
import { needsVisionRepair } from '../../utils/visionRepair';
import {
  isStreamingActiveConversation,
  useChatAudioLifecycle,
  useChatConversationLifecycle,
  useChatPresentationLifecycle,
  useChatRuntimeSubscriptions,
} from './useChatScreenLifecycle';
import { useChatScreenActions } from './useChatScreenActions';
import type { RuntimeModel } from '@offgrid/application';

export type { AlertState };
export type { ChatMessageItem } from './types';
export { getPlaceholderText } from './types';
export { computePendingSettings } from './pendingSettings';

type ChatScreenRouteProp = RouteProp<RootStackParamList, 'Chat'>;

/**
 * A model can make chat available only when Shared says that its route is ready
 * and the route can serve a chat turn. Embedding and operation-only sidecars are
 * inventory entries, but they are not chat routes.
 */
export function hasUsableChatRoute(models: readonly RuntimeModel[]): boolean {
  return models.some(
    model =>
      model.ready &&
      (model.modality === 'text' || model.modality === 'image'),
  );
}

export const useChatScreen = () => {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const route = useRoute<ChatScreenRouteProp>();
  // The store owns "the text model is loading", not this component. The live-stream service
  // subscribes to that store, so a paired device learns about the wait by construction instead of
  // sitting on "Preparing reply..." while this phone says "Loading Qwen3.5 2B".
  const isModelLoading = useChatStore(state => state.isModelLoading);
  const setIsModelLoading = useChatStore(state => state.setIsModelLoading);
  const setLoadingModelName = useChatStore(state => state.setLoadingModelName);
  const [loadingModel, setLoadingModelState] =
    useState<DownloadedModel | null>(null);
  const setLoadingModel = useCallback(
    (model: DownloadedModel | null) => {
      setLoadingModelState(model);
      setLoadingModelName(model?.name ?? null);
    },
    [setLoadingModelName],
  );
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [viewerImageUri, setViewerImageUri] = useState<string | null>(null);
  // Capabilities are read from the shared route projection, never copied into state.
  const {
    vision: supportsVision,
    tools: supportsToolCalling,
    thinking: supportsThinking,
  } = useActiveTextCapabilities();
  const [pendingProjectId, setPendingProjectId] = useState<string | undefined>(
    route.params?.projectId,
  );
  // Owned by the generationSession service (single owner); observed reactively here.
  const generatingConversationId = useGeneratingConversationId();
  // Stashed when the model selector opens with no text model; replayed on pick.
  const pendingMessageRef = useRef<{
    text: string;
    attachments?: MediaAttachment[];
  } | null>(null);
  const modelLoadStartTimeRef = useRef<number | null>(null);
  const startGenerationRef = useRef<
    (id: string, text: string) => Promise<void>
  >(null);
  const genDepsRef = useRef<GenerationDeps | null>(null);
  useChatAudioLifecycle(navigation);
  const { imageGenState, isCompacting, queueCount, queuedTexts } =
    useChatRuntimeSubscriptions();

  const {
    downloadedModels,
    settings,
    downloadedImageModels,
    setDownloadedImageModels,
    setIsGeneratingImage: setAppIsGeneratingImage,
    setImageGenerationStatus: setAppImageGenerationStatus,
    removeImagesByConversationId,
    loadedSettings,
  } = useAppStore();
  const textModelEvicted = useModelResidencyStore(s => s.textModelEvicted);

  const discoveredModels = useDiscoveredRemoteModels();

  const {
    activeConversationId,
    conversations,
    createConversation,
    addMessage,
    updateMessageContent,
    updateMessageTurnKind,
    deleteMessagesAfter,
    streamingMessage,
    streamingReasoningContent,
    streamingForConversationId,
    isStreaming,
    isThinking,
    clearStreamingMessage,
    deleteConversation,
    setActiveConversation,
    setConversationProject,
  } = useChatStore();

  const { projects, getProject } = useProjectStore();

  const activeConversation = conversations.find(
    c => c.id === activeConversationId,
  );

  // Which text model is active, from the ONE hook that answers it (remote preferred over local, local
  // resolved by the shared model state). This screen used to re-derive it with its own copy of the rule,
  // which is how it ended up refusing to send to a model the engine had loaded.
  const activeModelInfo = useActiveTextModel();
  const activeImageSnapshot = useActiveMobileModel('image');
  const availableModels = useMobileModelInventory();

  // activeModel is for LOCAL models only (for file path, memory checks, etc.)
  const activeModel = activeModelInfo.isRemote
    ? undefined
    : (activeModelInfo.model as DownloadedModel | undefined);
  const activeRemoteModel = activeModelInfo.isRemote
    ? (activeModelInfo.model as RemoteModel | null)
    : null;
  const hasTextModel = activeModelInfo.modelId !== null;
  const hasActiveModel = hasTextModel || activeImageSnapshot.model !== null;
  const activeModelName = activeModelInfo.modelName;
  const hasAvailableModels = hasUsableChatRoute(availableModels);

  const effectiveProjectId = activeConversation
    ? activeConversation.projectId
    : pendingProjectId;
  const activeProject = effectiveProjectId
    ? getProject(effectiveProjectId)
    : null;
  const activeImageModel = activeImageSnapshot.model?.source === 'local'
    ? downloadedImageModels.find(model => model.id === activeImageSnapshot.model?.id)
    : activeImageSnapshot.model?.serverId
      ? discoveredModels[activeImageSnapshot.model.serverId]?.find(
          model => model.id === activeImageSnapshot.model?.id,
        )
      : undefined;
  const imageModelLoaded = !!activeImageModel;
  const isGeneratingImage = imageGenState.isGenerating;
  const isStreamingForThisConversation = isStreamingActiveConversation(
    streamingForConversationId,
    activeConversationId,
  );

  const genDeps = {
    activeModelId: activeModelInfo.modelId,
    activeModel,
    activeModelInfo,
    hasActiveModel,
    hasTextModel,
    supportsToolCalling,
    activeConversationId,
    activeConversation,
    activeProject,
    activeImageModel,
    imageModelLoaded,
    isStreaming,
    isGeneratingImage,
    imageGenState,
    settings,
    downloadedModels,
    setAlertState,
    setIsClassifying,
    setAppImageGenerationStatus,
    setAppIsGeneratingImage,
    addMessage,
    clearStreamingMessage,
    deleteConversation,
    setActiveConversation,
    removeImagesByConversationId,
    navigation,
    setShowSettingsPanel,
    ensureModelLoaded: () => ensureModelLoadedFn(modelDeps),
    forceLoadModel: () => forceLoadModelFn(modelDeps),
    ensureTextModelForChat: () =>
      ensureTextModelForChatFn({
        setShowModelSelector,
        setLoadingModel,
        setIsModelLoading,
      }),
    setPendingMessage: (text: string, attachments?: MediaAttachment[]) => {
      pendingMessageRef.current = { text, attachments };
    },
    updateMessageTurnKind,
    createConversation,
    pendingProjectId,
  };
  genDepsRef.current = genDeps;

  const modelDeps = {
    activeModel,
    activeModelId: activeModelInfo.modelId,
    activeModelInfo,
    hasActiveModel,
    activeConversationId,
    isStreaming,
    settings,
    clearStreamingMessage,
    createConversation,
    addMessage,
    setIsModelLoading,
    setLoadingModel,
    setShowModelSelector,
    setAlertState,
    modelLoadStartTimeRef,
  };

  useChatConversationLifecycle({
    routeConversationId: route.params?.conversationId,
    routeProjectId: route.params?.projectId,
    activeConversationId,
    setActiveConversation,
    setPendingProjectId,
  });

  useChatImageModelEffects({
    setDownloadedImageModels,
  });

  const isGeneratingForThisConversation =
    generatingConversationId != null &&
    generatingConversationId === activeConversationId;
  // Replies generating on paired devices. Empty unless Pro's chat-stream service is running.
  const remotePreviews = useRemoteChatStreamPreviews(activeConversationId);
  const localDeviceId = useSyncIdentityStore(s => s.localDeviceId);
  const displayMessages = getDisplayMessages(
    activeConversation?.messages || [],
    {
      isThinking,
      streamingMessage,
      streamingReasoningContent,
      isStreamingForThisConversation,
      isModelLoading,
      loadingModelName: loadingModel?.name,
      isGeneratingForThisConversation,
      remotePreviews,
      localDeviceId,
    },
  );

  const animateLastN = useChatPresentationLifecycle(
    activeConversationId,
    displayMessages.length,
    isStreamingForThisConversation,
  );

  const chatActions = useChatScreenActions({
    generationDeps: genDeps,
    modelDeps,
    activeModelInfo,
    supportsToolCalling,
    activeModel,
    settings,
    loadedSettings,
    pendingMessageRef,
    startGenerationRef,
    setDebugInfo,
    setAlertState,
    activeConversationId,
    activeConversation,
    hasActiveModel,
    deleteMessagesAfter,
    updateMessageContent,
    setConversationProject,
    setPendingProjectId,
    setShowProjectSelector,
    activeImageModel,
    viewerImageUri,
    setViewerImageUri,
  });

  return {
    isModelLoading,
    loadingModel,
    supportsVision,
    showProjectSelector,
    setShowProjectSelector,
    showDebugPanel,
    setShowDebugPanel,
    showModelSelector,
    setShowModelSelector,
    showSettingsPanel,
    setShowSettingsPanel,
    supportsToolCalling,
    supportsThinking,
    debugInfo,
    alertState,
    setAlertState,
    showScrollToBottom,
    setShowScrollToBottom,
    isClassifying,
    animateLastN,
    queueCount,
    queuedTexts,
    viewerImageUri,
    setViewerImageUri,
    imageGenState,
    ...chatActions,
    activeModelId: activeModelInfo.modelId,
    activeConversationId,
    activeConversation,
    activeModel,
    activeModelInfo,
    hasActiveModel,
    hasTextModel,
    activeRemoteModel,
    activeModelName,
    activeProject,
    activeImageModel,
    imageModelLoaded,
    isGeneratingImage,
    imageGenerationProgress: imageGenState.progress,
    imageGenerationStatus: imageGenState.status,
    imagePreviewPath: imageGenState.previewPath,
    isStreaming,
    isThinking,
    isCompacting,
    isGeneratingForThisConversation,
    textModelEvicted,
    displayMessages,
    downloadedModels,
    hasAvailableModels,
    projects,
    settings,
    // The chat knows the active model IS a vision model but is missing its projector — surface repair, not a crash.
    visionNeedsRepair:
      !activeModelInfo.isRemote && needsVisionRepair(activeModel),
    navigation,
    hardwareService,
  };
};
