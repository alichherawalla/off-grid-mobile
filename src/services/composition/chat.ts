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

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports1 = (): typeof import('../../screens/ChatScreen/mobileChatSession') =>
  require('../../screens/ChatScreen/mobileChatSession') as typeof import('../../screens/ChatScreen/mobileChatSession');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports2 = (): typeof import('../contextCompaction') =>
  require('../contextCompaction') as typeof import('../contextCompaction');

export const chatOperation = once(() => new ChatOperationApplicationService(ports1().mobileChatOperationPorts()));
export const chatContext = once(() => new ChatContextApplicationService(ports1().mobileChatContextPorts()));
export const chatSession = once(() => new ChatSessionService(
  ...ports1().mobileChatSessionPorts(
    {
      augment: ({ identity, signal }) => chatContext().compose({
        conversationId: identity.conversationId,
        projectId: identity.projectId,
        signal,
      }),
    },
    {
      resolve: input => chatOperation().resolve(
        ports1().mobileChatOperationCommand(input),
      ),
    },
  ),
));
export const modelsChatPort: ModelsChatPlatformPort = {
  snapshot: () => ports1().mobileChatQueueSnapshot(),
  subscribe: listener => ports1().subscribeMobileChatQueue(listener),
  events: listener => ports1().subscribeMobileChatSessionEvents(listener),
  send: command => chatSession().send(command),
  regenerate: command => chatSession().regenerate(command),
  edit: command => chatSession().edit(command),
  stop: (turnId, reason) => chatSession().stop(turnId, reason),
  stopConversation: (conversationId, reason) =>
    chatSession().stopConversation(conversationId, reason),
  invalidate: conversationId => ports1().invalidateMobileChatSession(conversationId),
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
