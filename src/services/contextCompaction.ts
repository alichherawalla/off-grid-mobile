/** Mobile ports for the shared context-compaction application service. */
import {
  type ChatCompactionContext,
  type CompactableGenerationMessage,
  type GenerationMessage,
} from '@offgrid/models';
import type { ContextCompactionService } from '@offgrid/models';
import { contextCompaction } from './composition/chat';
import { llmService } from './llm';
import { executeMobileText } from './mobileSidecarGeneration';
import { useChatStore } from '../stores/chatStore';
import { APP_CONFIG } from '../constants';
import logger from '../utils/logger';

/** Native context window, token count, generation, and store ports. Shared owns the plan. */
export function mobileContextCompactionPorts(): ConstructorParameters<typeof ContextCompactionService<CompactableGenerationMessage>>[0] {
  return {
  clearContext: () => llmService.clearKVCache(true),
  contextLength: () => llmService.getPerformanceSettings().contextLength || 2048,
  countTokens: text => llmService.getTokenCount(text),
  summarize: (messages, maxTokens) => executeMobileText([...messages], { maxTokens }),
  persist: (conversationId, summary, cutoffMessageId) => {
    useChatStore.getState().updateCompactionState(conversationId, summary, cutoffMessageId);
  },
  systemMessage: content => ({ id: 'system', role: 'system', content }),
  summaryMessage: content => ({
    id: 'compaction-summary',
    role: 'assistant',
    content: `[Previous conversation summary]\n${content}`,
  }),
  report: (event, detail) => {
    if (event === 'summary-failed') logger.warn('[ContextCompaction] Summarization failed, using trim-only:', detail);
    else logger.log(`[ContextCompaction] ${event}`, detail ?? '');
  },
};
}

const sharedCompaction = (): ContextCompactionService<CompactableGenerationMessage> => contextCompaction();

/** Compatibility facade. It contains ports only; Shared owns all workflow and state. */
export const contextCompactionService = {
  get isCompacting(): boolean { return sharedCompaction().isCompacting; },
  subscribeCompacting: (listener: (active: boolean) => void) => sharedCompaction().subscribe(listener),
  signalCompacting: (active: boolean) => sharedCompaction().setExternalCompacting(active),
  isContextFullError: (error: unknown) => sharedCompaction().isCapacityError(error),
  /** Compact the exact prompt that overflowed; the previous summary comes from the conversation. */
  compactChat: (context: ChatCompactionContext): Promise<GenerationMessage[]> =>
    sharedCompaction().compactChat(context, {
      previousSummary: useChatStore
        .getState()
        .conversations.find(candidate => candidate.id === context.identity.conversationId)
        ?.compactionSummary,
      defaultSystemPrompt: APP_CONFIG.defaultSystemPrompt,
    }),
  clearSummary: (conversationId: string) => sharedCompaction().clear(conversationId),
};
