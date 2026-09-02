import type {
  DownloadModelType,
  DownloadProvider as SharedDownloadProvider,
  RegisteredModelDownload,
} from '@offgrid/models';

export type { DownloadModelType } from '@offgrid/models';
export type ModelDownload = RegisteredModelDownload;

export type ModelDownloadStartRequest =
  | {
      modelType: 'text';
      modelId: string;
      file: import('../../types').ModelFile;
    }
  | {
      modelType: 'image';
      model: import('../imageModelDownloadTypes').ImageModelDescriptor;
    }
  | { modelType: 'stt'; modelId: string };

export type ModelDownloadReissueRequest =
  import('../backgroundDownloadTypes').DownloadParams & {
    modelType: DownloadModelType;
  };

export type DownloadProvider = SharedDownloadProvider<
  ModelDownloadStartRequest,
  ModelDownloadReissueRequest
>;
