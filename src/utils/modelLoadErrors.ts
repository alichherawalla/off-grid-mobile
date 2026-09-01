/**
 * A model load was blocked by the memory budget, but the user CAN choose to load
 * it anyway ("Load Anyway" → retry with { override: true }).
 *
 * This carries an explicit, typed signal rather than relying on message-regex
 * sniffing: the readiness/failure layer checks `isOverridableMemoryError(err)` to
 * decide whether to offer the override button. The message still matches the
 * insufficient-memory reason mapping so existing classification keeps working.
 */
export {
  OverridableModelMemoryError as OverridableMemoryError,
  isOverridableModelMemoryError as isOverridableMemoryError,
} from '@offgrid/models';

/**
 * The downloaded image model is missing required files (a partial/corrupt extraction),
 * so it can't load. This is a DATA-completeness problem, not a hardware/backend one —
 * a typed signal so the failure surface can say "re-download" instead of the misleading
 * "your device may not support this backend" (which the raw native crash produced).
 */
export class ImageModelIncompleteError extends Error {
  readonly incompleteModel = true as const;
  /** The missing/zero-byte files, for logging + the user message. */
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `Image model files are incomplete (missing: ${missing.join(', ')}). ` +
        'The download was corrupted or interrupted. Delete and re-download this model.',
    );
    this.name = 'ImageModelIncompleteError';
    this.missing = missing;
    Object.setPrototypeOf(this, ImageModelIncompleteError.prototype);
  }
}

export function isImageModelIncompleteError(err: unknown): err is ImageModelIncompleteError {
  return (
    err instanceof ImageModelIncompleteError ||
    (typeof err === 'object' && err !== null && (err as { incompleteModel?: unknown }).incompleteModel === true)
  );
}
