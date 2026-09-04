import { modelsFailureMessage } from '@offgrid/application';
import type { DownloadedModel, ModelFile } from '../types';
import { makeModelKey } from '../utils/modelKey';
import { applicationFacade } from './applicationFacade';
import { mobileTextDownloadRequest } from './modelServices/modelDownloadRequests';
import { useAppStore } from '../stores/appStore';

export interface StartModelDownloadOpts {
  onRegistered?: (model: DownloadedModel) => void;
  onError?: (error: Error) => void;
}

/** Start and install one text artifact through the sole Models application owner. */
export async function startModelDownload(
  repositoryId: string,
  file: ModelFile,
  opts: StartModelDownloadOpts = {},
): Promise<void> {
  const outcome = await applicationFacade().models.downloadAndWait(
    mobileTextDownloadRequest(repositoryId, file),
  );
  if (!outcome.ok) {
    opts.onError?.(new Error(modelsFailureMessage(outcome.failure)));
    return;
  }
  const modelId = makeModelKey(repositoryId, file.name);
  const installed = useAppStore.getState().downloadedModels.find(
    model => model.id === modelId,
  );
  if (!installed) {
    opts.onError?.(new Error(`Downloaded model was not registered: ${modelId}`));
    return;
  }
  opts.onRegistered?.(installed);
}
