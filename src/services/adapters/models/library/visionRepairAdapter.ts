import RNFS from 'react-native-fs';
import {
  clearVisionProjector,
  isModelProjectorFile,
  linkVisionProjectors,
  markVisionCapability,
  repairVisionModel,
  saveVisionProjector,
  type VisionRepairLifecyclePorts,
  type VisionRepairOutcome,
} from '@offgrid/models';
import type { DownloadedModel, ModelFile } from '../../../../types';
import { statFile } from '../../../../utils/fileStat';
import { commitModelsList } from './modelRegistryStorageAdapter';
import { performMmProjRepairDownload } from './downloadArtifactAdapter';
import { huggingFaceService } from '../../../huggingface';
import type { DownloadProgressCallback } from './types';

export interface RepairOpts {
  onProgress?: DownloadProgressCallback;
  onDownloadIdReady?: (id: string) => void;
}

export interface VisionRepairContext {
  modelsDir: string;
  initialize(): Promise<void>;
  getDownloadedModels(): Promise<DownloadedModel[]>;
  saveModelWithMmproj(modelId: string, mmProjPath: string): Promise<void>;
  linkOrphanMmProj(): Promise<void>;
  repairMmProj(target: MmProjTarget, opts?: RepairOpts): Promise<void>;
}

function lifecyclePorts(
  ctx: VisionRepairContext,
): VisionRepairLifecyclePorts<DownloadedModel, ModelFile> {
  return {
    listModels: () => ctx.getDownloadedModels(),
    saveModels: commitModelsList,
    async listProjectors() {
      const entries = await RNFS.readDir(ctx.modelsDir).catch(() => []);
      return entries
        .filter(entry => entry.isFile() && isModelProjectorFile(entry.name))
        .map(entry => ({
          name: entry.name,
          path: entry.path,
          size: typeof entry.size === 'string' ? Number.parseInt(entry.size, 10) : entry.size,
        }));
    },
    fileExists: path => RNFS.exists(path).catch(() => false),
    search: fileName => huggingFaceService.findReposPublishing(fileName),
    catalogFiles: (repoId, revision) => huggingFaceService.getModelFiles(repoId, revision),
    projectorFor: file => file.mmProjFile,
    async downloadProjector(input) {
      await ctx.initialize();
      const path = await performMmProjRepairDownload({
        modelId: input.repoId,
        file: input.file,
        onProgress: input.onProgress as DownloadProgressCallback | undefined,
        onDownloadIdReady: input.onDownloadIdReady,
        modelsDir: ctx.modelsDir,
      });
      return {
        path,
        name: path.split('/').pop() ?? path,
        size: (await statFile(path))?.size ?? 0,
      };
    },
  };
}

export function linkOrphanMmProj(ctx: VisionRepairContext): Promise<void> {
  return linkVisionProjectors(lifecyclePorts(ctx));
}

export function repairVision(
  ctx: VisionRepairContext,
  model: DownloadedModel,
  opts?: RepairOpts,
): Promise<VisionRepairOutcome> {
  return repairVisionModel(lifecyclePorts(ctx), model, opts as any);
}

export interface MmProjTarget {
  modelId: string;
  file: ModelFile;
}

export async function repairMmProj(
  ctx: VisionRepairContext,
  { modelId, file }: MmProjTarget,
  opts?: RepairOpts,
): Promise<void> {
  if (!file.mmProjFile) throw new Error('Model file has no associated mmproj');
  await ctx.initialize();
  const path = await performMmProjRepairDownload({
    modelId,
    file,
    modelsDir: ctx.modelsDir,
    ...opts,
  });
  await ctx.saveModelWithMmproj(`${modelId}/${file.name}`, path);
}

export function markVisionModel(
  ctx: VisionRepairContext,
  modelId: string,
): Promise<boolean> {
  return markVisionCapability(lifecyclePorts(ctx), modelId);
}

export async function saveModelWithMmproj(
  ctx: VisionRepairContext,
  modelId: string,
  mmProjPath: string,
): Promise<void> {
  await saveVisionProjector(lifecyclePorts(ctx), modelId, {
    path: mmProjPath,
    name: mmProjPath.split('/').pop() ?? mmProjPath,
    size: (await statFile(mmProjPath))?.size ?? 0,
  });
}

export function clearMmProjLink(
  ctx: VisionRepairContext,
  modelId: string,
): Promise<void> {
  return clearVisionProjector(lifecyclePorts(ctx), modelId);
}
