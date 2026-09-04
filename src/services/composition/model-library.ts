// Composition root: shared model-library services over Mobile's registry, filesystem, and native
// ports. Every dependency here is a port-only module; nothing in it imports a composition root.
// The port-taking factories and the registry live in `model-library-services.ts` (re-exported here,
// so every existing import path resolves unchanged) because the modules that build them sit BELOW
// the app-composed singletons this module owns.
import {
  ClassifierProvisioningService,
  ImageArchiveImportService,
  ImageDownloadRecoveryService,
  ModelLibraryCommandService,
  once,
} from '@offgrid/models';
import type { ModelFile } from '../../types';
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

export {
  chatModelReadiness,
  modelFileImport,
  modelLibraryRegistry,
  visionMetadataRepair,
  visionRepairApplication,
} from './model-library-services';

export const modelLibraryCommands = once(
  () => new ModelLibraryCommandService(mobileModelLibraryCommandPorts()),
);
export const imageDownloadRecovery = once(
  (): MobileImageDownloadRecovery => new ImageDownloadRecoveryService(mobileImageDownloadRecoveryPorts()),
);
export const imageArchiveImport = once(
  () => new ImageArchiveImportService(mobileImageArchiveImportPorts()),
);
export const classifierProvisioning = once(
  () => new ClassifierProvisioningService<ModelFile, ClassifierModel>(mobileClassifierProvisioningPorts()),
);
