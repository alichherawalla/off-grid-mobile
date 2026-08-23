import { trimWavSilence } from '../../services/wavTrimmer';
import logger from '../../utils/logger';

/**
 * A raw recording turned into the note the person MEANT.
 *
 * Hands-free opens the mic before anyone speaks - loudness only reveals speech about 300ms after it
 * starts, so a recorder that waits for detection always opens mid-word - which leaves the file starting
 * with however long they took to begin. Voice notes here play back and sync, so that dead air is not
 * cosmetic.
 *
 * Its own module because every stop path produces this same artifact and they must not disagree about
 * what it is, and because deciding what a recording IS has nothing to do with driving a recorder.
 */

export interface RecordedAudio {
  path: string;
  durationSeconds: number;
}

export async function finaliseRecording(
  recorded: RecordedAudio,
  /** Seconds of recording before speech actually began; 0 when nothing was watching. */
  silenceBeforeSpeech: number,
  /** Seconds of dead air at the end - the quiet that ENDED the turn, whatever window the person
   *  chose; 0 when nothing was watching. */
  silenceAfterSpeech: number = 0,
): Promise<RecordedAudio> {
  logger.log(
    `[TURN] finalise path=${recorded.path.slice(-24)} ` +
      `duration=${recorded.durationSeconds.toFixed(2)}s lead=${silenceBeforeSpeech.toFixed(2)}s ` +
      `tail=${silenceAfterSpeech.toFixed(2)}s`,
  );
  if (silenceBeforeSpeech <= 0 && silenceAfterSpeech <= 0) return recorded;
  if (!(await trimWavSilence(recorded.path, silenceBeforeSpeech, silenceAfterSpeech))) return recorded;
  // The duration comes down with the audio, or the player shows time the file no longer contains.
  return {
    path: recorded.path,
    durationSeconds: Math.max(
      0,
      recorded.durationSeconds - silenceBeforeSpeech - silenceAfterSpeech,
    ),
  };
}
