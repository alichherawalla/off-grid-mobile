/** Mobile ports for the shared context-compaction application service. */
import { ContextCompactionService } from '@offgrid/models';
import { llmService } from './llm';
import { executeMobileText } from './mobileSidecarGeneration';
import { useChatStore } from '../stores/chatStore';
import type { Message } from '../types';
import logger from '../utils/logger';

const sharedCompaction = new ContextCompactionService<Message>({
  clearContext: () => llmService.clearKVCache(true),
  contextLength: () => llmService.getPerformanceSettings().contextLength || 2048,
  countTokens: text => llmService.getTokenCount(text),
  summarize: (messages, maxTokens) => executeMobileText([...messages], { maxTokens }),
  persist: (conversationId, summary, cutoffMessageId) => {
    useChatStore.getState().updateCompactionState(conversationId, summary, cutoffMessageId);
  },
  systemMessage: content => ({ id: 'system', role: 'system', content, timestamp: 0 }),
  summaryMessage: content => ({
    id: 'compaction-summary',
    role: 'assistant',
    content: `[Previous conversation summary]\n${content}`,
    timestamp: 0,
  }),
  report: (event, detail) => {
    if (event === 'summary-failed') logger.warn('[ContextCompaction] Summarization failed, using trim-only:', detail);
    else logger.log(`[ContextCompaction] ${event}`, detail ?? '');
  },
});

/** Compatibility facade. It contains ports only; Shared owns all workflow and state. */
export const contextCompactionService = {
  get isCompacting(): boolean { return sharedCompaction.isCompacting; },
  subscribeCompacting: (listener: (active: boolean) => void) => sharedCompaction.subscribe(listener),
  signalCompacting: (active: boolean) => sharedCompaction.setExternalCompacting(active),
  isContextFullError: (error: unknown) => sharedCompaction.isCapacityError(error),
  compact: (input: {
    conversationId: string;
    systemPrompt: string;
    allMessages: Message[];
    previousSummary?: string;
    protectedTailCount?: number;
  }) => sharedCompaction.compact(input),
  clearSummary: (conversationId: string) => sharedCompaction.clear(conversationId),
};
