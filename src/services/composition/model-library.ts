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
  ModelMetadataRepairCommandService,
  VisionRepairApplicationService,
} from '@offgrid/models';
import type { DownloadedModel, ModelFile, ONNXImageModel } from '../../types';
import type { MobileImageDownloadRecovery } from '../modelServices/imageDownloadRecoveryApplication';
import type { ClassifierModel } from '../classifierProvisioning';
import type { MobileVisionRepairApplication } from '../adapters/models/library/visionRepairApplicationAdapter';
import { once } from '@offgrid/models';

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports1 = (): typeof import('../adapters/models/artifactVerificationFilePort') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../adapters/models/artifactVerificationFilePort') as typeof import('../adapters/models/artifactVerificationFilePort');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports2 = (): typeof import('../modelServices/bootstrap/registryPorts') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/bootstrap/registryPorts') as typeof import('../modelServices/bootstrap/registryPorts');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports3 = (): typeof import('../modelServices/modelLibraryCommands') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/modelLibraryCommands') as typeof import('../modelServices/modelLibraryCommands');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports4 = (): typeof import('../modelServices/imageDownloadRecoveryApplication') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/imageDownloadRecoveryApplication') as typeof import('../modelServices/imageDownloadRecoveryApplication');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports7 = (): typeof import('../adapters/models/library/imageArchiveImportAdapter') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../adapters/models/library/imageArchiveImportAdapter') as typeof import('../adapters/models/library/imageArchiveImportAdapter');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports8 = (): typeof import('../classifierProvisioning') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../classifierProvisioning') as typeof import('../classifierProvisioning');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports9 = (): typeof import('../modelServices/workspace') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/workspace') as typeof import('../modelServices/workspace');

export function modelLibraryRegistry(
  modelsDir: string,
  imageModelsDir: string,
): ModelLibraryRegistryService<DownloadedModel, ONNXImageModel> {
  return new ModelLibraryRegistryService(ports2().mobileModelLibraryRegistryPorts(modelsDir, imageModelsDir));
}
export const modelLibraryCommands = once(
  () => new ModelLibraryCommandService(ports3().mobileModelLibraryCommandPorts()),
);
export function visionMetadataRepair(
  ports: ConstructorParameters<typeof ModelMetadataRepairCommandService<string[]>>[0],
): ModelMetadataRepairCommandService<string[]> {
  return new ModelMetadataRepairCommandService<string[]>(ports);
}
export const imageDownloadRecovery = once(
  (): MobileImageDownloadRecovery => new ImageDownloadRecoveryService(ports4().mobileImageDownloadRecoveryPorts()),
);
export const modelLifecycle = once(
  () => ports9().mobileWorkspace.lifecycle,
);
export const modelMemoryAdvisory = once(
  () => ports9().mobileWorkspace.memoryAdvisory,
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
  () => new ImageArchiveImportService(ports7().mobileImageArchiveImportPorts()),
);
/** Verification over the React Native filesystem; a caller may add a checksum port. */
export const artifactVerification = once(
  () => new ArtifactVerificationService(ports1().mobileArtifactVerificationFiles),
);
export function artifactVerificationWith(
  extra: Partial<ConstructorParameters<typeof ArtifactVerificationService>[0]>,
): ArtifactVerificationService {
  return new ArtifactVerificationService({ ...ports1().mobileArtifactVerificationFiles, ...extra });
}
export const classifierProvisioning = once(
  () => new ClassifierProvisioningService<ModelFile, ClassifierModel>(ports8().mobileClassifierProvisioningPorts()),
);
