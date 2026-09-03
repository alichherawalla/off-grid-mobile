// Composition root: shared model-library services over Mobile's registry, filesystem, and native
// lifecycle ports (each exported as a function from its former site).
import {
  ArtifactVerificationService,
  ChatModelReadinessService,
  ClassifierProvisioningService,
  ImageArchiveImportService,
  ImageDownloadRecoveryService,
  ModelFileImportApplicationService,
  ModelLibraryCommandService,
  ModelLibraryRegistryService,
  ModelLifecycleApplicationService,
  ModelMemoryAdvisoryService,
  ModelMetadataRepairCommandService,
  VisionRepairApplicationService,
} from '@offgrid/models';
import type { DownloadedModel, ModelFile, ONNXImageModel } from '../../types';
import { mobileArtifactVerificationFiles } from '../adapters/models/artifactVerificationFilePort';
import { mobileModelLibraryRegistryPorts } from '../modelServices/bootstrap/registryPorts';
import { mobileModelLibraryCommandPorts } from '../modelServices/modelLibraryCommands';
import {
  mobileImageDownloadRecoveryPorts,
  type MobileImageDownloadRecovery,
} from '../modelServices/imageDownloadRecoveryApplication';
import { mobileModelLifecyclePorts } from '../modelServices/modelLifecycleBootstrap';
import { mobileModelMemoryAdvisoryPorts } from '../modelServices/modelMemoryAdvisory';
import { mobileImageArchiveImportPorts } from '../adapters/models/library/imageArchiveImportAdapter';
import {
  mobileClassifierProvisioningPorts,
  type ClassifierModel,
} from '../classifierProvisioning';
import type { MobileVisionRepairApplication } from '../adapters/models/library/visionRepairApplicationAdapter';
import { mobileWorkspace } from '../modelServices/workspace';
import { once } from './once';

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
export const modelLifecycle = once(
  () => new ModelLifecycleApplicationService(mobileWorkspace.residency, mobileModelLifecyclePorts()),
);
export const modelMemoryAdvisory = once(
  () => new ModelMemoryAdvisoryService(mobileWorkspace.residency, mobileModelMemoryAdvisoryPorts()),
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
/** Verification over the React Native filesystem; a caller may add a checksum port. */
export const artifactVerification = once(
  () => new ArtifactVerificationService(mobileArtifactVerificationFiles),
);
export function artifactVerificationWith(
  extra: Partial<ConstructorParameters<typeof ArtifactVerificationService>[0]>,
): ArtifactVerificationService {
  return new ArtifactVerificationService({ ...mobileArtifactVerificationFiles, ...extra });
}
export const classifierProvisioning = once(
  () => new ClassifierProvisioningService<ModelFile, ClassifierModel>(mobileClassifierProvisioningPorts()),
);
