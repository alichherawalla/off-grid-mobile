import { useAppStore } from '../stores';
import { llmService } from './llm';
import { liteRTService } from './litert';
import { isLiteRTModel, type DownloadedModel } from '../types';
import type { RuntimeModel } from '@offgrid/models';
import logger from '../utils/logger';
import { activeMobileRoute } from './modelServices/mobileLLMService';

/** Every text-generation engine, defined ONCE here so callers never hardcode the concrete set. */
const TEXT_ENGINES = [liteRTService, llmService];

/** What the active text model can do, resolved once so callers never branch on the concrete engine. */
export interface EngineCapabilities {
  vision: boolean;
  audio: boolean;
  tools: boolean;
  thinking: boolean;
}

/** Thin presentation projection of capabilities already owned by the shared runtime model. */
export function engineCapabilitiesFromRuntime(model: RuntimeModel | null): EngineCapabilities {
  return model ? {
    vision: !!model.capabilities.vision,
    audio: !!model.capabilities.audioInput,
    tools: !!model.capabilities.tools,
    thinking: !!model.capabilities.thinking,
  } : { vision: false, audio: false, tools: false, thinking: false };
}

/**
 * Unload every text engine (an idle engine is a safe no-op). Used on a model switch so a
 * cross-engine swap (LiteRT <-> llama) can't leave the previous model resident, without the
 * caller branching on which concrete engine held it. Adding an engine is one entry above (OCP).
 */
export async function unloadAllTextEngines(): Promise<void> {
  for (const engine of TEXT_ENGINES) {
    try {
      await engine.unloadModel();
    } catch (e) {
      logger.warn('[engines] text engine unload during switch failed, continuing:', e);
    }
  }
}

/**
 * Stop generation on every text engine. The engine SET is owned here (TEXT_ENGINES), so callers never
 * enumerate llmService/liteRTService themselves — adding an engine changes only this file (OCP). Used by the
 * defensive stop path; llama's stopCompletion and litert's stopGeneration differ at the native layer but are
 * uniform through this one call.
 */
export async function stopAllTextEngines(): Promise<void> {
  const engine = getActiveEngineService();
  if (!engine) return;
  try {
    await engine.stopGeneration();
  } catch {
    /* best-effort: a stale/idle engine may reject */
  }
}

/**
 * Give the active local engine an awaited conversation boundary before generation.
 * LiteRT already keys and rebuilds its native Conversation in prepareConversation();
 * llama implements this optional seam to clear its shared KV/recurrent state.
 */
export async function prepareActiveConversation(conversationId: string): Promise<void> {
  const engine = getActiveEngineService();
  await (engine as { prepareConversationBoundary?: (id: string) => Promise<void> } | null)
    ?.prepareConversationBoundary?.(conversationId);
}

/**
 * Invalidate the active engine's cached conversation state before a history rewind (regenerate/
 * edit). LiteRT keeps a native per-conversation KV cache that must be reset; llama has none.
 * Dispatched via the registry so callers don't branch on engine === 'litert'.
 */
export function invalidateActiveConversation(): void {
  const engine = getActiveEngineService();
  (engine as { invalidateConversation?: () => void } | null)?.invalidateConversation?.();
}

/**
 * Is this LOCAL text model actually resident on its engine? The per-engine readiness predicate
 * in ONE place: LiteRT tracks only "a model is loaded"; llama must have the SELECTED model's path
 * loaded (a different llama model resident is NOT ready). Callers pass their own model and use
 * this instead of branching on engine === 'litert' for readiness.
 */
export function isModelReady(model: { id?: string; engine?: string; filePath?: string } | null | undefined): boolean {
  const active = activeMobileRoute('text').model;
  if (!model || !active || active.source !== 'local' || active.id !== model.id) return false;
  return active.providerId === 'litert'
    ? liteRTService.isModelLoaded()
    : llmService.isModelLoaded() && llmService.getLoadedModelPath() === model.filePath;
}

/**
 * Whether a LOCAL model can accept an image RIGHT NOW — record-based, so it's valid BEFORE the model
 * loads (used to gate image sends). llama needs a present projector (mmProjPath); LiteRT carries vision in
 * the bundle (the liteRTVision flag). A missing/absent projector means the native completion would throw
 * "Multimodal support not enabled" — so the send must be blocked here, not sent and crashed (device 2026-07-14).
 */
export function localModelAcceptsImages(model: DownloadedModel | null | undefined): boolean {
  if (!model) return false;
  return isLiteRTModel(model) ? !!model.liteRTVision : !!model.mmProjPath;
}

/**
 * A user-facing notice when a just-loaded LOCAL text model silently downgraded its backend
 * (GPU selected, 0 layers offloaded — the device-reported "Backend=GPU but meta says CPU" class).
 * Engine-dispatched here so callers never branch: LiteRT reports its backend through its own
 * load result, so only the llama engine carries this verdict. Null = nothing to report.
 */
export function backendFallbackNotice(model: { engine?: string } | null | undefined): string | null {
  if (!model || model.engine === 'litert') return null;
  return llmService.getBackendFallbackNotice();
}

/**
 * Live capabilities of the ACTIVE text model (remote OR local), read from the running services
 * and read from the canonical shared runtime model. The imperative counterpart to the
 * pure fn: every caller (generation routing, UI capability flags) uses THIS instead of poking
 * llmService / liteRTService directly or branching on engine === 'litert' — so a concrete engine
 * service never has to be imported into a screen (DIP). Adding a backend = extend
 * shared runtime inventory, not the callers (OCP).
 * `thinking` here is CAPABILITY (does the model support it — drives the UI toggle), not "enabled
 * this turn"; the per-turn enablement lives in wantsLeadingThinkToken.
 */
export function activeTextCapabilities(_i: {
  isRemote: boolean;
  remoteCaps?: unknown;
  model: DownloadedModel | null | undefined;
}): EngineCapabilities {
  const active = activeMobileRoute('text').model;
  return engineCapabilitiesFromRuntime(active);
}

/** Local-only convenience for the generation routing path (no remote); reads .tools/.vision. */
export function activeLocalTextCapabilities(model: DownloadedModel | null | undefined): EngineCapabilities {
  const active = activeMobileRoute('text').model;
  if (!model || !active || active.source !== 'local' || active.id !== model.id) {
    return { vision: false, audio: false, tools: false, thinking: false };
  }
  return activeTextCapabilities({ isRemote: false, model });
}

/** Is the native LiteRT runtime available on this device? Exposed here so UI (e.g. import-file
 *  validation) asks the engine registry instead of importing the concrete liteRTService (DIP). */
export function isLiteRTAvailable(): boolean {
  return liteRTService.isAvailable();
}

/**
 * Should a leading Gemma-4 `<|think|>` token be prepended to activate thinking for THIS turn?
 * The engine-specific detection lives here (the seam), not in the caller: LiteRT relies on the
 * turn's thinkingEnabled flag; llama introspects the loaded model (isGemma4Model + thinking on).
 * Remote never gets it. Callers pass their model + flags and never name a concrete engine.
 */
export function wantsLeadingThinkToken(
  model: DownloadedModel | null | undefined,
  opts: { isRemote: boolean },
): boolean {
  const active = activeMobileRoute('text').model;
  if (opts.isRemote || !active || active.source !== 'local' || active.id !== model?.id) return false;
  // Read the thinking setting FRESH from the store here — NOT from a value threaded in by the caller.
  // The caller's copy comes from a React render snapshot (genDeps.settings) that lags by one render on a
  // resend, which made the `<|think|>` activation follow the PREVIOUS toggle state → thinking was off-by-one
  // (device 2026-07-14). Both engines now decide from the live value, so a toggle applies to the next turn.
  const thinkingEnabled = useAppStore.getState().settings.thinkingEnabled;
  return active.providerId === 'litert' && liteRTService.isModelLoaded()
    ? thinkingEnabled
    : llmService.isGemma4Model() && llmService.isThinkingEnabled();
}

/**
 * Returns the service for the currently active text engine, or null if no
 * model is loaded. Use this for operations that both engines support
 * (stopGeneration, isModelLoaded, unloadModel). For engine-specific
 * operations keep the explicit branch — it should be visible at the call site.
 */
export function getActiveEngineService(): typeof llmService | typeof liteRTService | null {
  const model = activeMobileRoute('text').model;
  if (!model || model.source !== 'local') return null;
  return model.providerId === 'litert' ? liteRTService : llmService;
}

/**
 * Is a REMOTE (gateway / OpenAI-compatible) text model the ACTIVE text engine right now?
 *
 * THE single source of truth for "route text to a remote provider" — the exact rule
 * generationService.isUsingRemoteProvider re-derived and generateStandalone used to inline.
 * A remote model is active iff: a server is selected, its provider is actually REGISTERED (not
 * just persisted from a prior session), and NO local model is loaded (a loaded local model always
 * wins). Callers depend on this predicate instead of re-checking the store + registry + llmService
 * themselves, so "is remote active" lives in ONE place (DIP/DRY). Adding a backend never touches a
 * caller's readiness check.
 */
export function isRemoteTextModelActive(): boolean {
  return activeMobileRoute('text').model?.source === 'remote';
}
