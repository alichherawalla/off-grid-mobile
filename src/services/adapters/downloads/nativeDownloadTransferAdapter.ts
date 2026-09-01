import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { DownloadTransferPort } from '@offgrid/models';

const native = NativeModules.DownloadManagerModule;

type Progress = { downloadId: string; bytesDownloaded: number; totalBytes: number };
type Complete = { downloadId: string };
type Failure = { downloadId: string; reason?: string; reasonCode?: string };

interface ListenerSet {
  progress: (event: Progress) => void;
  complete: (event: Complete) => void;
  error: (event: Failure) => void;
}

class NativeDownloadTransferAdapter implements DownloadTransferPort {
  private readonly listeners = new Map<string, ListenerSet>();
  private readonly subscriptions: Array<{ remove(): void }> = [];

  constructor() {
    if (!native) return;
    const emitter = new NativeEventEmitter(native);
    this.subscriptions.push(
      emitter.addListener('DownloadProgress', (event: Progress) => this.listeners.get(event.downloadId)?.progress(event)),
      emitter.addListener('DownloadComplete', (event: Complete) => this.listeners.get(event.downloadId)?.complete(event)),
      emitter.addListener('DownloadError', (event: Failure) => this.listeners.get(event.downloadId)?.error(event)),
    );
  }

  async start(input: Parameters<DownloadTransferPort['start']>[0]): Promise<{ transferId?: string }> {
    this.assertAvailable();
    if (Platform.OS === 'android' && typeof native.requestNotificationPermission === 'function') {
      try { native.requestNotificationPermission(); } catch { /* permission is optional */ }
    }
    const fileName = input.destination.split('/').pop() ?? input.id;
    const result = await native.startDownload({
      url: input.url,
      fileName,
      modelId: input.id,
      modelKey: input.id,
      modelType: 'artifact',
      totalBytes: input.expectedBytes ?? 0,
      hideNotification: false,
    });
    const transferId = String(result.downloadId);
    input.onStarted?.(transferId);
    await this.waitForTransfer(transferId, input.destination, input.signal, input.onProgress);
    return { transferId };
  }

  async attach(input: Parameters<NonNullable<DownloadTransferPort['attach']>>[0]): Promise<void> {
    this.assertAvailable();
    await this.waitForTransfer(input.transferId, input.destination, input.signal, input.onProgress);
  }

  async isActive(transferId: string): Promise<boolean> {
    if (!native) return false;
    const rows = await native.getActiveDownloads();
    return (rows ?? []).some((row: { downloadId?: string; id?: string; status?: string }) => {
      const id = String(row.downloadId ?? row.id);
      return id === transferId && row.status !== 'failed';
    });
  }

  async cancel(transferId: string): Promise<void> {
    if (!native) return;
    await native.cancelDownload(transferId).catch(() => undefined);
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.length = 0;
    this.listeners.clear();
  }

  private waitForTransfer(
    transferId: string,
    destination: string,
    signal: AbortSignal,
    onProgress: (progress: { bytesDownloaded: number; totalBytes: number }) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.listeners.delete(transferId);
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        void this.cancel(transferId);
        cleanup();
        reject(new Error('Download cancelled'));
      };
      this.listeners.set(transferId, {
        progress: event => onProgress({
          bytesDownloaded: event.bytesDownloaded,
          totalBytes: event.totalBytes,
        }),
        complete: () => {
          cleanup();
          Promise.resolve(native.moveCompletedDownload(transferId, destination)).then(() => resolve(), reject);
        },
        error: event => {
          cleanup();
          reject(new Error(event.reason ?? 'Download failed'));
        },
      });
      signal.addEventListener('abort', abort, { once: true });
      native.startProgressPolling();
    });
  }

  private assertAvailable(): void {
    if (!native) throw new Error('Background downloads not available on this platform');
  }
}

export const nativeDownloadTransferAdapter = new NativeDownloadTransferAdapter();
