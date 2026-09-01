/**
 * Mobile composition for Shared classifier provisioning.
 * Shared owns concurrency, artifact choice, download/select decisions, and recovery.
 */
import { ClassifierProvisioningService } from '@offgrid/models';
import type { DownloadedModel, ModelFile } from '../types';
import { useAppStore } from '../stores';
import { modelLibrary } from './modelServices/bootstrap/modelLibraryBootstrap';
import { huggingFaceService } from './huggingface';
import { startModelDownload } from './startModelDownload';
import { selectMobileModel } from './modelServices';

type ClassifierModel = DownloadedModel & { hostId: string };

const service = new ClassifierProvisioningService<ModelFile, ClassifierModel>({
  snapshot: () => {
    const state = useAppStore.getState();
    return {
      selectedModelId: state.settings.classifierModelId,
      downloadedModels: state.downloadedModels.map(model => ({
        ...model,
        hostId: model.engine,
      })),
      backgroundDownloadSupported:
        modelLibrary.isBackgroundDownloadSupported?.() === true,
    };
  },
  discover: repository => huggingFaceService.getModelFiles(repository),
  select: model => selectMobileModel({
    source: 'local',
    hostId: model.hostId,
    modality: 'classifier',
    modelId: model.id,
  }),
  download: (repository, artifact, callbacks) =>
    startModelDownload(repository, artifact, {
      onRegistered: model => callbacks.onRegistered({
        ...model,
        hostId: model.engine,
      }),
      onError: callbacks.onError,
    }),
});

export function ensureDefaultClassifier(): Promise<void> {
  return service.ensure();
}
