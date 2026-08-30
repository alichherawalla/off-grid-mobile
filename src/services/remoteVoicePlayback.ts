import { Buffer } from 'buffer';
import RNFS from 'react-native-fs';
import type { RemoteServer } from '../types';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { remoteMediaRuntime } from './remoteMediaRuntime';

let previousPath: string | null = null;

export function activeRemoteVoiceServer(): RemoteServer | null {
  const server = useRemoteServerStore.getState().getActiveServer();
  return server?.mediaModels?.voice ? server : null;
}

/** Synthesize one remote voice clip into the file-backed playback seam. */
export async function synthesizeRemoteVoiceFile(
  input: {
    server: RemoteServer;
    text: string;
    messageId: string;
    signal: AbortSignal;
  },
): Promise<string> {
  const { server, text, messageId, signal } = input;
  const result = await remoteMediaRuntime.synthesizeVoice(server, { text }, { signal });
  if (result.audio.byteLength === 0) throw new Error('Remote server returned no voice audio');
  const directory = `${RNFS.CachesDirectoryPath}/remote_voice`;
  await RNFS.mkdir(directory);
  const extension = result.contentType.includes('wav') ? 'wav' : 'mp3';
  const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `${directory}/${safeId}.${extension}`;
  await RNFS.writeFile(path, Buffer.from(result.audio).toString('base64'), 'base64');
  if (signal.aborted) {
    await RNFS.unlink(path).catch(() => undefined);
    throw new Error('Remote request cancelled');
  }
  if (previousPath && previousPath !== path) {
    await RNFS.unlink(previousPath).catch(() => undefined);
  }
  previousPath = path;
  return path;
}
