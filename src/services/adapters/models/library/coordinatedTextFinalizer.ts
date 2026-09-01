import RNFS from 'react-native-fs';
import type { PersistedModelDownload } from '@offgrid/models';
import type { ModelFile } from '../../../../types';
import { mobileModelDownloadCoordinator } from '../../../modelServices/modelDownloadCoordinator';
import { buildDownloadedModel, persistDownloadedModel } from './modelRegistryStorageAdapter';
import logger from '../../../../utils/logger';

interface TextMetadata {
  owner: 'mobile-text';
  file: ModelFile;
  localPath: string;
  mmProjLocalPath: string | null;
}

const completed = new Set<string>();
const finalizing = new Set<string>();
let unsubscribe: (() => void) | undefined;

function metadataFor(record: PersistedModelDownload): TextMetadata | null {
  const value = record.manifest.metadata as Partial<TextMetadata> | undefined;
  return value?.owner === 'mobile-text' && value.file && value.localPath
    ? value as TextMetadata
    : null;
}

async function finalize(record: PersistedModelDownload, modelsDir: string): Promise<void> {
  const metadata = metadataFor(record);
  if (!metadata || record.phase !== 'completed' || completed.has(record.manifest.id)) return;
  if (finalizing.has(record.manifest.id)) return;
  finalizing.add(record.manifest.id);
  try {
    const projectorExists = metadata.mmProjLocalPath
      ? await RNFS.exists(metadata.mmProjLocalPath)
      : false;
    const model = await buildDownloadedModel({
      modelId: record.manifest.modelId,
      file: metadata.file,
      resolvedLocalPath: metadata.localPath,
      mmProjPath: projectorExists ? metadata.mmProjLocalPath ?? undefined : undefined,
      expectedMmProjFileName: !projectorExists ? metadata.file.mmProjFile?.name : undefined,
    });
    await persistDownloadedModel(model, modelsDir);
    completed.add(record.manifest.id);
  } catch (error) {
    logger.error('[ModelDownload] restored text finalization failed', {
      id: record.manifest.id,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    finalizing.delete(record.manifest.id);
  }
}

/** Keep registration attached to the Shared coordinator across Mobile process relaunch. */
export function startCoordinatedTextFinalizer(modelsDir: string): () => void {
  const scan = () => {
    for (const record of mobileModelDownloadCoordinator.list()) finalize(record, modelsDir);
  };
  if (!unsubscribe) unsubscribe = mobileModelDownloadCoordinator.subscribe(scan);
  scan();
  return () => undefined;
}
