import { buildThinkingCompletionParams } from './llmHelpers';

/**
 * Per-call overrides for a constrained, capped generation.
 *
 * Separate from `llmHelpers` because these are not general helpers: they exist for background,
 * structured work (summaries, extraction) where the SHAPE of the output matters more than its prose,
 * and where the caller is a machine rather than a person watching tokens arrive.
 */

/** Opts for a constrained, capped generation (see llmService.generateWithMaxTokens). */
export interface ConstrainedCompletionOpts {
  /** GBNF grammar. Constrained decoding, so the output SHAPE is guaranteed rather than hoped for.
   *  Measured on a 270M model: 0-2% parseable from the prompt alone, 100% under grammar.
   *  llama.rn only - LiteRT and remote backends ignore it, so a lenient parser is still required. */
  grammar?: string;
  /** Overrides the user's global repeat penalty for one call. Small models loop on noisy input. */
  repeatPenalty?: number;
  /** Reasoning OFF. It competes with a hard output cap: verified on gemma4-e2b, a capped structured
   *  request spent its whole budget reasoning and returned an EMPTY response (done_reason: length). */
  disableThinking?: boolean;
}

/**
 * The per-call overrides for a constrained generation, as llama.cpp completion params. Applied AFTER
 * the settings spread by the caller, so an omitted field leaves the user's own setting untouched.
 */
export function buildConstrainedCompletionParams(opts?: ConstrainedCompletionOpts): Record<string, unknown> {
  if (!opts) return {};
  return {
    ...(opts.grammar ? { grammar: opts.grammar } : {}),
    ...(opts.repeatPenalty != null ? { penalty_repeat: opts.repeatPenalty } : {}),
    ...(opts.disableThinking ? buildThinkingCompletionParams(false) : {}),
  };
}
