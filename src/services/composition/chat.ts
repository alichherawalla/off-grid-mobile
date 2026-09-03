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
import {
  mobileChatContextPorts,
  mobileChatOperationPorts,
  mobileChatSessionPorts,
} from '../../screens/ChatScreen/mobileChatSession';
import { mobileContextCompactionPorts } from '../contextCompaction';
import { once } from './once';

export const chatOperation = once(() => new ChatOperationApplicationService(mobileChatOperationPorts()));
export const chatContext = once(() => new ChatContextApplicationService(mobileChatContextPorts()));
export const chatSession = once(() => new ChatSessionService(...mobileChatSessionPorts()));
export const contextCompaction = once(
  () => new ContextCompactionService<CompactableGenerationMessage>(mobileContextCompactionPorts()),
);
export const generationIntent = once(() => new GenerationIntentService());
/** One enhancement service per request; its ports carry that request's chat card. */
export function imagePromptEnhancement(
  ports: ConstructorParameters<typeof ImagePromptEnhancementService>[0],
): ImagePromptEnhancementService {
  return new ImagePromptEnhancementService(ports);
}
