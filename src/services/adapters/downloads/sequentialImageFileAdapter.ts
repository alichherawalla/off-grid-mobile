import RNFS from 'react-native-fs';
import { runSequentialArtifactDownload } from '@offgrid/models';
import { statFile } from '../../../utils/fileStat';
import type { DownloadParams } from '../../backgroundDownloadTypes';

export interface ImageMultifileRuntime {
  controller: AbortController;
  currentDownloadId?: string;
}

export interface ImageMultifileSpec {
  relativePath: string;
  size: number;
  url: string;
}

export interface ImageMultifileTransferPort {
  downloadFileTo(input: {
    params: Pick<DownloadParams, 'url' | 'fileName' | 'modelId' | 'totalBytes' | 'modelType'>;
    destPath: string;
    onProgress(bytes: number, total: number): void;
  }): { downloadIdPromise?: Promise<string>; promise: Promise<void> };
  cancelDownload(id: string): Promise<void>;
}

const CANCELLED = 'user_cancelled';

/** Native file/transfer adapter for Shared sequential artifact orchestration. */
export async function downloadSequentialImageFiles(input: {
  modelId: string;
  runtime: ImageMultifileRuntime;
  modelDir: string;
  files: ImageMultifileSpec[];
  transfers: ImageMultifileTransferPort;
  isCancelled(): boolean;
  onProgress(bytes: number, total: number): void;
}): Promise<void> {
  const result = await runSequentialArtifactDownload({
    artifacts: input.files.map(file => ({
      id: file.relativePath,
      name: file.relativePath,
      url: file.url,
      sizeBytes: file.size,
    })),
    signal: input.runtime.controller.signal,
    interruptedError: CANCELLED,
    ports: {
      // Descriptor sizes can drift. Always enter the transfer port and pass the
      // observed partial byte count so the shared coordinator can resume safely.
      isInstalled: async () => false,
      // The shared coordinator under this transfer port owns byte resume.
      partialBytes: async () => 0,
      transfer: async ({ artifact, onProgress }) => {
        const filePath = `${input.modelDir}/${artifact.name}`;
        const parent = filePath.substring(0, filePath.lastIndexOf('/'));
        if (!(await RNFS.exists(parent))) await RNFS.mkdir(parent);
        const { downloadIdPromise, promise } = input.transfers.downloadFileTo({
          params: {
            url: artifact.url,
            fileName: `${input.modelId}_${artifact.name.replaceAll('/', '_')}`,
            modelId: `image:${input.modelId}`,
            modelType: 'image',
            totalBytes: artifact.sizeBytes,
          },
          destPath: filePath,
          onProgress,
        });
        downloadIdPromise?.then(downloadId => {
          input.runtime.currentDownloadId = downloadId;
          if (input.runtime.controller.signal.aborted) {
            input.transfers.cancelDownload(downloadId).catch(() => undefined);
          }
        }).catch(() => undefined);
        await promise;
        if (input.isCancelled() && !input.runtime.controller.signal.aborted) {
          input.runtime.controller.abort();
        }
        input.runtime.currentDownloadId = undefined;
        return {
          writtenBytes: artifact.sizeBytes ?? 0,
          totalBytes: artifact.sizeBytes ?? 0,
        };
      },
      verifyAndPromote: async artifact => {
        const size = (await statFile(`${input.modelDir}/${artifact.name}`))?.size ?? 0;
        if (size <= 0) throw new Error(`Downloaded file missing or empty: ${artifact.name} — tap retry`);
      },
      removePartial: async artifact => {
        const path = `${input.modelDir}/${artifact.name}`;
        if (await RNFS.exists(path)) await RNFS.unlink(path);
      },
    },
    hooks: {
      progress: value => input.onProgress(value.downloadedBytes, value.totalBytes),
    },
  });
  if (result.success) return;
  const error = new Error(result.error ?? 'Multi-file download failed') as Error & { cancelled?: boolean };
  if (result.error === 'cancelled' || result.error === CANCELLED) error.cancelled = true;
  throw error;
}
