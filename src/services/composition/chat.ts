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
import { once } from './once';

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports1 = (): typeof import('../../screens/ChatScreen/mobileChatSession') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../screens/ChatScreen/mobileChatSession') as typeof import('../../screens/ChatScreen/mobileChatSession');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports2 = (): typeof import('../contextCompaction') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../contextCompaction') as typeof import('../contextCompaction');

export const chatOperation = once(() => new ChatOperationApplicationService(ports1().mobileChatOperationPorts()));
export const chatContext = once(() => new ChatContextApplicationService(ports1().mobileChatContextPorts()));
export const chatSession = once(() => new ChatSessionService(...ports1().mobileChatSessionPorts()));
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
