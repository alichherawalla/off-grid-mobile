// Composition root: the shared chat session, its operation and context services, context
// compaction, intent classification, and prompt enhancement over Mobile's store and runtime ports.
import {
  ChatContextApplicationService,
  ChatOperationApplicationService,
  ChatSessionService,
  ContextCompactionService,
  GenerationIntentService,
  ImagePromptEnhancementService,
  once,
  type CompactableGenerationMessage,
} from '@offgrid/models';
import type { ModelsChatPlatformPort } from '@offgrid/application';
import {
  invalidateMobileChatSession,
  mobileChatContextPorts,
  mobileChatOperationCommand,
  mobileChatOperationPorts,
  mobileChatQueueSnapshot,
  mobileChatSessionPorts,
  subscribeMobileChatQueue,
  subscribeMobileChatSessionEvents,
} from '../adapters/models/mobileChatHostPort';
import { mobileContextCompactionPorts } from '../contextCompactionPorts';

export const contextCompaction = once(
  () => new ContextCompactionService<CompactableGenerationMessage>(mobileContextCompactionPorts()),
);
export const generationIntent = once(() => new GenerationIntentService());
export const chatOperation = once(
  () => new ChatOperationApplicationService(mobileChatOperationPorts(generationIntent())),
);
export const chatContext = once(() => new ChatContextApplicationService(mobileChatContextPorts()));
export const chatSession = once(() => new ChatSessionService(
  ...mobileChatSessionPorts(
    {
      augment: ({ identity, signal }) => chatContext().compose({
        conversationId: identity.conversationId,
        projectId: identity.projectId,
        signal,
      }),
    },
    {
      resolve: input => chatOperation().resolve(
        mobileChatOperationCommand(input),
      ),
    },
    contextCompaction(),
  ),
));
export const modelsChatPort: ModelsChatPlatformPort = {
  snapshot: () => mobileChatQueueSnapshot(),
  subscribe: listener => subscribeMobileChatQueue(listener),
  events: listener => subscribeMobileChatSessionEvents(listener),
  send: command => chatSession().send(command),
  regenerate: command => chatSession().regenerate(command),
  edit: command => chatSession().edit(command),
  stop: (turnId, reason) => chatSession().stop(turnId, reason),
  stopConversation: (conversationId, reason) =>
    chatSession().stopConversation(conversationId, reason),
  invalidate: conversationId => invalidateMobileChatSession(conversationId),
};
/** One enhancement service per request; its ports carry that request's chat card. */
export function imagePromptEnhancement(
  ports: ConstructorParameters<typeof ImagePromptEnhancementService>[0],
): ImagePromptEnhancementService {
  return new ImagePromptEnhancementService(ports);
}
