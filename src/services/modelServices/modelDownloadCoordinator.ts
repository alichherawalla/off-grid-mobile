import RNFS from 'react-native-fs';
import { ModelDownloadCoordinator } from '@offgrid/models';
import { ModelDownloadFileAdapter } from '../adapters/downloads/modelDownloadFileAdapter';
import { modelDownloadPersistenceAdapter } from '../adapters/downloads/modelDownloadPersistenceAdapter';
import { nativeDownloadTransferAdapter } from '../adapters/downloads/nativeDownloadTransferAdapter';

export const mobileModelDownloadCoordinator = new ModelDownloadCoordinator({
  persistence: modelDownloadPersistenceAdapter,
  files: new ModelDownloadFileAdapter(RNFS.DocumentDirectoryPath),
  transfers: nativeDownloadTransferAdapter,
  concurrency: 3,
});
