/**
 * Tool-aware LLM generation helper.
 * Extracted to keep llm.ts under the max-lines limit.
 */

import { useAppStore } from '../stores/appStore';
import {
  IncrementalTaggedBlockFilter,
  normalizeGenerationDelta,
  normalizeNativeToolCall,
  type ReasoningWireFragment,
} from '@offgrid/models';
import type { Message } from '../types';
import type { ToolCall } from './tools/types';
import { recordGenerationStats, buildCompletionParams, safeCompletion, isTruncatedResult } from './llmHelpers';
import type { StreamToken } from './llmStreamTypes';
import logger from '../utils/logger';
import { TOOL_CALL_OPENERS, TOOL_CALL_CLOSERS } from '../utils/messageContent';

type ToolStreamCallback = (data: StreamToken) => void;
type ToolCompleteCallback = (fullResponse: string, reasoningContent: string) => void;

/**
 * Suppresses Gemma 4's native tool call tokens from the visible text stream.
 * Gemma 4 wraps tool calls in <|tool_call>...<tool_call|> (and the colon form
 * <tool_call:NAME…, closed by <tool_call|> or </tool_call>) — llama.rn parses the
 * structured call fine, but the raw tokens still flow through data.token. This filter
 * buffers the stream and drops everything inside those tags.
 *
 * The opener/closer set is the SHARED grammar (TOOL_CALL_OPENERS/CLOSERS in messageContent)
 * that the stored-content stripper also uses — so the live filter and the stripper cannot
 * disagree about which formats are tool markup (DR7). Exported for direct testing.
 */
export class ToolCallTokenFilter extends IncrementalTaggedBlockFilter {
  constructor() {
    super(TOOL_CALL_OPENERS, TOOL_CALL_CLOSERS);
  }
}

/**
 * Parse a tool call's `arguments` JSON string into an object, tolerating the smart/curly quotes some
 * local models emit as string delimiters. Plain JSON.parse rejects `{"expression":"7 * 7"}` (curly
 * double quotes) → args became `{}` → the tool got an EMPTY call → schema validation failed → the
 * model retried the same call in a loop until it happened to emit straight quotes (device 2026-07-15).
 * We try strict JSON first (unchanged for the common case), then retry once with curly double quotes
 * normalized to straight. Zero-IO; exercised through generateWithToolsImpl in tests.
 */
function parseToolCall(tc: any): ToolCall {
  const normalized = normalizeNativeToolCall(tc);
  return { id: normalized.id, name: normalized.name, arguments: normalized.arguments };
}

export interface ToolGenerationDeps {
  context: any;
  isGenerating: boolean;
  disableCtxShift: boolean;
  manageContextWindow: (messages: Message[], extraReserve?: number) => Promise<Message[]>;
  /** Async because it also drops images whose file is gone — see LLMService.convertToOAIMessages. */
  convertToOAIMessages: (messages: Message[]) => Promise<any[]>;
  setPerformanceStats: (stats: any) => void;
  setIsGenerating: (v: boolean) => void;
}

export async function generateWithToolsImpl(
  deps: ToolGenerationDeps,
  messages: Message[],
  options: { tools: any[]; onStream?: ToolStreamCallback; onComplete?: ToolCompleteCallback; reasoningWire?: ReasoningWireFragment },
): Promise<{ fullResponse: string; toolCalls: ToolCall[]; interrupted?: boolean }> {
  if (!deps.context) throw new Error('No model loaded');
  if (deps.isGenerating) throw new Error('Generation already in progress');
  deps.setIsGenerating(true);

  // Mutable flag for the streaming callback (deps.isGenerating is a stale copy)
  let generating = true;

  try {
    // Reserve context space for tool schemas (~100 tokens per tool)
    const toolTokenReserve = options.tools.length * 100;
    const managed = await deps.manageContextWindow(messages, toolTokenReserve);
    const oaiMessages = await deps.convertToOAIMessages(managed);
    const { settings } = useAppStore.getState();
    const startTime = Date.now();
    let firstTokenMs = 0;
    let tokenCount = 0;
    let fullResponse = '';
    let fullReasoning = '';
    let streamedContentSoFar = '';
    let streamedReasoningSoFar = '';
    let firstReceived = false;
    const collectedToolCalls: ToolCall[] = [];
    // Gemma 4 emits <|tool_call>...<tool_call|> tokens in the stream; filter them out.
    const toolCallFilter = new ToolCallTokenFilter();

    const completionParams = {
      messages: oaiMessages,
      ...buildCompletionParams(settings, { disableCtxShift: deps.disableCtxShift }),
      tools: options.tools,
      tool_choice: 'auto',
      ...(options.reasoningWire ?? {}),
    };
    logger.log('[LLM-Tools] === INPUT ===');
    logger.log(JSON.stringify(completionParams, null, 2));
    const completionResult: any = await safeCompletion(deps.context, () => deps.context.completion(completionParams as any, (data: any) => {
      if (!generating) return;
      if (data.tool_calls) {
        for (const tc of data.tool_calls) {
          collectedToolCalls.push(parseToolCall(tc));
        }
      }
      if (!data.token) return;
      if (!firstReceived) { firstReceived = true; firstTokenMs = Date.now() - startTime; }
      tokenCount++;
      // Consume the SAME structured fields the runtime returns as the plain path does: with
      // reasoning_format=auto llama separates the reasoning into reasoning_content and the clean answer
      // into content. Route each to its own channel so the thinking block renders and the raw
      // <|channel> markers (data.token) never leak into the answer. (The tool path previously appended
      // data.token verbatim, so gemma's reasoning + its <|channel> delimiters landed in the reply.)
      const normalized = normalizeGenerationDelta(data, {
        content: streamedContentSoFar,
        reasoning: streamedReasoningSoFar,
      });
      const contentPiece = normalized.content;
      const reasoningPiece = normalized.reasoning;
      if (data.content) streamedContentSoFar = data.content;
      else if (!data.reasoning_content && data.token) streamedContentSoFar += data.token;
      if (data.reasoning_content) streamedReasoningSoFar = data.reasoning_content;
      if (reasoningPiece) { fullReasoning += reasoningPiece; options.onStream?.({ reasoningContent: reasoningPiece }); }
      if (contentPiece) {
        const visible = toolCallFilter.process(contentPiece);
        fullResponse += visible;
        if (visible) options.onStream?.({ content: visible });
      }
    }), 'generateWithTools');
    logger.log('[LLM-Tools] === OUTPUT ===');
    logger.log(JSON.stringify(completionResult, null, 2));
    // [WIRE] full tool-generation input+output on ONE tagged line so the lossless wire file captures the
    // whole payload (the pretty-printed dumps above are separate untagged lines the tee can't match).
    logger.log(`[WIRE-LLAMA-TOOL] ${JSON.stringify({ input: completionParams, output: completionResult })}`);

    const cr = completionResult;
    logger.log(`[LLM-Tools] Completion done: streamed=${tokenCount} tokens, response="${fullResponse.substring(0, 100)}"`);
    logger.log(`[LLM-Tools] Result: predicted=${cr?.tokens_predicted}, evaluated=${cr?.tokens_evaluated}, context_full=${cr?.context_full}, stopped_eos=${cr?.stopped_eos}`);
    logger.log(`[LLM-Tools] Result text="${(cr?.text || '').substring(0, 200)}", content="${(cr?.content || '').substring(0, 200)}"`);

    // If streaming didn't capture tokens, fall back to the CLEAN parsed content — NEVER cr.text, which
    // carries the raw <|channel>thought…<channel|> reasoning markers. reasoning falls back likewise.
    if (!fullResponse) {
      fullResponse = cr?.content ?? cr?.text ?? '';
      tokenCount = cr?.tokens_predicted || tokenCount;
      logger.log(`[LLM-Tools] Using completionResult.content as response (${fullResponse.length} chars)`);
    }
    // The reasoning the user sees: prefer the runtime's parsed reasoning_content, else what streamed.
    const finalReasoning = (typeof cr?.reasoning_content === 'string' && cr.reasoning_content) || fullReasoning;

    // Prefer completionResult tool_calls over streamed ones — streaming may
    // deliver partial tool calls (name only, no arguments) while the final
    // result contains the complete tool call data.
    const resultToolCalls = cr?.tool_calls;
    if (resultToolCalls?.length) {
      collectedToolCalls.length = 0;
      for (const tc of resultToolCalls) {
        collectedToolCalls.push(parseToolCall(tc));
      }
      logger.log(`[LLM-Tools] Using ${collectedToolCalls.length} tool call(s) from completionResult`);
    }

    deps.setPerformanceStats({
      ...recordGenerationStats(startTime, firstTokenMs, tokenCount),
      // Flag a reply cut off at the n_predict cap so the UI can show it (B15) — but NOT a user stop
      // (interrupted), which also has stopped_eos:false. Single verdict shared with the plain path.
      lastTruncated: isTruncatedResult(cr),
    });
    generating = false;
    deps.setIsGenerating(false);
    if (cr?.context_full) {
      logger.log('[LLM-Tools] Context full detected — signalling for compaction');
      throw new Error('Context is full');
    }
    options.onComplete?.(fullResponse, finalReasoning);
    // Surface a native interrupt (user stop landing mid-completion) to the caller — the tool
    // loop must treat it as a STOPPED turn, never as a normal empty result (which re-ran a
    // full no-tools generation after the stop: the zombie that held the engine and made every
    // next send fail 'LLM service busy', and whose empty output painted the wrong
    // "No response / incompatible backend" card).
    return { fullResponse, toolCalls: collectedToolCalls, interrupted: cr?.interrupted === true };
  } catch (error) {
    generating = false;
    deps.setIsGenerating(false);
    throw error;
  }
}
