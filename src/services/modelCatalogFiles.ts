import type { ModelFile } from '../types';
import { huggingFaceService } from './huggingface';
import logger from '../utils/logger';

/** Resolve each curated model's standard Q4_K_M file from the catalog boundary. */
export async function fetchModelFiles(models: { id: string }[]): Promise<Record<string, ModelFile[]>> {
  const filesMap: Record<string, ModelFile[]> = {};
  await Promise.all(models.map(async model => {
    try {
      const files = await huggingFaceService.getModelFiles(model.id);
      const file = files.find(candidate => candidate.quantization.toUpperCase() === 'Q4_K_M');
      if (file) filesMap[model.id] = [file];
    } catch (error) {
      logger.error(`Error fetching files for ${model.id}:`, error);
    }
  }));
  return filesMap;
}
