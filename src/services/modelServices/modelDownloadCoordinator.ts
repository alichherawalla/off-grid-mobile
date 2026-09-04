import RNFS from 'react-native-fs';
import { once } from '@offgrid/models';
import { createModelDownloadCoordinator } from '../composition/downloads';
import { ModelDownloadFileAdapter } from '../adapters/downloads/modelDownloadFileAdapter';
import { modelDownloadPersistenceAdapter } from '../adapters/downloads/modelDownloadPersistenceAdapter';
import { nativeDownloadTransferAdapter } from '../adapters/downloads/nativeDownloadTransferAdapter';

/** Persistence, files, and native transfers. Shared owns queueing and recovery. */
export function mobileModelDownloadPorts(): Parameters<typeof createModelDownloadCoordinator>[0] {
  return {
    persistence: modelDownloadPersistenceAdapter,
    files: new ModelDownloadFileAdapter(RNFS.DocumentDirectoryPath),
    transfers: nativeDownloadTransferAdapter,
    concurrency: 3,
  };
}

const coordinator = once(
  () => createModelDownloadCoordinator(mobileModelDownloadPorts()),
);

export const mobileModelDownloadCoordinator = coordinator();
