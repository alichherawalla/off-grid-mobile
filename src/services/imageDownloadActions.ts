import type { DownloadOperationOwner } from '@offgrid/models';
import { hideAlert, showAlert } from '../utils/alertState';
import type { ONNXImageModel } from '../types';
import type { ImageDownloadDeps, ImageModelDescriptor } from './imageModelDownloadTypes';
import { cancelOwnedImageDownload } from './adapters/downloads/imageDownloadWorkflowAdapter';
import { executeMobileImageDownload } from './adapters/downloads/imageDownloadApplicationAdapter';
import { coordinatedDownloads } from './modelServices/coordinatedDownloadBridge';

export type { ImageDownloadDeps } from './imageModelDownloadTypes';

export async function cancelSyntheticImageDownload(modelId: string): Promise<void> {
  await cancelOwnedImageDownload(modelId, coordinatedDownloads);
}

function renderResult(
  result: Awaited<ReturnType<typeof executeMobileImageDownload>>,
  model: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): void {
  if (result.status === 'blocked') {
    deps.setAlertState(showAlert('Incompatible Model', result.message, [{ text: 'OK', style: 'cancel' }]));
    return;
  }
  if (result.status === 'confirmation-required') {
    deps.setAlertState(showAlert('Incompatible Model', result.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Download Anyway', style: 'destructive', onPress: () => {
          deps.setAlertState(hideAlert());
          executeMobileImageDownload({ type: 'download', model, overrideCompatibility: true }, deps)
            .then(next => renderResult(next, model, deps))
            .catch(() => undefined);
        },
      },
    ]));
    return;
  }
  if (result.status === 'failed') return;
}

export async function proceedWithDownload(model: ImageModelDescriptor, deps: ImageDownloadDeps): Promise<void> {
  deps.setAlertState({
    ...showAlert('Download Started', 'Keep app open while image model processes'), closeLabel: '',
  });
  const result = await executeMobileImageDownload(
    { type: 'download', model, overrideCompatibility: true }, deps,
  );
  renderResult(result, model, deps);
}

export async function handleDownloadImageModel(model: ImageModelDescriptor, deps: ImageDownloadDeps): Promise<void> {
  const result = await executeMobileImageDownload({ type: 'download', model }, deps);
  renderResult(result, model, deps);
}

export function downloadHuggingFaceModel(model: ImageModelDescriptor, deps: ImageDownloadDeps): Promise<void> {
  return proceedWithDownload(model, deps);
}

export function downloadCoreMLMultiFile(model: ImageModelDescriptor, deps: ImageDownloadDeps): Promise<void> {
  return proceedWithDownload(model, deps);
}

/** Compatibility bridge for callers that already hold a fully described on-disk model. */
export async function registerAndNotify(
  deps: ImageDownloadDeps,
  input: { imageModel: ONNXImageModel; modelName: string; owner?: DownloadOperationOwner },
): Promise<void> {
  const model = input.imageModel;
  const descriptor: ImageModelDescriptor = {
    id: model.id, name: input.modelName, description: model.description, downloadUrl: '',
    size: model.size, style: model.style ?? '', backend: model.backend ?? 'coreml',
    attentionVariant: model.attentionVariant,
  };
  const result = await executeMobileImageDownload({
    type: 'register-existing', model: descriptor, modelDirectory: model.modelPath,
  }, deps);
  renderResult(result, descriptor, deps);
}
