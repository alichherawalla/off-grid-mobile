import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
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

interface WaitForTransferInput {
  transferId: string;
  destination: string;
  signal: AbortSignal;
  onProgress: (progress: { bytesDownloaded: number; totalBytes: number }) => void;
}

interface TerminalOperation {
  kind: 'cancel' | 'move';
  promise: Promise<void>;
}

export class NativeDownloadTransferAdapter implements DownloadTransferPort {
  private readonly listeners = new Map<string, ListenerSet>();
  private readonly terminalOperations = new Map<string, TerminalOperation>();
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

  isAvailable(): boolean {
    return Boolean(native && typeof native.startDownload === 'function');
  }

  async start(input: Parameters<DownloadTransferPort['start']>[0]): Promise<{ transferId?: string }> {
    this.assertAvailable();
    if (Platform.OS === 'android' && typeof native.requestNotificationPermission === 'function') {
      try { native.requestNotificationPermission(); } catch { /* permission is optional */ }
    }
    const fileName = input.destination.split('/').pop() ?? input.id;
    const parent = input.destination.slice(0, Math.max(0, input.destination.lastIndexOf('/')));
    if (parent) await RNFS.mkdir(parent);
    const result = await native.startDownload({
      url: input.url,
      fileName,
      modelId: input.id,
      modelKey: input.id,
      modelType: 'artifact',
      totalBytes: input.expectedBytes ?? 0,
      hideNotification: false,
      // Shared resumes a paused download with a fresh start(resume: true). Native retained the
      // bytes when the pause cancelled it; this flag is what tells it to continue from them.
      resume: input.resume === true,
    });
    const transferId = String(result.downloadId);
    input.onStarted?.(transferId);
    await this.waitForTransfer({
      transferId,
      destination: input.destination,
      signal: input.signal,
      onProgress: input.onProgress,
    });
    return { transferId };
  }

  async attach(input: Parameters<NonNullable<DownloadTransferPort['attach']>>[0]): Promise<void> {
    this.assertAvailable();
    await this.waitForTransfer(input);
  }

  async isActive(transferId: string): Promise<boolean> {
    if (!native) return false;
    const rows = await native.getActiveDownloads();
    return (rows ?? []).some((row: { downloadId?: string; id?: string; status?: string }) => {
      const id = String(row.downloadId ?? row.id);
      return id === transferId && row.status !== 'failed';
    });
  }

  /**
   * Return the native system's durable transfer rows.
   *
   * The shared coordinator owns downloads started in this JS process. The native
   * system remains the source of truth after a process restart, before those
   * handles can be reconstructed. The Mobile composition layer uses this narrow
   * projection to reconcile both sets without moving platform row shapes into
   * shared policy.
   */
  async listActiveDownloads(): Promise<Array<Record<string, unknown>>> {
    if (!native || typeof native.getActiveDownloads !== 'function') return [];
    return (await native.getActiveDownloads()) ?? [];
  }

  async cancel(transferId: string): Promise<void> {
    this.assertAvailable();
    const existing = this.terminalOperations.get(transferId);
    if (existing) return existing.promise;
    const cancellation = Promise.resolve()
      .then(() => native.cancelDownload(transferId))
      .then(() => undefined);
    const terminal: TerminalOperation = { kind: 'cancel', promise: cancellation };
    this.terminalOperations.set(transferId, terminal);
    try {
      await cancellation;
    } finally {
      if (this.terminalOperations.get(transferId) === terminal) {
        this.terminalOperations.delete(transferId);
      }
    }
  }

  async excludeFromBackup(path: string): Promise<boolean> {
    if (!native || typeof native.excludePathFromBackup !== 'function') return false;
    return native.excludePathFromBackup(path).catch(() => false);
  }

  async isBatteryOptimizationIgnored(): Promise<boolean> {
    if (!native || Platform.OS !== 'android') return true;
    return native.isBatteryOptimizationIgnored?.().catch(() => true) ?? true;
  }

  requestBatteryOptimizationIgnore(): void {
    if (native && Platform.OS === 'android') native.requestBatteryOptimizationIgnore?.();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.length = 0;
    this.listeners.clear();
    this.terminalOperations.clear();
  }

  private waitForTransfer({
    transferId,
    destination,
    signal,
    onProgress,
  }: WaitForTransferInput): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let abortRequested = false;
      const cleanup = () => {
        this.listeners.delete(transferId);
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        if (settled) return;
        abortRequested = true;
        // A completion event transfers ownership to the move. Await that same
        // terminal operation; a second native cancel cannot make the move safer.
        if (this.terminalOperations.get(transferId)?.kind === 'move') return;
        this.cancel(transferId).then(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error('Download cancelled'));
        }, cause => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(cause);
        });
      };
      this.listeners.set(transferId, {
        progress: event => onProgress({
          bytesDownloaded: event.bytesDownloaded,
          totalBytes: event.totalBytes,
        }),
        complete: () => {
          if (settled || this.terminalOperations.has(transferId)) return;
          // Register the terminal operation before invoking the native move so
          // abort and explicit cancellation always observe the same promise.
          const terminalMove = Promise.resolve()
            .then(() => native.moveCompletedDownload(transferId, destination))
            .then(() => undefined);
          const terminal: TerminalOperation = { kind: 'move', promise: terminalMove };
          this.terminalOperations.set(transferId, terminal);
          terminalMove.then(() => {
            if (this.terminalOperations.get(transferId) === terminal) {
              this.terminalOperations.delete(transferId);
            }
            if (settled) return;
            settled = true;
            cleanup();
            if (abortRequested) reject(new Error('Download cancelled'));
            else resolve();
          }, cause => {
            if (this.terminalOperations.get(transferId) === terminal) {
              this.terminalOperations.delete(transferId);
            }
            if (settled) return;
            settled = true;
            cleanup();
            reject(cause);
          });
        },
        error: event => {
          if (settled || this.terminalOperations.has(transferId)) return;
          settled = true;
          cleanup();
          reject(new Error(event.reason ?? 'Download failed'));
        },
      });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      try {
        native.startProgressPolling();
      } catch (cause) {
        settled = true;
        cleanup();
        reject(cause);
        return;
      }
      Promise.resolve(native.getActiveDownloads()).then((rows: Array<{ downloadId?: string; id?: string; status?: string }> = []) => {
        if (settled) return;
        const row = rows.find(item => String(item.downloadId ?? item.id) === transferId);
        if (row?.status === 'completed') this.listeners.get(transferId)?.complete({ downloadId: transferId });
        else if (row?.status === 'failed') this.listeners.get(transferId)?.error({ downloadId: transferId, reason: 'Download failed' });
      }).catch(cause => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(cause);
      });
    });
  }

  private assertAvailable(): void {
    if (!native) throw new Error('Background downloads not available on this platform');
  }
}

export const nativeDownloadTransferAdapter = new NativeDownloadTransferAdapter();
