import RNFS from 'react-native-fs';
import type { ModelDownloadCoordinator } from '@offgrid/models';
import { modelDownloadCoordinator } from '../composition/downloads';
import { ModelDownloadFileAdapter } from '../adapters/downloads/modelDownloadFileAdapter';
import { modelDownloadPersistenceAdapter } from '../adapters/downloads/modelDownloadPersistenceAdapter';
import { nativeDownloadTransferAdapter } from '../adapters/downloads/nativeDownloadTransferAdapter';

/** Persistence, files, and native transfers. Shared owns queueing and recovery. */
export function mobileModelDownloadPorts(): ConstructorParameters<typeof ModelDownloadCoordinator>[0] {
  return {
    persistence: modelDownloadPersistenceAdapter,
    files: new ModelDownloadFileAdapter(RNFS.DocumentDirectoryPath),
    transfers: nativeDownloadTransferAdapter,
    concurrency: 3,
  };
}

export const mobileModelDownloadCoordinator = modelDownloadCoordinator();
