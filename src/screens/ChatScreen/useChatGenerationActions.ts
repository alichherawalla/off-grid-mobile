import { Dispatch, SetStateAction } from 'react';
import { admitChatImageAttachment } from '@offgrid/models';
import { AlertState, hideAlert, showAlert } from '../../components';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { generationSession } from '../../services/generationSession';
import { localModelAcceptsImages } from '../../services/engines';
import { needsVisionRepair } from '../../utils/visionRepair';
import { reportModelFailure } from '../../services/modelFailureHandler';
import { useChatStore } from '../../stores';
import { mobileImageChatGeneration } from '../../services/modelServices/imageChatGenerationPort';
import type { CacheType, DownloadedModel, MediaAttachment, Message, Project, RemoteModel } from '../../types';
import logger from '../../utils/logger';
import { ensureReadyOrAlert, type ModelReadyOutcome } from './modelReadiness';
import { mobileChatSession, prepareMobileChatGeneration, type MobileChatCommandOptions } from './mobileChatSession';

type SetState<T> = Dispatch<SetStateAction<T>>;

export type GenerationDeps = {
  activeModelId: string | null;
  activeModel: DownloadedModel | null | undefined;
  activeModelInfo?: { isRemote: boolean; model: DownloadedModel | RemoteModel | null; modelId: string | null; modelName: string };
  hasActiveModel?: boolean;
  hasTextModel?: boolean;
  supportsToolCalling?: boolean;
  activeConversationId: string | null | undefined;
  activeConversation: any;
  activeProject: any;
  activeImageModel: any;
  imageModelLoaded: boolean;
  isStreaming: boolean;
  isGeneratingImage: boolean;
  imageGenState: { isGenerating: boolean };
  settings: {
    showGenerationDetails: boolean;
    imageGenerationMode: string;
    autoDetectMethod: string;
    classifierModelId?: string | null;
    systemPrompt?: string;
    imageSteps?: number;
    imageGuidanceScale?: number;
    enabledTools?: string[];
    cacheType?: CacheType;
    thinkingEnabled?: boolean;
  };
  downloadedModels: DownloadedModel[];
  setAlertState: SetState<AlertState>;
  setIsClassifying: SetState<boolean>;
  setAppImageGenerationStatus: (value: string | null) => void;
  setAppIsGeneratingImage: (value: boolean) => void;
  addMessage: (conversationId: string, message: any) => void;
  clearStreamingMessage: () => void;
  deleteConversation: (conversationId: string) => void;
  setActiveConversation: (conversationId: string | null) => void;
  removeImagesByConversationId: (conversationId: string) => string[];
  navigation: any;
  setShowSettingsPanel?: SetState<boolean>;
  ensureModelLoaded: () => Promise<ModelReadyOutcome>;
  forceLoadModel: () => Promise<ModelReadyOutcome>;
  ensureTextModelForChat: () => Promise<boolean>;
  setPendingMessage?: (text: string, attachments?: MediaAttachment[]) => void;
  createConversation: (modelId: string, title?: string, projectId?: string) => string;
  pendingProjectId?: string;
};

function blockedImageForNonVisionModel(deps: GenerationDeps, attachments?: MediaAttachment[]): boolean {
  const admission = admitChatImageAttachment({
    hasImage: !!attachments?.some(attachment => attachment.type === 'image'),
    remote: !!deps.activeModelInfo?.isRemote,
    localVisionReady: localModelAcceptsImages(deps.activeModel),
    visionRepairAvailable: needsVisionRepair(deps.activeModel),
  });
  if (admission.allowed) return false;
  const repair = admission.reason === 'vision-file-missing';
  deps.setAlertState(showAlert(
    repair ? 'Vision File Missing' : 'Vision Not Supported',
    repair
      ? 'This model supports vision, but its vision file has not been installed.\n\nOpen Download Manager and tap the wrench next to the model to download it.'
      : 'This model does not support image input.\n\nSwitch to a vision-capable model to send images.',
  ));
  return true;
}

function mobileCommandOptions(
  deps: GenerationDeps,
  imageMode: MobileChatCommandOptions['imageMode'] = 'auto',
): MobileChatCommandOptions {
  return {
    imageMode,
    onClassifying: deps.setIsClassifying,
    onClassifierStatus: deps.setAppImageGenerationStatus,
    onClassifierTextFallback: () => {
      deps.setAppImageGenerationStatus(null);
      deps.setAppIsGeneratingImage(false);
    },
    ensureTextRoute: deps.ensureTextModelForChat,
  };
}

function presentGenerationError(deps: GenerationDeps, conversationId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error || 'Failed to generate response');
  logger.error('[ChatGen] Generation failed', error);
  const contextFull = message.includes('too long')
    || message.includes('Exceeding the maximum number of tokens')
    || message.includes('Input token ids');
  if (contextFull) {
    deps.setAlertState({
      ...showAlert('Context window full', "The conversation is too long for this model's context window.\n\nIncrease the context limit in Settings, reduce the number of enabled tools, or start a new chat."),
      prominentMessage: true,
    });
    return;
  }
  deps.addMessage(conversationId, { role: 'assistant', content: message });
  deps.setAlertState(showAlert('Generation Error', 'The model could not complete this response. The details are shown in the chat.'));
}

export type StartGenerationCall = {
  setDebugInfo: SetState<any>;
  targetConversationId: string;
  messageText: string;
  imageMode?: 'auto' | 'force' | 'disabled';
};

export async function runPersistedChatTurnFn(deps: GenerationDeps, call: StartGenerationCall): Promise<void> {
  const conversation = useChatStore.getState().conversations.find(candidate => candidate.id === call.targetConversationId);
  const userMessage = [...(conversation?.messages ?? [])].reverse().find(message => message.role === 'user');
  if (!userMessage) return;
  generationSession.begin(call.targetConversationId);
  try {
    const turn = await mobileChatSession.sendPersisted(
      call.targetConversationId,
      userMessage.id,
      mobileCommandOptions(deps, call.imageMode),
    );
    generationSession.end(turn.status === 'stopped' ? 'stopped' : undefined);
    // An intentional stop can complete with no assistant row. That is the
    // expected terminal state, not a model failure.
    if (turn.status === 'stopped') return;
  } catch (error) {
    presentGenerationError(deps, call.targetConversationId, error);
    generationSession.end('error');
    return;
  }
  const finalConversation = useChatStore.getState().conversations.find(candidate => candidate.id === call.targetConversationId);
  if (finalConversation?.messages.at(-1)?.role === 'user') {
    reportModelFailure('text', 'The model produced no output', {
      title: 'No response',
      message: 'The model returned nothing. Try again, or switch the backend or model.',
      onRetry: () => { runPersistedChatTurnFn(deps, call).catch(() => undefined); },
    });
  }
}

export type SendCall = {
  text: string;
  attachments?: MediaAttachment[];
  imageMode?: 'auto' | 'force' | 'disabled';
  setDebugInfo: SetState<any>;
  /** Legacy test input. Shared ChatSessionService owns execution. */
  startGeneration?: (conversationId: string, text: string) => Promise<void>;
};

export async function handleSendFn(deps: GenerationDeps, call: SendCall): Promise<void> {
  if (!deps.hasActiveModel) {
    deps.setAlertState(showAlert('No Model Selected', 'Please select a model first.'));
    return;
  }
  if (blockedImageForNonVisionModel(deps, call.attachments)) return;
  callHook(HOOKS.audioStop);
  await prepareMobileChatGeneration();
  let conversationId = deps.activeConversationId;
  if (!conversationId) {
    const modelId = deps.activeModelInfo?.modelId || deps.activeImageModel?.id;
    conversationId = deps.createConversation(modelId!, undefined, deps.pendingProjectId);
    deps.setActiveConversation(conversationId);
  }
  deps.addMessage(conversationId, { role: 'user', content: call.text, attachments: call.attachments });
  await runPersistedChatTurnFn(deps, {
    setDebugInfo: call.setDebugInfo,
    targetConversationId: conversationId,
    messageText: call.text,
    imageMode: call.imageMode,
  });
}

export async function replayPersistedChatTurnFn(
  deps: GenerationDeps,
  userMessage: Message,
  operation?: { type: 'image'; prompt: string } | { type: 'text' } | { type: 'vision' },
): Promise<void> {
  const conversationId = deps.activeConversationId;
  if (!conversationId || !deps.hasActiveModel) return;
  if (blockedImageForNonVisionModel(deps, userMessage.attachments)) return;
  await prepareMobileChatGeneration();
  if (!deps.activeModelInfo?.isRemote && deps.activeModel && operation?.type !== 'image') {
    const ready = await ensureReadyOrAlert(deps, 'regenerate', () => {
      replayPersistedChatTurnFn(deps, userMessage, operation).catch(() => undefined);
    });
    if (!ready) return;
  }
  generationSession.begin(conversationId);
  try {
    const turn = await mobileChatSession.regenerate(conversationId, userMessage.id, {
      operation,
      options: mobileCommandOptions(deps),
    });
    generationSession.end(turn.status === 'stopped' ? 'stopped' : undefined);
  } catch (error) {
    presentGenerationError(deps, conversationId, error);
    generationSession.end('error');
  }
}

export async function editPersistedChatTurnFn(deps: GenerationDeps, message: Message): Promise<void> {
  const conversationId = deps.activeConversationId;
  if (!conversationId || !deps.hasActiveModel) return;
  await prepareMobileChatGeneration();
  generationSession.begin(conversationId);
  try {
    const turn = await mobileChatSession.edit(conversationId, message.id, message);
    generationSession.end(turn.status === 'stopped' ? 'stopped' : undefined);
  } catch (error) {
    presentGenerationError(deps, conversationId, error);
    generationSession.end('error');
  }
}

export async function generateImageForPersistedTurnFn(
  deps: GenerationDeps,
  prompt: string,
  conversationId: string,
): Promise<void> {
  const message = [...useChatStore.getState().getConversationMessages(conversationId)]
    .reverse()
    .find(candidate => candidate.role === 'user');
  if (!message) return;
  await replayPersistedChatTurnFn(deps, message, { type: 'image', prompt });
}

export async function handleStopFn(deps: Pick<GenerationDeps, 'isGeneratingImage'>): Promise<void> {
  generationSession.end('stopped');
  callHook(HOOKS.audioStop);
  if (!mobileChatSession.stop() && deps.isGeneratingImage) {
    try { await mobileImageChatGeneration.cancel(); }
    catch (error) { logger.error('Error stopping image generation', error); }
  }
}

export async function executeDeleteConversationFn(
  deps: Pick<GenerationDeps, 'activeConversationId' | 'isStreaming' | 'clearStreamingMessage' | 'removeImagesByConversationId' | 'deleteConversation' | 'setActiveConversation' | 'navigation' | 'setAlertState'>,
): Promise<void> {
  if (!deps.activeConversationId) return;
  deps.setAlertState(hideAlert());
  if (deps.isStreaming) {
    mobileChatSession.stopConversation(deps.activeConversationId);
    deps.clearStreamingMessage();
  }
  for (const id of deps.removeImagesByConversationId(deps.activeConversationId)) {
    await mobileImageChatGeneration.deleteArtifact(id);
  }
  mobileImageChatGeneration.clearConversationSummary(deps.activeConversationId);
  deps.deleteConversation(deps.activeConversationId);
  deps.setActiveConversation(null);
  deps.navigation.goBack();
}

export type SelectProjectDeps = {
  activeConversationId: string | null | undefined;
  setConversationProject: (conversationId: string, projectId: string | null) => void;
  setShowProjectSelector: SetState<boolean>;
};

export function handleSelectProjectFn(deps: SelectProjectDeps, project: Project | null): void {
  if (deps.activeConversationId) deps.setConversationProject(deps.activeConversationId, project?.id || null);
  deps.setShowProjectSelector(false);
}
