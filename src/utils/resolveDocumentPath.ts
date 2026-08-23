import RNFS from 'react-native-fs';

/**
 * Re-base a stored absolute Documents path onto the CURRENT app container.
 *
 * iOS assigns a new Data-container UUID on each (re)install and migrates the
 * Documents contents into it — so a path stored at write time
 * (`…/Application/<OLD-UUID>/Documents/audio-input/x.wav`) can reference a stale
 * UUID even though the file now lives under the current container. Storing
 * absolute container paths is therefore fragile; this resolves them at read time.
 *
 * Strips everything up to and including the first `/Documents/` and re-roots the
 * remainder onto the current `RNFS.DocumentDirectoryPath`. Paths that aren't under
 * a Documents directory (or are empty) are returned unchanged. The result is a
 * bare filesystem path (no `file://` scheme — callers add it if they need it).
 */
export function resolveDocumentPath(stored: string): string {
  if (!stored) return stored;
  const noScheme = stored.replace(/^file:\/\//, '');
  const marker = '/Documents/';
  const idx = noScheme.indexOf(marker);
  if (idx === -1) return noScheme; // not under Documents — leave as-is (sans scheme)
  const relative = noScheme.slice(idx + marker.length);
  const base = RNFS.DocumentDirectoryPath.replace(/\/+$/, '');
  return `${base}/${relative}`;
}

/**
 * Resolve a stored Documents path and prove that it remains inside one app-owned directory.
 *
 * iOS can report the same container through `/private/var/...` while RNFS reports `/var/...`.
 * Comparing those raw strings rejects a valid model path and leaves the model bytes on disk.
 * Rebasing first gives both spellings one identity. Rejecting traversal segments keeps this safe
 * for destructive operations such as model deletion.
 */
export function resolveOwnedDocumentPath(stored: string, ownedRoot: string): string | null {
  const resolved = resolveDocumentPath(stored);
  const root = ownedRoot.replace(/\/+$/, '');
  const prefix = `${root}/`;
  if (!resolved.startsWith(prefix)) return null;

  const relative = resolved.slice(prefix.length);
  const segments = relative.split('/');
  if (!relative || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    return null;
  }
  return resolved;
}
