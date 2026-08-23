import { PROMPT_ENHANCEMENT_STATUS } from '@offgrid/sync';
import { useAppStore, useChatStore } from '../stores';
import logger from '../utils/logger';
import { activeModelService } from './activeModelService';
import {
  generateStandalone,
  getActiveEngineService,
  isRemoteTextModelActive,
} from './engines';
import {
  buildEnhancementCardContent,
  buildEnhancementMessages,
  cleanEnhancedPrompt,
  getConversationContext,
  reportEnhancementSkipped,
} from './imageGenerationHelpers';
import type { GenerateImageParams } from './imageGenerationTypes';

type EnhancementStateWriter = (status: string) => void;

async function resetTextEngine(): Promise<void> {
  try {
    await getActiveEngineService()?.stopGeneration();
    logger.log('[ImageGen] text engine stopGeneration() called');
  } catch (error) {
    logger.error('[ImageGen] Failed to reset text engine:', error);
  }
}

function finishEnhancementMessage(input: {
  conversationId?: string;
  tempMessageId: string | null;
  enhancedPrompt: string;
  originalPrompt: string;
}): void {
  const { conversationId, tempMessageId, enhancedPrompt, originalPrompt } = input;
  if (!conversationId || !tempMessageId) return;
  const chatStore = useChatStore.getState();
  if (enhancedPrompt && enhancedPrompt !== originalPrompt) {
    chatStore.updateMessageThinking(conversationId, tempMessageId, false);
    chatStore.updateMessageContent(
      conversationId,
      tempMessageId,
      buildEnhancementCardContent(enhancedPrompt),
    );
    return;
  }
  logger.warn('[ImageGen] Enhancement produced no change, deleting thinking message');
  chatStore.deleteMessage(conversationId, tempMessageId);
}

async function loadTextModel(
  setState: EnhancementStateWriter,
): Promise<boolean> {
  const textModelId = activeModelService.selectedTextModelId();
  if (!textModelId) {
    logger.warn('[ImageGen] No text model available, skipping enhancement');
    reportEnhancementSkipped('no text model is selected');
    return false;
  }
  setState('Loading text model to enhance prompt...');
  let loadError: unknown = null;
  try {
    await activeModelService.loadTextModel(textModelId);
  } catch (error) {
    loadError = error;
    logger.warn('[ImageGen] Failed to load text model for enhancement:', error);
  }
  if (getActiveEngineService()?.isModelLoaded()) return true;
  reportEnhancementSkipped(
    loadError instanceof Error
      ? loadError.message
      : 'the text model could not load',
  );
  return false;
}

function createStreamingMessage(conversationId?: string): string | null {
  if (!conversationId) return null;
  return useChatStore
    .getState()
    .addMessage(conversationId, {
      role: 'assistant',
      content: PROMPT_ENHANCEMENT_STATUS,
      isThinking: true,
    }).id;
}

function enhancementTokenWriter(
  conversationId: string | undefined,
  tempMessageId: string | null,
): (token: string) => void {
  let streamed = '';
  let renderingAsCard = false;
  return token => {
    streamed += token;
    if (!conversationId || !tempMessageId) return;
    const chatStore = useChatStore.getState();
    if (!renderingAsCard) {
      renderingAsCard = true;
      chatStore.updateMessageThinking(conversationId, tempMessageId, false);
    }
    chatStore.updateMessageContent(
      conversationId,
      tempMessageId,
      buildEnhancementCardContent(streamed),
    );
  };
}

export async function enhanceImagePrompt(
  params: GenerateImageParams,
  setState: EnhancementStateWriter,
): Promise<string> {
  if (!useAppStore.getState().settings.enhanceImagePrompts) return params.prompt;
  const loaded =
    isRemoteTextModelActive() ||
    (getActiveEngineService()?.isModelLoaded() ?? false) ||
    (await loadTextModel(setState));
  if (!loaded) return params.prompt;

  setState(PROMPT_ENHANCEMENT_STATUS);
  const context = params.conversationId
    ? getConversationContext(params.conversationId)
    : [];
  const tempMessageId = createStreamingMessage(params.conversationId);
  try {
    const raw = await generateStandalone(
      buildEnhancementMessages(params.prompt, context),
      enhancementTokenWriter(params.conversationId, tempMessageId),
    );
    const enhancedPrompt = cleanEnhancedPrompt(raw) || params.prompt;
    await resetTextEngine();
    finishEnhancementMessage({
      conversationId: params.conversationId,
      tempMessageId,
      enhancedPrompt,
      originalPrompt: params.prompt,
    });
    return enhancedPrompt;
  } catch (error) {
    logger.error('[ImageGen] Prompt enhancement failed:', error);
    await resetTextEngine();
    if (params.conversationId && tempMessageId) {
      useChatStore.getState().deleteMessage(params.conversationId, tempMessageId);
    }
    return params.prompt;
  }
}
