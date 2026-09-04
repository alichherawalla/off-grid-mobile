// Composition root: shared model-library services over Mobile's registry, filesystem, and native
// ports. Every dependency here is a port-only module; nothing in it imports a composition root.
import {
  ChatModelReadinessService,
  ClassifierProvisioningService,
  ImageArchiveImportService,
  ImageDownloadRecoveryService,
  ModelFileImportApplicationService,
  ModelLibraryCommandService,
  ModelLibraryRegistryService,
  ModelMetadataRepairCommandService,
  VisionRepairApplicationService,
  once,
} from '@offgrid/models';
import type { DownloadedModel, ModelFile, ONNXImageModel } from '../../types';
import { mobileModelLibraryRegistryPorts } from '../modelServices/bootstrap/registryPorts';
import { mobileModelLibraryCommandPorts } from '../modelServices/modelLibraryCommandPorts';
import {
  mobileImageDownloadRecoveryPorts,
  type MobileImageDownloadRecovery,
} from '../modelServices/imageDownloadRecoveryPorts';
import { mobileImageArchiveImportPorts } from '../adapters/models/library/imageArchiveImportPorts';
import {
  mobileClassifierProvisioningPorts,
  type ClassifierModel,
} from '../classifierProvisioningPorts';
import type { MobileVisionRepairApplication } from '../adapters/models/library/visionRepairPorts';

export function modelLibraryRegistry(
  modelsDir: string,
  imageModelsDir: string,
): ModelLibraryRegistryService<DownloadedModel, ONNXImageModel> {
  return new ModelLibraryRegistryService(mobileModelLibraryRegistryPorts(modelsDir, imageModelsDir));
}
export const modelLibraryCommands = once(
  () => new ModelLibraryCommandService(mobileModelLibraryCommandPorts()),
);
export function visionMetadataRepair(
  ports: ConstructorParameters<typeof ModelMetadataRepairCommandService<string[]>>[0],
): ModelMetadataRepairCommandService<string[]> {
  return new ModelMetadataRepairCommandService<string[]>(ports);
}
export const imageDownloadRecovery = once(
  (): MobileImageDownloadRecovery => new ImageDownloadRecoveryService(mobileImageDownloadRecoveryPorts()),
);
export function chatModelReadiness(
  ports: ConstructorParameters<typeof ChatModelReadinessService>[0],
): ChatModelReadinessService {
  return new ChatModelReadinessService(ports);
}
export function visionRepairApplication(
  ports: ConstructorParameters<typeof VisionRepairApplicationService<DownloadedModel, ModelFile, DownloadedModel[]>>[0],
): MobileVisionRepairApplication {
  return new VisionRepairApplicationService<DownloadedModel, ModelFile, DownloadedModel[]>(ports);
}
export function modelFileImport(
  ports: ConstructorParameters<typeof ModelFileImportApplicationService<DownloadedModel>>[0],
): ModelFileImportApplicationService<DownloadedModel> {
  return new ModelFileImportApplicationService<DownloadedModel>(ports);
}
export const imageArchiveImport = once(
  () => new ImageArchiveImportService(mobileImageArchiveImportPorts()),
);
export const classifierProvisioning = once(
  () => new ClassifierProvisioningService<ModelFile, ClassifierModel>(mobileClassifierProvisioningPorts()),
);
