import { DownloadedModel, DownloadProgress, ModelFile } from '../../../../types';

export type DownloadProgressCallback = (progress: DownloadProgress) => void;
export type DownloadCompleteCallback = (model: DownloadedModel) => void;
export type DownloadErrorCallback = (error: Error) => void;

/**
 * @deprecated Legacy metadata callback used by the old appStore-based
 * download tracking. The unified downloadStore now persists everything via
 * the native Room DB. Type retained only so existing callers compile;
 * registering a callback is a no-op.
 */
export type BackgroundDownloadMetadataCallback = (
  downloadId: string,
  info: unknown,
) => void;

export type BackgroundDownloadContext =
  | {
      modelId: string;
      file: ModelFile;
      localPath: string;
      mmProjLocalPath: string | null;
      removeProgressListener: () => void;
      mmProjDownloadId?: string;
      mmProjCompleted: boolean;
      mainCompleted: boolean;
      mainCompleteHandled?: boolean;
      mmProjCompleteHandled?: boolean;
      isFinalizing?: boolean;
      removeMmProjProgressListener?: () => void;
    }
  | { model: DownloadedModel; error: null }
  | { model: null; error: Error };
