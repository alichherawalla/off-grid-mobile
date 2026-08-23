/**
 * One rule for reading a file size off the filesystem.
 *
 * `RNFS.stat` and `RNFS.readDir` report a size as a NUMBER on one platform and a STRING on the
 * other. Ten call sites had each written their own ternary for that, which is ten chances to get a
 * byte count wrong in a place the user reads it - a size, a free-space check, a "does this file
 * match its manifest" guard. One platform difference deserves one answer.
 *
 * @param size the raw size a filesystem API reported
 * @param fallback what an absent size means to the caller (0 for a running total)
 */
export function sizeToBytes(
  size: string | number | undefined | null,
  fallback = 0,
): number {
  if (typeof size === 'number') {
    return Number.isSafeInteger(size) && size >= 0 ? size : fallback;
  }
  if (typeof size === 'string' && /^[0-9]+$/.test(size)) {
    const parsed = Number(size);
    return Number.isSafeInteger(parsed) ? parsed : fallback;
  }
  return fallback;
}
