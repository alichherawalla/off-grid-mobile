import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { BackgroundDownloadInfo, BackgroundDownloadStatus } from '../types';

const { DownloadManagerModule } = NativeModules;

interface DownloadParams {
  url: string;
  fileName: string;
  modelId: string;
  title?: string;
  description?: string;
  totalBytes?: number;
}

interface MultiFileDownloadParams {
  files: { url: string; relativePath: string; size: number }[];
  fileName: string;
  modelId: string;
  destinationDir: string;
  totalBytes?: number;
}

interface DownloadProgressEvent {
  downloadId: number;
  fileName: string;
  modelId: string;
  bytesDownloaded: number;
  totalBytes: number;
  status: BackgroundDownloadStatus;
}

interface DownloadCompleteEvent {
  downloadId: number;
  fileName: string;
  modelId: string;
  bytesDownloaded: number;
  totalBytes: number;
  status: 'completed';
  localUri: string;
}

interface DownloadErrorEvent {
  downloadId: number;
  fileName: string;
  modelId: string;
  status: 'failed';
  reason: string;
}

type DownloadProgressCallback = (event: DownloadProgressEvent) => void;
type DownloadCompleteCallback = (event: DownloadCompleteEvent) => void;
type DownloadErrorCallback = (event: DownloadErrorEvent) => void;

class BackgroundDownloadService {
  private eventEmitter: NativeEventEmitter | null = null;
  private progressListeners: Map<string, DownloadProgressCallback> = new Map();
  private completeListeners: Map<string, DownloadCompleteCallback> = new Map();
  private errorListeners: Map<string, DownloadErrorCallback> = new Map();
  private subscriptions: { remove: () => void }[] = [];
  private isPolling = false;

  constructor() {
    if (this.isAvailable()) {
      this.eventEmitter = new NativeEventEmitter(DownloadManagerModule);
      this.setupEventListeners();
    }
  }

  /**
   * Check if background downloads are available (Android only)
   */
  isAvailable(): boolean {
    return DownloadManagerModule != null;
  }

  /**
   * Start a background download
   */
  async startDownload(params: DownloadParams): Promise<BackgroundDownloadInfo> {
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }

    const result = await DownloadManagerModule.startDownload({
      url: params.url,
      fileName: params.fileName,
      modelId: params.modelId,
      title: params.title || `Downloading ${params.fileName}`,
      description: params.description || 'Model download in progress...',
      totalBytes: params.totalBytes || 0,
    });

    // Start polling for progress
    // this.startProgressPolling(); // REMOVED: Callers must start polling after registering listeners to avoid race conditions

    return {
      downloadId: result.downloadId,
      fileName: result.fileName,
      modelId: result.modelId,
      status: 'pending',
      bytesDownloaded: 0,
      totalBytes: params.totalBytes || 0,
      startedAt: Date.now(),
    };
  }

  /**
   * Start a multi-file background download (files downloaded to destinationDir preserving relative paths)
   */
  async startMultiFileDownload(params: MultiFileDownloadParams): Promise<BackgroundDownloadInfo> {
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }

    const result = await DownloadManagerModule.startMultiFileDownload({
      files: params.files,
      fileName: params.fileName,
      modelId: params.modelId,
      destinationDir: params.destinationDir,
      totalBytes: params.totalBytes || 0,
    });

    return {
      downloadId: result.downloadId,
      fileName: result.fileName,
      modelId: result.modelId,
      status: 'pending',
      bytesDownloaded: 0,
      totalBytes: params.totalBytes || 0,
      startedAt: Date.now(),
    };
  }

  /**
   * Cancel an active download
   */
  async cancelDownload(downloadId: number): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }

    await DownloadManagerModule.cancelDownload(downloadId);
  }

  /**
   * Get all active/persisted downloads
   */
  async getActiveDownloads(): Promise<BackgroundDownloadInfo[]> {
    if (!this.isAvailable()) {
      return [];
    }

    const downloads = await DownloadManagerModule.getActiveDownloads();
    return downloads.map((d: any) => ({
      downloadId: d.downloadId,
      fileName: d.fileName,
      modelId: d.modelId,
      status: d.status as BackgroundDownloadStatus,
      bytesDownloaded: d.bytesDownloaded,
      totalBytes: d.totalBytes,
      localUri: d.localUri,
      startedAt: d.startedAt,
    }));
  }

  /**
   * Get progress for a specific download
   */
  async getDownloadProgress(downloadId: number): Promise<{
    bytesDownloaded: number;
    totalBytes: number;
    status: BackgroundDownloadStatus;
    localUri?: string;
    reason?: string;
  }> {
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }

    const progress = await DownloadManagerModule.getDownloadProgress(downloadId);
    return {
      bytesDownloaded: progress.bytesDownloaded,
      totalBytes: progress.totalBytes,
      status: progress.status as BackgroundDownloadStatus,
      localUri: progress.localUri || undefined,
      reason: progress.reason || undefined,
    };
  }

  /**
   * Move a completed download to the target path
   */
  async moveCompletedDownload(downloadId: number, targetPath: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }

    return await DownloadManagerModule.moveCompletedDownload(downloadId, targetPath);
  }

  /**
   * Subscribe to progress updates for a specific download
   */
  onProgress(downloadId: number, callback: DownloadProgressCallback): () => void {
    const key = `progress_${downloadId}`;
    this.progressListeners.set(key, callback);
    return () => this.progressListeners.delete(key);
  }

  /**
   * Subscribe to completion events for a specific download
   */
  onComplete(downloadId: number, callback: DownloadCompleteCallback): () => void {
    const key = `complete_${downloadId}`;
    this.completeListeners.set(key, callback);
    return () => this.completeListeners.delete(key);
  }

  /**
   * Subscribe to error events for a specific download
   */
  onError(downloadId: number, callback: DownloadErrorCallback): () => void {
    const key = `error_${downloadId}`;
    this.errorListeners.set(key, callback);
    return () => this.errorListeners.delete(key);
  }

  /**
   * Subscribe to all progress updates
   */
  onAnyProgress(callback: DownloadProgressCallback): () => void {
    const key = 'progress_all';
    this.progressListeners.set(key, callback);
    return () => this.progressListeners.delete(key);
  }

  /**
   * Subscribe to all completion events
   */
  onAnyComplete(callback: DownloadCompleteCallback): () => void {
    const key = 'complete_all';
    this.completeListeners.set(key, callback);
    return () => this.completeListeners.delete(key);
  }

  /**
   * Subscribe to all error events
   */
  onAnyError(callback: DownloadErrorCallback): () => void {
    const key = 'error_all';
    this.errorListeners.set(key, callback);
    return () => this.errorListeners.delete(key);
  }

  /**
   * Start polling for progress updates (called automatically on startDownload)
   */
  startProgressPolling(): void {
    if (!this.isAvailable() || this.isPolling) {
      return;
    }
    this.isPolling = true;
    DownloadManagerModule.startProgressPolling();
  }

  /**
   * Stop polling for progress updates
   */
  stopProgressPolling(): void {
    if (!this.isAvailable() || !this.isPolling) {
      return;
    }
    this.isPolling = false;
    DownloadManagerModule.stopProgressPolling();
  }

  /**
   * Clean up all listeners
   */
  cleanup(): void {
    this.stopProgressPolling();
    this.subscriptions.forEach(sub => sub.remove());
    this.subscriptions = [];
    this.progressListeners.clear();
    this.completeListeners.clear();
    this.errorListeners.clear();
  }

  private setupEventListeners(): void {
    if (!this.eventEmitter) return;

    // Progress events
    const progressSub = this.eventEmitter.addListener(
      'DownloadProgress',
      (event: DownloadProgressEvent) => {
        // Notify specific listeners
        const specificKey = `progress_${event.downloadId}`;
        this.progressListeners.get(specificKey)?.(event);

        // Notify global listeners
        this.progressListeners.get('progress_all')?.(event);
      }
    );
    this.subscriptions.push(progressSub);

    // Complete events
    const completeSub = this.eventEmitter.addListener(
      'DownloadComplete',
      (event: DownloadCompleteEvent) => {
        // Notify specific listeners
        const specificKey = `complete_${event.downloadId}`;
        this.completeListeners.get(specificKey)?.(event);

        // Notify global listeners
        this.completeListeners.get('complete_all')?.(event);
      }
    );
    this.subscriptions.push(completeSub);

    // Error events
    const errorSub = this.eventEmitter.addListener(
      'DownloadError',
      (event: DownloadErrorEvent) => {
        // Notify specific listeners
        const specificKey = `error_${event.downloadId}`;
        this.errorListeners.get(specificKey)?.(event);

        // Notify global listeners
        this.errorListeners.get('error_all')?.(event);
      }
    );
    this.subscriptions.push(errorSub);
  }
}

export const backgroundDownloadService = new BackgroundDownloadService();
