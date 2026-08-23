import { statFile } from '../../utils/fileStat';
import {
  ogamModelTransferBlocker,
  type TransferredModelManifest,
} from '@offgrid/sync';
import type { DownloadedModel, ModelFile } from '../../types';
import {
  buildDownloadedModel,
  determineCredibility,
  persistDownloadedModel,
} from './storage';

export async function registerTransferredModelFile(
  manifest: TransferredModelManifest,
  modelsDir: string,
): Promise<DownloadedModel> {
  const blocker = ogamModelTransferBlocker(manifest);
  if (blocker || (manifest.kind !== 'text' && manifest.kind !== 'vision')) {
    throw new Error('Transferred model manifest is invalid');
  }

  const primary =
    manifest.files.find(file => file.role === 'primary') ??
    manifest.files.find(file => file.role !== 'projector');
  const projector = manifest.files.find(file => file.role === 'projector');
  if (!primary) {
    throw new Error('Transferred model manifest is invalid');
  }

  for (const file of manifest.files) {
    const filePath = `${modelsDir}/${file.name}`;
    const stat = await statFile(filePath);
    if (!stat?.isFile || stat.size !== file.sizeBytes) {
      throw new Error('Transferred model file does not match its manifest');
    }
  }

  const primaryPath = `${modelsDir}/${primary.name}`;
  const projectorPath = projector
    ? `${modelsDir}/${projector.name}`
    : undefined;
  const quantization =
    primary.name.match(/[_-](Q\d+[_\w]*|f16|f32)/i)?.[1]?.toUpperCase() ??
    'Unknown';
  const pseudoFile: ModelFile = {
    name: primary.name,
    size: primary.sizeBytes,
    quantization,
    downloadUrl: '',
    ...(projector
      ? {
          mmProjFile: {
            name: projector.name,
            size: projector.sizeBytes,
            downloadUrl: '',
          },
        }
      : {}),
  };
  const base = await buildDownloadedModel({
    modelId: manifest.id,
    file: pseudoFile,
    resolvedLocalPath: primaryPath,
    mmProjPath: projectorPath,
    // The sender's provenance, when it had any. A received package has no download URL of its own
    // to parse, so this is the only way the copy keeps a repairable source; without it a
    // transferred vision model missing its projector had nowhere to fetch one from.
    origin: manifest.origin,
  });
  const author =
    manifest.source === 'local'
      ? 'Local Import'
      : manifest.id.split('/')[0] || 'Unknown';
  const model: DownloadedModel = {
    ...base,
    id: `${manifest.id}/${primary.name}`,
    name: manifest.name,
    author,
    credibility: determineCredibility(author),
    engine: 'llama',
  };

  await persistDownloadedModel(model, modelsDir);
  return model;
}
