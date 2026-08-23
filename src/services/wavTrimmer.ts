import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';
import { WAV_HEADER_BYTES, WAV_HEADER_SCAN_BYTES, planWavTrim } from '@offgrid/speech';
import logger from '../utils/logger';

/**
 * Cut the dead air off both ends of a recording, in place.
 *
 * Hands-free opens the microphone before anyone speaks, so the first word is never clipped - loudness
 * only tells you speech began about 300ms AFTER it began, so a recorder that waits for detection
 * always starts mid-word. And a turn that ends on silence carries the whole end-of-turn window as
 * dead air at its end - a 0:02 label over a seven-second file. Voice notes here play back and sync,
 * so that silence is not cosmetic.
 *
 * This is the I/O half only. WHERE to cut is `planWavTrim` in `@offgrid/speech` - pure, shared with
 * desktop, and tested on real WAV bytes. This file reads, writes and swaps.
 *
 * Failure is always non-fatal: on any problem the original file is left exactly as it was. A note with
 * silence at the front is a blemish; a note we corrupted while tidying is lost audio.
 */

/**
 * Bytes per copied chunk.
 *
 * A multiple of 3 so each chunk's base64 has no interior padding (concatenated at byte offsets, a
 * padded chunk would shift everything after it), and even so a 16-bit frame is never split.
 */
const COPY_CHUNK_BYTES = 3 * 256 * 1024;

/**
 * Below this there is nothing worth waiting for.
 *
 * The trim sits in the critical path - stop, trim, transcribe, send, generate, speak - so every
 * millisecond here delays the reply. Half a second of dead air at the front of a note is not worth
 * delaying the answer for; four seconds is.
 */
const MIN_WORTHWHILE_TRIM_SECONDS = 1;

export async function trimWavSilence(
  path: string,
  dropFrontSeconds: number,
  dropTailSeconds: number = 0,
): Promise<boolean> {
  const front = Number.isFinite(dropFrontSeconds) ? Math.max(0, dropFrontSeconds) : 0;
  const tail = Number.isFinite(dropTailSeconds) ? Math.max(0, dropTailSeconds) : 0;
  // Gated on the TOTAL: half a second at each end is a second of dead air, and worth the same wait.
  if (front + tail < MIN_WORTHWHILE_TRIM_SECONDS) return false;
  const startedAt = Date.now();

  const temporary = `${path}.trim`;
  try {
    const info = await RNFS.stat(path);
    const fileBytes = Number(info.size);
    const head = new Uint8Array(
      Buffer.from(await RNFS.read(path, WAV_HEADER_SCAN_BYTES, 0, 'base64'), 'base64'),
    );

    const plan = planWavTrim(head, front, fileBytes, tail);
    if (!plan) {
      // Says WHICH nothing happened: an unreadable header, nothing worth dropping, or a trim that
      // would have left no audio. Without it a note that kept its silence looks like a trim that ran.
      logger.log(
        `[VAD] trim skipped (nothing to cut in ${fileBytes}B, wanted front=${front.toFixed(2)}s tail=${tail.toFixed(2)}s)`,
      );
      return false;
    }

    await RNFS.writeFile(temporary, Buffer.from(plan.header).toString('base64'), 'base64');

    let copied = 0;
    while (copied < plan.copyBytes) {
      const length = Math.min(COPY_CHUNK_BYTES, plan.copyBytes - copied);
      const chunk = await RNFS.read(path, length, plan.copyFrom + copied, 'base64');
      await RNFS.write(temporary, chunk, WAV_HEADER_BYTES + copied, 'base64');
      copied += length;
    }

    // Swap last, so an interruption anywhere above leaves the original untouched.
    await RNFS.unlink(path);
    await RNFS.moveFile(temporary, path);
    // Costed, not guessed: this runs before the reply can start, so its price belongs in the log.
    logger.log(
      `[VAD] trimmed ${plan.droppedSeconds.toFixed(2)}s of silence (front=${front.toFixed(2)}s ` +
        `tail=${tail.toFixed(2)}s) leaving ${plan.copyBytes}B in ${Date.now() - startedAt}ms`,
    );
    return true;
  } catch (error) {
    await RNFS.unlink(temporary).catch(() => undefined);
    logger.warn('[VAD] trim failed, keeping the original recording', error);
    return false;
  }
}
