import RNFS from 'react-native-fs';
import { sizeToBytes } from './fileSize';

/**
 * What the filesystem knows about one path, asked in a way that cannot kill the app.
 *
 * `RNFS.stat` ABORTS the process on iOS for a path whose resource type cannot be resolved - which is
 * what a stale absolute path is, and app container paths go stale on every reinstall. The native
 * method builds its result dictionary and inserts the type unguarded:
 *
 *     @{ @"ctime": …, @"mtime": …, @"size": …, @"type": [attrs objectForKey:NSURLFileResourceTypeKey] }
 *
 * `resourceValuesForKeys` OMITS a key it cannot determine rather than failing, so `type` arrives nil
 * and NSDictionary raises `NSInvalidArgumentException: attempt to insert nil object from objects[3]`.
 * The size directly above it has a nil guard; the type has none.
 *
 * A JS `try/catch` cannot save this. The exception is raised on the module's own queue and rethrown
 * natively, so the process is gone before any promise settles - which is why `RNFS.stat(p).catch(…)`
 * appears safe everywhere in this codebase and is not. It crashed the app three seconds after launch,
 * on every launch, because the startup model scan stats each stored path.
 *
 * `readDir` answers the same question and is safe: it guards `attrs != nil`, defaults a missing size,
 * and derives the type from booleans, so no value it inserts can be nil. This asks the PARENT for the
 * entry instead of asking the path about itself.
 */
export interface FileFacts {
  /** Bytes. Never a string, unlike the value RNFS reports. */
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  /** Milliseconds since the epoch, when the platform reported one. */
  mtimeMs?: number;
}

/** `file:///a/b` and `/a/b` name the same thing; the filesystem wants the second. */
function withoutScheme(path: string): string {
  return path.startsWith('file://') ? decodeURIComponent(path.slice(7)) : path;
}

function splitParent(path: string): { parent: string; name: string } | null {
  const value = withoutScheme(path);
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  const cleaned = value.slice(0, end);
  const cut = cleaned.lastIndexOf('/');
  if (cut < 0) return null;
  return {
    parent: cut === 0 ? '/' : cleaned.slice(0, cut),
    name: cleaned.slice(cut + 1),
  };
}

/**
 * The facts about `path`, or null when it is not there.
 *
 * Null is the ANSWER for a missing file, not an error: every caller of the old `stat` had to guess
 * whether a rejection meant "absent" or "broken", and most guessed by catching everything.
 */
export async function statFile(path: string): Promise<FileFacts | null> {
  try {
    const split = splitParent(path);
    if (!split) return null;
    const entries = await RNFS.readDir(split.parent);
    const entry = entries.find(item => item.name === split.name);
    if (!entry) return null;
    return {
      // Through the one rule for a filesystem size. RNFS reports it as a number on one platform and
      // a string on the other, and `sizeToBytes` already owns that difference.
      size: sizeToBytes(entry.size),
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
      ...(entry.mtime ? { mtimeMs: new Date(entry.mtime).getTime() } : {}),
    };
  } catch {
    // An unreadable or absent PARENT is also "not there", and is the common case for a stale
    // container path - the whole directory went with the old install.
    return null;
  }
}
