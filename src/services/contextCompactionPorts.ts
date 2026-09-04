/** Mobile platform ports for the shared context-compaction application service. Port-only. */
import type {
  ChatCompactionContext,
  CompactableGenerationMessage,
  ContextCompactionService,
} from '@offgrid/models';
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

/**
 * The conversation-scoped inputs a compaction run needs from Mobile's stores: the previous
 * summary this conversation already carries, and the app's default system prompt.
 */
export function mobileCompactionOptions(
  context: ChatCompactionContext,
): Parameters<ContextCompactionService<CompactableGenerationMessage>['compactChat']>[1] {
  return {
    previousSummary: useChatStore
      .getState()
      .conversations.find(candidate => candidate.id === context.identity.conversationId)
      ?.compactionSummary,
    defaultSystemPrompt: APP_CONFIG.defaultSystemPrompt,
  };
}
