/**
 * Extensible STT model registry — the seam that lets a model OUTSIDE core's whisper
 * catalogue be a first-class managed model.
 *
 * Why this exists: `ModelDownloadType` is a closed union and the service allows exactly
 * one provider per type, so `sttProvider` is the only thing that can own `'stt'`. It was
 * also hardwired to `whisperService`, which meant any other speech model (Parakeet, run
 * by the sherpa engine in pro) could not be listed as completed, retried, or deleted —
 * retry/remove routed to whisper and silently no-opped. That is the single root cause
 * behind "not in the model list", "not in the Download Manager" and "can't delete".
 *
 * The fix keeps one STT provider and makes it extensible instead: anything can register
 * an `SttModel` here, and `sttProvider` routes list/cancel/retry/remove by id across
 * whisper AND every registered model. Core never learns what a registered model is or
 * where it comes from — the owner passes its behaviour in as hooks, exactly as pro's
 * `ttsProvider` registers itself with `modelDownloadService`. Core must never import pro.
 *
 * Capabilities are DATA, not assumption: a registrant that cannot abort a transfer simply
 * omits `cancel`, and the provider reports `cancel: false` so the UI renders no dead
 * button. Same for `remove`.
 */
import logger from '../../../utils/logger';

/**
 * A speech-to-text model contributed from outside core's whisper catalogue.
 *
 * The registrant owns the transport. `download` is expected to drive its own progress
 * into the shared `downloadStore` under `modelType: 'stt'` (which is what puts it in the
 * Download Manager with the standard combined progress bar) — the registry deliberately
 * does not impose a download mechanism, because a multi-file model with no archive
 * aggregates progress differently from a single-file one.
 */
export interface SttModel {
  /** Bare, stable id. The uniform download id becomes `stt:<id>`, so it must not collide
   *  with a whisper model id. */
  id: string;
  /** Label shown in the Models screen and Download Manager. */
  displayName: string;
  /** Total bytes on disk when complete. Drives the size shown before any transfer starts. */
  sizeBytes: number;
  /** True when every file this model needs is already on disk. */
  filesPresent(): Promise<boolean>;
  /** Start (or resume) the download. Resolves when the model is fully on disk. */
  download(): Promise<void>;
  /** Delete the model from disk. Omit if the model cannot be removed. */
  remove?(): Promise<void>;
  /** Abort an in-flight download and clean up partial files. Omit if the transport has no
   *  abort path — the provider then reports `cancel: false`. */
  cancel?(): Promise<void>;
  /** Optional attribution/licence line surfaced next to the model in the UI. */
  attribution?: string;
}

const models = new Map<string, SttModel>();

/**
 * Register an STT model. Idempotent by id: re-registering replaces the entry rather than
 * duplicating it, so a Fast Refresh or a second pro activation cannot produce two rows
 * for one model.
 */
export function registerSttModel(model: SttModel): void {
  const replacing = models.has(model.id);
  models.set(model.id, model);
  logger.log(`[DL-SM] stt model ${replacing ? 're-registered' : 'registered'}: ${model.id}`);
}

/** The registered model for a bare id, or undefined when the id is whisper's (or unknown). */
export function getSttModel(id: string): SttModel | undefined {
  return models.get(id);
}

/** Every registered model, in registration order. */
export function listSttModels(): SttModel[] {
  return [...models.values()];
}

/** Test hook: drop all registrations so suites don't leak state into each other. */
export function _clearSttModelsForTesting(): void {
  models.clear();
}
