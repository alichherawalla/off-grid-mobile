import { Alert, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import type { ModelArtifactDownloadEvent, ModelArtifactManifest, ModelDownloadHandle, ModelKind } from '@offgrid/models';
import type { BackgroundDownloadInfo, BackgroundDownloadStatus } from '../../types';
import type { DownloadCompleteCallback, DownloadErrorCallback, DownloadParams, DownloadProgressCallback } from '../backgroundDownloadTypes';
import { mobileModelDownloadCoordinator } from './modelDownloadCoordinator';
import { nativeDownloadTransferAdapter } from '../adapters/downloads/nativeDownloadTransferAdapter';

type CompleteEvent = Parameters<DownloadCompleteCallback>[0];
type ErrorEvent = Parameters<DownloadErrorCallback>[0];
type ProgressEvent = Parameters<DownloadProgressCallback>[0];
type Listener<T> = (event: T) => void;
interface ActiveHandle { manifest: ModelArtifactManifest; handle: ModelDownloadHandle; params: DownloadParams; transferId?: string; unsubscribe: () => void }

const kindFor = (type?: string): ModelKind => type === 'image' ? 'image' : type === 'stt' ? 'transcription' : type === 'tts' ? 'voice' : 'text';
const statusFor = (phase: string): BackgroundDownloadStatus => phase === 'completed' ? 'completed' : ['failed', 'cancelled', 'interrupted'].includes(phase) ? 'failed' : phase === 'downloading' ? 'running' : 'pending';

class CoordinatedDownloadBridge {
  private readonly active = new Map<string, ActiveHandle>();
  private readonly progress = new Map<string, Set<Listener<ProgressEvent>>>();
  private readonly complete = new Map<string, Set<Listener<CompleteEvent>>>();
  private readonly errors = new Map<string, Set<Listener<ErrorEvent>>>();
  private readonly allProgress = new Set<Listener<ProgressEvent>>();
  private readonly allComplete = new Set<Listener<CompleteEvent>>();
  private readonly allErrors = new Set<Listener<ErrorEvent>>();

  isAvailable(): boolean { return true; }

  async startDownload(params: DownloadParams): Promise<BackgroundDownloadInfo> {
    const identity = params.modelKey ?? `${params.modelId}/${params.fileName}`;
    const id = `mobile:${params.modelType ?? 'text'}:${identity}`;
    const localName = `offgrid-download-staging/${encodeURIComponent(id)}/${params.fileName}`;
    const manifest: ModelArtifactManifest = { id, modelId: params.modelId, kind: kindFor(params.modelType), revision: 'mobile', artifacts: [{
      id: `${id}:artifact`, name: params.fileName, localName, url: params.url, sizeBytes: params.totalBytes,
      sha256: params.sha256, role: params.isSidecar ? 'mmproj' : 'primary', required: true,
    }] };
    const handle = mobileModelDownloadCoordinator.enqueueWithHandle(manifest);
    const holder: ActiveHandle = { manifest, handle, params, unsubscribe: () => undefined };
    holder.unsubscribe = handle.subscribe(event => this.routeEvent(holder, event));
    const admitted = await handle.admitted;
    const transferId = admitted?.transferId ?? `completed:${id}`;
    holder.transferId = transferId;
    this.active.set(transferId, holder);
    void handle.completion.finally(() => holder.unsubscribe());
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
    await holder.handle.completion;
    const source = `${RNFS.DocumentDirectoryPath}/${holder.manifest.artifacts[0].localName}`;
    if (source !== targetPath && await RNFS.exists(source)) {
      const parent = targetPath.slice(0, targetPath.lastIndexOf('/')); if (parent) await RNFS.mkdir(parent);
      if (await RNFS.exists(targetPath)) await RNFS.unlink(targetPath);
      await RNFS.moveFile(source, targetPath);
    }
    return targetPath;
  }

  async getActiveDownloads(): Promise<BackgroundDownloadInfo[]> {
    return mobileModelDownloadCoordinator.list().map(record => {
      const artifact = record.artifacts[0]; const definition = record.manifest.artifacts[0];
      return { downloadId: artifact?.transferId ?? `queued:${record.manifest.id}`, fileName: definition?.name ?? '',
        modelId: record.manifest.modelId, status: statusFor(record.phase), bytesDownloaded: artifact?.bytesDownloaded ?? 0,
        totalBytes: artifact?.totalBytes ?? definition?.sizeBytes ?? 0, startedAt: record.createdAt,
        modelKey: record.manifest.id, modelType: record.manifest.kind === 'transcription' ? 'stt' : record.manifest.kind };
    });
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
  cancelQueued(key: string): boolean { const item = this.findByIdentity(key); if (!item) return false; void item.handle.cancel(); return true; }

  downloadFileTo(opts: { params: Pick<DownloadParams, 'url' | 'fileName' | 'modelId' | 'totalBytes' | 'modelType' | 'metadataJson' | 'modelKey'>; destPath: string; onProgress?: (bytesDownloaded: number, totalBytes: number) => void; silent?: boolean }): { downloadIdPromise: Promise<string>; promise: Promise<void> } {
    const downloadIdPromise = this.startDownload(opts.params).then(info => { this.onProgress(info.downloadId, e => opts.onProgress?.(e.bytesDownloaded, e.totalBytes)); return info.downloadId; });
    const promise = downloadIdPromise.then(id => new Promise<void>((resolve, reject) => {
      this.onComplete(id, () => { this.moveCompletedDownload(id, opts.destPath).then(() => resolve(), reject); });
      this.onError(id, event => reject(new Error(event.reason ?? 'Download failed')));
    }));
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
    if (event.type === 'admitted') { holder.transferId = event.transferId; this.active.set(event.transferId, holder); return; }
    const id = holder.transferId; if (!id) return;
    if (event.type === 'progress') {
      const value = { downloadId: id, modelId: holder.params.modelId, fileName: holder.params.fileName,
        status: 'running',
        bytesDownloaded: event.bytesDownloaded, totalBytes: event.totalBytes,
        progress: event.totalBytes > 0 ? event.bytesDownloaded / event.totalBytes : 0 } as ProgressEvent;
      this.emit(this.progress.get(id), value); this.emit(this.allProgress, value);
    } else if (event.type === 'completed') {
      const value = { downloadId: id, modelId: holder.params.modelId, fileName: holder.params.fileName,
        localUri: `${RNFS.DocumentDirectoryPath}/${holder.manifest.artifacts[0].localName}` } as CompleteEvent;
      this.emit(this.complete.get(id), value); this.emit(this.allComplete, value);
    } else if (event.type === 'failed' || event.type === 'cancelled') {
      const value = { downloadId: id, modelId: holder.params.modelId, fileName: holder.params.fileName,
        status: 'failed', reason: event.type === 'failed' ? event.error : 'Download cancelled',
        reasonCode: event.type === 'cancelled' ? 'user_cancelled' : undefined } as ErrorEvent;
      this.emit(this.errors.get(id), value); this.emit(this.allErrors, value);
    }
  }
  private findByIdentity(value: string): ActiveHandle | undefined { return [...this.active.values()].find(item => item.params.modelKey === value || item.manifest.id === value); }
  private add<T>(map: Map<string, Set<Listener<T>>>, id: string, listener: Listener<T>): () => void { const listeners = map.get(id) ?? new Set(); listeners.add(listener); map.set(id, listeners); return () => listeners.delete(listener); }
  private emit<T>(listeners: Iterable<Listener<T>> | undefined, event: T): void { for (const listener of listeners ?? []) listener(event); }
}

export const coordinatedDownloads = new CoordinatedDownloadBridge();
