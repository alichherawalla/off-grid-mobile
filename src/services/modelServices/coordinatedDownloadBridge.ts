import { Alert, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import {
  projectArtifactDownloadEvent,
  publicRequestForManifest,
  type ModelArtifactDownloadEvent,
  type ModelArtifactManifest,
  type ModelDownloadHandle,
} from '@offgrid/models';
import type { BackgroundDownloadInfo } from '../../types';
import type { DownloadCompleteCallback, DownloadErrorCallback, DownloadParams, DownloadProgressCallback } from '../backgroundDownloadTypes';
import { mobileModelDownloadCoordinator } from './modelDownloadCoordinator';
import { modelDownloadApplication } from '../composition/downloads';
import { nativeDownloadTransferAdapter } from '../adapters/downloads/nativeDownloadTransferAdapter';

type CompleteEvent = Parameters<DownloadCompleteCallback>[0];
type ErrorEvent = Parameters<DownloadErrorCallback>[0];
type ProgressEvent = Parameters<DownloadProgressCallback>[0];
type Listener<T> = (event: T) => void;
interface ActiveHandle { manifest: ModelArtifactManifest; handle: ModelDownloadHandle; params: DownloadParams; transferId?: string; logicalId?: string; unsubscribe: () => void }

interface CoordinatedManifestHandle {
  downloadId: string;
  handle: ModelDownloadHandle;
}

const downloadApplication = modelDownloadApplication();

const files = {
  pathFor: (localName: string) => `${RNFS.DocumentDirectoryPath}/${localName}`,
  exists: (path: string) => RNFS.exists(path),
  ensureParent: async (path: string) => {
    const parent = path.slice(0, path.lastIndexOf('/'));
    if (parent) await RNFS.mkdir(parent);
  },
  remove: (path: string) => RNFS.unlink(path),
  move: (source: string, target: string) => RNFS.moveFile(source, target),
};

class CoordinatedDownloadBridge {
  private readonly active = new Map<string, ActiveHandle>();
  private readonly progress = new Map<string, Set<Listener<ProgressEvent>>>();
  private readonly complete = new Map<string, Set<Listener<CompleteEvent>>>();
  private readonly errors = new Map<string, Set<Listener<ErrorEvent>>>();
  private readonly allProgress = new Set<Listener<ProgressEvent>>();
  private readonly allComplete = new Set<Listener<CompleteEvent>>();
  private readonly allErrors = new Set<Listener<ErrorEvent>>();

  isAvailable(): boolean { return true; }

  /** Start one Shared-owned operation that may contain several related artifacts. */
  startManifest(manifest: ModelArtifactManifest): CoordinatedManifestHandle {
    const request = publicRequestForManifest(manifest);
    const handle = mobileModelDownloadCoordinator.enqueueWithHandle(manifest);
    const params: DownloadParams = {
      ...request,
    };
    const holder: ActiveHandle = {
      manifest, handle, params, logicalId: manifest.id, unsubscribe: () => undefined,
    };
    holder.unsubscribe = handle.subscribe(event => this.routeEvent(holder, event));
    this.active.set(manifest.id, holder);
    handle.completion.finally(() => holder.unsubscribe());
    return { downloadId: manifest.id, handle };
  }

  async startDownload(params: DownloadParams): Promise<BackgroundDownloadInfo> {
    const operation = downloadApplication.operation({ ...params, namespace: 'mobile' });
    const { id, manifest } = operation;
    const handle = mobileModelDownloadCoordinator.enqueueWithHandle(manifest);
    const holder: ActiveHandle = { manifest, handle, params, unsubscribe: () => undefined };
    holder.unsubscribe = handle.subscribe(event => this.routeEvent(holder, event));
    const admitted = await handle.admitted;
    const transferId = admitted?.transferId ?? `completed:${id}`;
    holder.transferId = transferId;
    this.active.set(transferId, holder);
    handle.completion.finally(() => holder.unsubscribe());
    return { downloadId: transferId, fileName: params.fileName, modelId: params.modelId,
      status: admitted ? 'pending' : 'completed', bytesDownloaded: 0, totalBytes: params.totalBytes ?? 0,
      startedAt: Date.now() };
  }

  async cancelDownload(downloadId: string): Promise<void> {
    const holder = this.active.get(downloadId) ?? this.findByIdentity(downloadId.replace(/^queued:/, ''));
    if (holder) await holder.handle.cancel();
  }
  async retryDownload(downloadId: string): Promise<void> {
    const holder = this.active.get(downloadId);
    if (!holder) throw new Error(`Download not found: ${downloadId}`);
    await mobileModelDownloadCoordinator.retry(holder.manifest.id);
  }
  async purgeNativeRecord(downloadId: string): Promise<void> { const holder = this.active.get(downloadId); if (holder) holder.unsubscribe(); this.active.delete(downloadId); }

  async moveCompletedDownload(downloadId: string, targetPath: string): Promise<string> {
    const holder = this.active.get(downloadId);
    if (!holder) { if (await RNFS.exists(targetPath)) return targetPath; throw new Error(`Download not found: ${downloadId}`); }
    return downloadApplication.moveCompletedArtifact({
      manifest: holder.manifest,
      completion: holder.handle.completion,
      targetPath,
      files,
    });
  }

  async getActiveDownloads(): Promise<BackgroundDownloadInfo[]> {
    const logicalIds = new Map([...this.active.values()]
      .filter(holder => holder.logicalId)
      .map(holder => [holder.manifest.id, holder.logicalId!]));
    return downloadApplication.inventory(
      mobileModelDownloadCoordinator.list(),
      await nativeDownloadTransferAdapter.listActiveDownloads(),
      logicalIds,
    ) as BackgroundDownloadInfo[];
  }

  onProgress(id: string, listener: DownloadProgressCallback): () => void { return this.add(this.progress, id, listener); }
  onComplete(id: string, listener: DownloadCompleteCallback): () => void { return this.add(this.complete, id, listener); }
  onError(id: string, listener: DownloadErrorCallback): () => void { return this.add(this.errors, id, listener); }
  onAnyProgress(listener: DownloadProgressCallback): () => void { this.allProgress.add(listener); return () => this.allProgress.delete(listener); }
  onAnyComplete(listener: DownloadCompleteCallback): () => void { this.allComplete.add(listener); return () => this.allComplete.delete(listener); }
  onAnyError(listener: DownloadErrorCallback): () => void { this.allErrors.add(listener); return () => this.allErrors.delete(listener); }
  startProgressPolling(): void {}
  stopProgressPolling(): void {}
  reconcileActiveIds(): Promise<void> { return Promise.resolve(); }
  adoptActive(_downloadIds: string[]): void {}
  getQueuedCount(): number { return mobileModelDownloadCoordinator.list().filter(item => item.phase === 'queued').length; }
  getQueuedItems(): Array<{ modelKey: string; modelId: string; fileName: string; modelType: string; totalBytes: number }> {
    return mobileModelDownloadCoordinator.list().filter(item => item.phase === 'queued').map(item => ({
      modelKey: item.manifest.id, modelId: item.manifest.modelId, fileName: item.manifest.artifacts[0]?.name ?? '',
      modelType: item.manifest.kind === 'transcription' ? 'stt' : item.manifest.kind,
      totalBytes: item.manifest.artifacts.reduce((sum, artifact) => sum + (artifact.sizeBytes ?? 0), 0),
    }));
  }
  cancelQueued(key: string): boolean { const item = this.findByIdentity(key); if (!item) return false; item.handle.cancel(); return true; }

  downloadFileTo(opts: { params: Pick<DownloadParams, 'url' | 'fileName' | 'modelId' | 'totalBytes' | 'modelType' | 'metadataJson' | 'modelKey'>; destPath: string; onProgress?: (bytesDownloaded: number, totalBytes: number) => void; silent?: boolean }): { downloadIdPromise: Promise<string>; promise: Promise<void> } {
    const downloadIdPromise = this.startDownload(opts.params).then(info => info.downloadId);
    const promise = downloadIdPromise.then(async id => {
      const unsubscribe = this.onProgress(id, event =>
        opts.onProgress?.(event.bytesDownloaded, event.totalBytes),
      );
      try {
        // The shared handle owns terminal state and replays it to late consumers.
        // Native completion can happen before startDownload resolves, so a new
        // bridge listener is not a safe completion source.
        const holder = this.active.get(id);
        if (!holder) throw new Error(`Download not found: ${id}`);
        await holder.handle.completion;
        await this.moveCompletedDownload(id, opts.destPath);
      } finally {
        unsubscribe();
      }
    });
    return { downloadIdPromise, promise };
  }

  async excludeFromBackup(path: string): Promise<boolean> { return nativeDownloadTransferAdapter.excludeFromBackup(path); }
  async isBatteryOptimizationIgnored(): Promise<boolean> { return nativeDownloadTransferAdapter.isBatteryOptimizationIgnored(); }
  requestBatteryOptimizationIgnore(): void { nativeDownloadTransferAdapter.requestBatteryOptimizationIgnore(); }
  async checkAndPromptBatteryOptimization(): Promise<void> {
    if (Platform.OS !== 'android' || await this.isBatteryOptimizationIgnored()) return;
    await new Promise<void>(resolve => Alert.alert('Keep downloads running', 'Allow this app to run without battery restrictions.', [
      { text: 'Not now', style: 'cancel', onPress: () => resolve() },
      { text: 'Allow', onPress: () => { this.requestBatteryOptimizationIgnore(); resolve(); } },
    ], { cancelable: false }));
  }
  cleanup(): void {}

  private routeEvent(holder: ActiveHandle, event: ModelArtifactDownloadEvent): void {
    const projected = projectArtifactDownloadEvent({
      manifest: holder.manifest,
      request: holder.params,
      event,
      transferId: holder.transferId,
      logicalId: holder.logicalId,
      pathFor: files.pathFor,
    });
    if (projected.transferId) {
      holder.transferId = projected.transferId;
      if (!holder.logicalId) this.active.set(projected.transferId, holder);
    }
    const value = projected.event;
    if (!value) return;
    if (value.status === 'completed') {
      this.emit(this.complete.get(value.downloadId), value as CompleteEvent);
      this.emit(this.allComplete, value as CompleteEvent);
    } else if (value.status === 'failed') {
      this.emit(this.errors.get(value.downloadId), value as ErrorEvent);
      this.emit(this.allErrors, value as ErrorEvent);
    } else {
      this.emit(this.progress.get(value.downloadId), value as ProgressEvent);
      this.emit(this.allProgress, value as ProgressEvent);
    }
  }
  private findByIdentity(value: string): ActiveHandle | undefined { return [...this.active.values()].find(item => item.params.modelKey === value || item.manifest.id === value); }
  private add<T>(map: Map<string, Set<Listener<T>>>, id: string, listener: Listener<T>): () => void { const listeners = map.get(id) ?? new Set(); listeners.add(listener); map.set(id, listeners); return () => listeners.delete(listener); }
  private emit<T>(listeners: Iterable<Listener<T>> | undefined, event: T): void { for (const listener of listeners ?? []) listener(event); }
}

export const coordinatedDownloads = new CoordinatedDownloadBridge();
