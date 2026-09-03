import {
  CHAT_GENERATION_RECLAIM_POLICY,
  modelsFailureMessage,
  type ChatQueueProjection,
  type ChatTurn,
  type GenerationOperation,
  type Outcome,
  type ModelsFailure,
} from '@offgrid/application';
import { applicationFacade } from '../../services/applicationFacade';
import {
  mobileChatRequestDefaults,
  mobileGenerationMessage,
  prepareMobileChatMessage,
  withMobileChatCommandOptions,
  type MobileChatCommandOptions,
} from '../../services/adapters/models/mobileChatHostPort';
import { registerMobileChatSessionControl } from '../../services/modelServices/chatSessionControl';
import { useChatStore } from '../../stores';
import type { Message } from '../../types';

export type { MobileChatCommandOptions } from '../../services/adapters/models/mobileChatHostPort';
export { projectClassifierFailure } from '../../services/adapters/models/mobileChatHostPort';

registerMobileChatSessionControl({
  stopActive: () => applicationFacade().models.chat.stop(),
  stopConversation: conversationId =>
    applicationFacade().models.chat.stopConversation(conversationId),
});

/** Application lifecycle step. Shared owns the reclaim rule; Mobile supplies the runtime port. */
export async function prepareMobileChatGeneration(): Promise<void> {
  const outcome = await applicationFacade().models.reclaim(CHAT_GENERATION_RECLAIM_POLICY);
  if (!outcome.ok) throw outcome.failure;
}

function requireChatTurn(outcome: Outcome<ChatTurn, ModelsFailure>): ChatTurn {
  if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
  return outcome.value;
}

export const mobileChatSession = {
  /** Execute a user row that Mobile has already persisted. */
  async sendPersisted(
    conversationId: string,
    turnId: string,
    options: MobileChatCommandOptions = {},
  ): Promise<ChatTurn> {
    const conversation = useChatStore
      .getState()
      .conversations.find(candidate => candidate.id === conversationId);
    const message = prepareMobileChatMessage(conversationId, turnId);
    if (!message || message.role !== 'user')
      throw new Error(`Chat turn not found: ${turnId}`);
    const recordedOperation: GenerationOperation | undefined =
      options.imageMode === 'force'
        ? { type: 'image', prompt: message.content }
        : options.imageMode === 'disabled'
        ? { type: 'text' }
        : undefined;
    return withMobileChatCommandOptions(turnId, options, async () =>
      requireChatTurn(await applicationFacade().models.chat.send({
        conversationId,
        turnId,
        projectId: conversation?.projectId,
        userMessage: mobileGenerationMessage(message),
        operation: recordedOperation,
        request: mobileChatRequestDefaults(),
      })),
    );
  },

  async regenerate(
    conversationId: string,
    turnId: string,
    input?:
      | GenerationOperation
      | {
          operation?: GenerationOperation;
          options?: MobileChatCommandOptions;
        },
  ): Promise<ChatTurn> {
    const operation = input && 'type' in input ? input : input?.operation;
    const options = input && 'type' in input ? {} : input?.options ?? {};
    applicationFacade().models.chat.invalidate(conversationId);
    return withMobileChatCommandOptions(turnId, options, async () =>
      requireChatTurn(await applicationFacade().models.chat.regenerate({
        conversationId,
        turnId,
        operation,
        request: mobileChatRequestDefaults(),
      })),
    );
  },

  async edit(
    conversationId: string,
    turnId: string,
    message: Message,
  ): Promise<ChatTurn> {
    applicationFacade().models.chat.invalidate(conversationId);
    return requireChatTurn(await applicationFacade().models.chat.edit({
      conversationId,
      turnId,
      userMessage: mobileGenerationMessage(message),
      request: mobileChatRequestDefaults(),
    }));
  },

  stop: (): boolean => applicationFacade().models.chat.stop(),

  stopConversation: (conversationId: string): number =>
    applicationFacade().models.chat.stopConversation(conversationId),

  clearQueued: (): void => applicationFacade().models.chat.clearQueued(),

  subscribeQueue(listener: (projection: ChatQueueProjection) => void): () => void {
    const chat = applicationFacade().models.chat;
    listener(chat.snapshot());
    return chat.subscribe(listener);
  },

  invalidate: (conversationId: string): void =>
    applicationFacade().models.chat.invalidate(conversationId),
};
