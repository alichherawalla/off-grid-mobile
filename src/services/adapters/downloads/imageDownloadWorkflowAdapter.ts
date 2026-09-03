import {
  type DownloadOperationOwner,
  type ImageDownloadPlan,
} from '@offgrid/models';
import { modelDownloadProjection } from '../../../stores/downloadStore';
import { coordinatedDownloads } from '../../modelServices/coordinatedDownloadBridge';
import { imageDownloadWorkflow } from '../../composition/downloads';


export function beginImageDownload(plan: ImageDownloadPlan): DownloadOperationOwner | undefined {
  return imageDownloadWorkflow().begin(plan, {
    modelKey: plan.modelKey,
    downloadId: plan.initialDownloadId,
    modelId: plan.modelId,
    fileName: plan.fileName,
    quantization: '',
    modelType: 'image',
    status: 'queued',
    bytesDownloaded: 0,
    totalBytes: plan.totalBytes,
    combinedTotalBytes: plan.totalBytes,
    progress: 0,
    createdAt: Date.now(),
    metadataJson: plan.metadataJson,
  });
}

export function attachImageTransfer(
  owner: DownloadOperationOwner,
  downloadId: string,
  cancelTransfer: (id: string) => Promise<void> = id => coordinatedDownloads.cancelDownload(id),
): void {
  imageDownloadWorkflow().attachTransfer(owner, downloadId, cancelTransfer);
}

export function reportImageDownloadProgress(
  owner: DownloadOperationOwner,
  bytes: number,
  total: number,
): void {
  imageDownloadWorkflow().progress(owner, bytes, total, Date.now());
}

export function beginImageDownloadProcessing(owner: DownloadOperationOwner): void {
  imageDownloadWorkflow().processing(owner);
}

export function failImageDownload(owner: DownloadOperationOwner, message: string): void {
  imageDownloadWorkflow().failed(owner, message);
}

export function completeImageDownload(owner: DownloadOperationOwner): void {
  imageDownloadWorkflow().complete(owner);
}

export function removeImageDownloadRecord(modelId: string): void {
  modelDownloadProjection.remove(`image:${modelId}`);
}

export function failImageDownloadRecord(downloadId: string, message: string): void {
  modelDownloadProjection.reportStatus(downloadId, 'failed', { message });
}

export async function cancelOwnedImageDownload(
  modelId: string,
  transfers: {
    cancelQueued(modelKey: string): unknown
    cancelDownload(downloadId: string): Promise<void>
  } = coordinatedDownloads,
): Promise<boolean> {
  return imageDownloadWorkflow().cancel(`image:${modelId}`, {
    cancelQueued: async modelKey => { transfers.cancelQueued(modelKey); },
    cancelTransfer: id => transfers.cancelDownload(id),
  });
}

export function isActiveImageDownload(owner: DownloadOperationOwner): boolean {
  return imageDownloadWorkflow().isActive(owner);
}
