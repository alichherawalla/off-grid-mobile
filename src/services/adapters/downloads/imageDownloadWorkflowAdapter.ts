import {
  createImageDownloadPlan,
  ImageDownloadWorkflowService,
  type DownloadOperationOwner,
  type ImageDownloadPlan,
} from '@offgrid/models';
import { modelDownloadProjection } from '../../../stores/downloadStore';
import type { DownloadEntry } from '../../../utils/downloadStatus';
import type { ImageModelDescriptor } from '../../imageModelDownloadTypes';
import { coordinatedDownloads } from '../../modelServices/coordinatedDownloadBridge';

const workflow = new ImageDownloadWorkflowService<DownloadEntry>(modelDownloadProjection);

export function mobileImageDownloadPlan(model: ImageModelDescriptor): ImageDownloadPlan {
  return createImageDownloadPlan(model);
}

export function beginImageDownload(plan: ImageDownloadPlan): DownloadOperationOwner | undefined {
  return workflow.begin(plan, {
    modelKey: plan.modelKey,
    downloadId: plan.initialDownloadId,
    modelId: plan.modelId,
    fileName: plan.fileName,
    quantization: '',
    modelType: 'image',
    status: 'pending',
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
  workflow.attachTransfer(owner, downloadId, cancelTransfer);
}

export function reportImageDownloadProgress(
  owner: DownloadOperationOwner,
  bytes: number,
  total: number,
): void {
  workflow.progress(owner, bytes, total, Date.now());
}

export function beginImageDownloadProcessing(owner: DownloadOperationOwner): void {
  workflow.processing(owner);
}

export function failImageDownload(owner: DownloadOperationOwner, message: string): void {
  workflow.failed(owner, message);
}

export function completeImageDownload(owner: DownloadOperationOwner): void {
  workflow.complete(owner);
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
  return workflow.cancel(`image:${modelId}`, {
    cancelQueued: async modelKey => { transfers.cancelQueued(modelKey); },
    cancelTransfer: id => transfers.cancelDownload(id),
  });
}

export function currentImageDownload(modelId: string): DownloadOperationOwner | undefined {
  return workflow.current(`image:${modelId}`);
}

export function isActiveImageDownload(owner: DownloadOperationOwner): boolean {
  return workflow.isActive(owner);
}
