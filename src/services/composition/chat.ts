// Composition root: the shared chat session, its operation and context services, context
// compaction, intent classification, and prompt enhancement over Mobile's store and runtime ports.
import {
  ChatContextApplicationService,
  ChatOperationApplicationService,
  ChatSessionService,
  ContextCompactionService,
  GenerationIntentService,
  ImagePromptEnhancementService,
  type CompactableGenerationMessage,
} from '@offgrid/models';
import { once } from '@offgrid/models';
import type { ModelsChatPlatformPort } from '@offgrid/application';

const chatPorts = (): typeof import('../adapters/models/mobileChatHostPort') =>
  require('../adapters/models/mobileChatHostPort') as typeof import('../adapters/models/mobileChatHostPort');

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports2 = (): typeof import('../contextCompaction') =>
  require('../contextCompaction') as typeof import('../contextCompaction');

export const chatOperation = once(() => new ChatOperationApplicationService(chatPorts().mobileChatOperationPorts()));
export const chatContext = once(() => new ChatContextApplicationService(chatPorts().mobileChatContextPorts()));
export const chatSession = once(() => new ChatSessionService(
  ...chatPorts().mobileChatSessionPorts(
    {
      augment: ({ identity, signal }) => chatContext().compose({
        conversationId: identity.conversationId,
        projectId: identity.projectId,
        signal,
      }),
    },
    {
      resolve: input => chatOperation().resolve(
        chatPorts().mobileChatOperationCommand(input),
      ),
    },
  ),
));
export const modelsChatPort: ModelsChatPlatformPort = {
  snapshot: () => chatPorts().mobileChatQueueSnapshot(),
  subscribe: listener => chatPorts().subscribeMobileChatQueue(listener),
  events: listener => chatPorts().subscribeMobileChatSessionEvents(listener),
  send: command => chatSession().send(command),
  regenerate: command => chatSession().regenerate(command),
  edit: command => chatSession().edit(command),
  stop: (turnId, reason) => chatSession().stop(turnId, reason),
  stopConversation: (conversationId, reason) =>
    chatSession().stopConversation(conversationId, reason),
  invalidate: conversationId => chatPorts().invalidateMobileChatSession(conversationId),
};
export const contextCompaction = once(
  () => new ContextCompactionService<CompactableGenerationMessage>(ports2().mobileContextCompactionPorts()),
);
export const generationIntent = once(() => new GenerationIntentService());
/** One enhancement service per request; its ports carry that request's chat card. */
export function imagePromptEnhancement(
  ports: ConstructorParameters<typeof ImagePromptEnhancementService>[0],
): ImagePromptEnhancementService {
  return new ImagePromptEnhancementService(ports);
}
