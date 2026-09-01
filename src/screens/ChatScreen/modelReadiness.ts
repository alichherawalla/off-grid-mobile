/**
 * Model readiness — the single typed outcome for "is a usable text model loaded
 * for this turn, and if not, WHY".
 *
 * This replaces a `Promise<boolean>` that collapsed five distinct failures
 * (no model selected, model not on disk, out of memory, a load already running,
 * the native load threw) into one opaque `false`. That collapse is why every
 * failure surfaced as the same useless "Failed to load model. Please try again."
 * alert AND why the failure was undiagnosable from logs — the reason was thrown
 * away at the return. With a typed reason: the caller renders the right intent,
 * a [GEN-SM] log line records which branch fired, and a test asserts each one.
 *
 * Single source of truth: the reason->message copy and the error->reason
 * heuristic live here ONCE and every caller reuses them (no per-call-site
 * duplication).
 */

import { AlertState, showAlert } from '../../components';
import type { ChatModelReadyOutcome } from '@offgrid/models';
import logger from '../../utils/logger';
// The error→reason heuristic and reason→copy live in a UI-free module (so the
// service layer can reuse them without dragging the components barrel in). Re-export
// for the many call sites that import them from here.
import { reasonFromLoadError, modelNotReadyAlert } from '@offgrid/models';

export { reasonFromLoadError, modelNotReadyAlert };
;

export type ModelReadyOutcome = ChatModelReadyOutcome;

/** What the readiness resolver needs from the chat screen (structural subset of
 *  GenerationDeps), so this module owns readiness without importing the screen. */
export interface ReadinessDeps {
  activeModelInfo?: { isRemote: boolean };
  activeModel: { engine?: string; filePath: string } | null | undefined;
  activeModelId: string | null;
  /** onLoadedResume: when a turn triggered the load, resume it after a "Load Anyway". */
  ensureModelLoaded: () => Promise<ModelReadyOutcome>;
  forceLoadModel?: () => Promise<ModelReadyOutcome>;
  setAlertState: (a: AlertState) => void;
}

/**
 * Resolve whether a usable text model is loaded for this turn, returning a TYPED
 * outcome (not a bare boolean) so the caller knows WHY it failed and a [GEN-SM]
 * line records the branch. Every exit is explicit — no silent early-return can
 * collapse into a generic "Failed to load model" again.
 */
export async function ensureModelReady(deps: ReadinessDeps, _onLoadedResume?: () => void): Promise<ModelReadyOutcome> {
  const outcome = await deps.ensureModelLoaded();
  if (!outcome.ok) logger.log(`[GEN-SM] ensureModelReady NOT ready reason=${outcome.reason} detail=${outcome.detail ?? ''}`);
  else logger.log('[GEN-SM] ensureModelReady → ready');
  return outcome;
}

/**
 * Resolve readiness and, on failure, log the reason and show the reason-specific
 * alert (unless a lower layer already alerted). The ONE place generation callers
 * turn a not-ready outcome into UI — no duplicated alert logic per call site.
 */
export async function ensureReadyOrAlert(
  deps: ReadinessDeps,
  tag: string,
  /** Re-attempt the turn after the user frees memory. When given, an
   *  insufficient-memory outcome shows a "Retry" button — eviction already ran and
   *  still couldn't fit, so the user closes other apps then retries, and the load
   *  re-reads the now-higher REAL per-process budget. */
  onRetry?: () => void,
): Promise<boolean> {
  // Thread onRetry down so a "Load Anyway" on the insufficient-memory alert resumes the
  // turn after the forced load (the message would otherwise be silently dropped).
  const outcome = await ensureModelReady(deps, onRetry);
  if (outcome.ok) return true;
  logger.log(`[GEN-SM] ${tag} BAIL reason=${outcome.reason} detail=${outcome.detail ?? ''}`);
  const a = modelNotReadyAlert(outcome.reason, outcome.detail);
  const buttons = outcome.forceLoadAllowed && deps.forceLoadModel
    ? [{ text: 'Cancel', style: 'cancel' as const }, {
        text: 'Load Anyway',
        style: 'destructive' as const,
        onPress: () => {
          deps.forceLoadModel!().then(forced => {
            if (forced.ok) onRetry?.();
            else {
              const failure = modelNotReadyAlert(forced.reason, forced.detail);
              deps.setAlertState(showAlert(failure.title, failure.message));
            }
          }).catch(error => logger.error('[GEN-SM] Force load failed:', error));
        },
      }]
    : outcome.reason === 'insufficient-memory' && onRetry
      ? [{ text: 'Cancel', style: 'cancel' as const }, { text: 'Retry', onPress: onRetry }]
      : undefined;
  deps.setAlertState(showAlert(a.title, a.message, buttons));
  return false;
}
