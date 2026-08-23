import RNFS from 'react-native-fs';
import { statFile } from '../../utils/fileStat';

type CopyProgressOpts = { knownTotalBytes: number | null; onProgress?: (fraction: number) => void };

export async function copyFileWithProgress(
  source: string,
  dest: string,
  { knownTotalBytes, onProgress }: CopyProgressOpts,
): Promise<void> {
  let totalBytes = knownTotalBytes ?? 0;
  if (totalBytes === 0) {
    try {
      totalBytes = (await statFile(source))?.size ?? 0;
    } catch {
      // stat failed — progress will be indeterminate (stuck at 0%), non-fatal
    }
  }

  let polling = true;

  const pollInterval = setInterval(async () => {
    if (!polling) return;
    try {
      const exists = await RNFS.exists(dest);
      if (exists && totalBytes > 0) {
        const written = (await statFile(dest))?.size ?? 0;
        const pct = Math.min(written / totalBytes, 0.99);
        onProgress?.(pct);
      }
    } catch {
      // poll errors are non-fatal
    }
  }, 500);

  try {
    await RNFS.copyFile(source, dest);
    polling = false;
    clearInterval(pollInterval);
    onProgress?.(1);
  } catch (error) {
    polling = false;
    clearInterval(pollInterval);
    await RNFS.unlink(dest).catch(() => {});
    throw error;
  }
}
