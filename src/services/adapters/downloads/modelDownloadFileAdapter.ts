import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';
import type { DownloadFilePort } from '@offgrid/models';
import { statFile } from '../../../utils/fileStat';

export class ModelDownloadFileAdapter implements DownloadFilePort {
  constructor(private readonly baseDirectory: string) {}

  pathFor(localName: string): string { return `${this.baseDirectory}/${localName}`; }
  exists(path: string): Promise<boolean> { return RNFS.exists(path); }
  async size(path: string): Promise<number> { return (await statFile(path))?.size ?? 0; }
  async readPrefix(path: string, bytes: number): Promise<Uint8Array> {
    const base64 = await RNFS.read(path, bytes, 0, 'base64');
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }
  async remove(path: string): Promise<void> {
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  }
}
