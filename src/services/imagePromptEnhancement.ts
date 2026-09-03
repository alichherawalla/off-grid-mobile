import type { ImagePromptEnhancementService } from '@offgrid/models';
import { imagePromptEnhancement } from './composition/chat';
import { PROMPT_ENHANCEMENT_STATUS } from '@offgrid/sync';
import { useAppStore, useChatStore } from '../stores';
import logger from '../utils/logger';
import { mobileResidencyIntents } from './modelServices/residencyIntents';
import { selectedTextModelId } from './modelServices/modelState';
import { mobileTextEngineControl } from './modelServices/textEngineControl';
import { executeMobileText } from './mobileSidecarGeneration';
import {
  buildEnhancementCardContent,
  getConversationContext,
  reportEnhancementSkipped,
} from './imageGenerationHelpers';
import type { GenerateImageParams } from './imageGenerationTypes';

type EnhancementStateWriter = (status: string) => void;

/** Runtime, generation, and chat-card presentation ports for one enhancement. */
export function mobileImagePromptEnhancementPorts(
  params: GenerateImageParams,
  setState: EnhancementStateWriter,
): ConstructorParameters<typeof ImagePromptEnhancementService>[0] {
  const conversationId = params.conversationId;
  let temporaryMessageId: string | null = null;
  return {
    inspectText() {
      return {
        selected: !!selectedTextModelId(),
        remote: mobileTextEngineControl.isRemoteActive(),
        resident: mobileTextEngineControl.isReady(),
      };
    },
    async loadSelectedText() {
      const modelId = selectedTextModelId();
      if (!modelId) throw new Error('No text model is selected');
      await mobileResidencyIntents.ensureText(modelId);
    },
    generate(messages, onText) {
      return executeMobileText(
        messages.map(message => ({ role: message.role, content: message.content })),
        { onText },
      );
    },
    async stopGeneration() {
      await mobileTextEngineControl.stopActive();
    },
    onStatus(status) {
      setState(status === 'loading-model'
        ? 'Loading text model to enhance prompt...'
        : PROMPT_ENHANCEMENT_STATUS);
    },
    onStarted() {
      if (!conversationId) return;
      temporaryMessageId = useChatStore.getState().addMessage(conversationId, {
        role: 'assistant',
        content: PROMPT_ENHANCEMENT_STATUS,
        isThinking: true,
      }).id;
    },
    onPartial(text) {
      if (!conversationId || !temporaryMessageId) return;
      const chat = useChatStore.getState();
      chat.updateMessageThinking(conversationId, temporaryMessageId, false);
      chat.updateMessageContent(
        conversationId,
        temporaryMessageId,
        buildEnhancementCardContent(text),
      );
    },
    onCompleted(prompt) {
      if (!conversationId || !temporaryMessageId) return;
      const chat = useChatStore.getState();
      chat.updateMessageThinking(conversationId, temporaryMessageId, false);
      chat.updateMessageContent(
        conversationId,
        temporaryMessageId,
        buildEnhancementCardContent(prompt),
      );
    },
    onDiscarded() {
      if (conversationId && temporaryMessageId) {
        useChatStore.getState().deleteMessage(conversationId, temporaryMessageId);
      }
    },
    onSkipped: reportEnhancementSkipped,
    onFailure(error) {
      logger.warn('[ImageGen] Prompt enhancement boundary failed:', error);
    },
  };
}

/** Mobile is a native/runtime and presentation adapter for the Shared enhancement use case. */
export async function enhanceImagePrompt(
  params: GenerateImageParams,
  setState: EnhancementStateWriter,
): Promise<string> {
  const conversationId = params.conversationId;
  const service = imagePromptEnhancement(mobileImagePromptEnhancementPorts(params, setState));

  return service.enhance({
    prompt: params.prompt,
    enabled: useAppStore.getState().settings.enhanceImagePrompts,
    context: conversationId
      ? getConversationContext(conversationId).map(message => ({
          role: message.role as 'user' | 'assistant',
          content: message.content,
        }))
      : [],
  });
}
