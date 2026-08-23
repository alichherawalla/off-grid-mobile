import { DownloadedModel } from '../types';

export const getMmProjFileSize = (m?: DownloadedModel): number =>
  m?.engine === 'llama' ? (m.mmProjFileSize ?? 0) : 0;

/**
 * The ONE test for "is this a LiteRT model file".
 *
 * Five call sites each spelled the extension out — the import guard, the import display name, the
 * registry row builder, the multi-file picker and the acceleration check. A format is one fact
 * about a file, so it gets one answer; adding a second LiteRT extension used to mean finding all
 * five.
 */
export const isLiteRTFileName = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith('.litertlm');
