import type { ProjectedMemoryCheck } from '@offgrid/models';
import type { ModelMemoryAdvisoryService } from '@offgrid/models';
import type { MemoryCheckResult, ModelType } from './modelStateTypes';
import { modelMemoryAdvisory } from '../composition/model-runtime';

const advisory = (): ModelMemoryAdvisoryService => modelMemoryAdvisory();

function renderVerdict(verdict: ProjectedMemoryCheck): MemoryCheckResult {
  return {
    canLoad: verdict.canLoad,
    severity: verdict.severity,
    availableMemoryGB: verdict.availableMemoryMB / 1024,
    requiredMemoryGB: verdict.requiredMemoryMB / 1024,
    currentlyLoadedMemoryGB: verdict.currentlyLoadedMemoryMB / 1024,
    totalRequiredMemoryGB: verdict.totalRequiredMemoryMB / 1024,
    remainingAfterLoadGB: verdict.remainingAfterLoadMB / 1024,
    message: verdict.message,
  };
}

export async function checkMemoryForModel(
  modelId: string,
  modelType: ModelType,
): Promise<MemoryCheckResult> {
  return renderVerdict(await advisory().forSelection(modelId, modelType));
}

export async function checkMemoryForDualModel(
  textModelId: string | null,
  imageModelId: string | null,
): Promise<MemoryCheckResult> {
  return renderVerdict(await advisory().forCombination([
    { id: textModelId, type: 'text' },
    { id: imageModelId, type: 'image' },
  ]));
}
