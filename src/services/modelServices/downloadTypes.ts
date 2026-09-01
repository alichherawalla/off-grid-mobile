import type {
  DownloadModelType as ModelDownloadType,
  DownloadProvider as SharedDownloadProvider,
  RegisteredModelDownload,
} from '@offgrid/models';

export type { DownloadModelType as ModelDownloadType } from '@offgrid/models';
export type ModelDownloadStatus = RegisteredModelDownload['status'];
export type ModelDownload = RegisteredModelDownload;

export type ModelDownloadStartRequest =
  | { modelType: 'text'; modelId: string; file: import('../../types').ModelFile }
  | { modelType: 'image'; model: import('../imageModelDownloadTypes').ImageModelDescriptor }
  | { modelType: 'stt'; modelId: string };

export type ModelDownloadReissueRequest = import('../backgroundDownloadTypes').DownloadParams & {
  modelType: ModelDownloadType;
};

export type DownloadProvider = SharedDownloadProvider<
  ModelDownloadStartRequest,
  ModelDownloadReissueRequest
>;
