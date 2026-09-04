import type { ProjectedMemoryCheck } from '@offgrid/models';
import type { MemoryCheckResult, ModelType } from './modelStateTypes';
import { applicationFacade } from '../applicationFacade';

/**
 * "Will this fit" comes from the FACADE's `memoryAdvice` seam, not from a held ModelWorkspace.
 * `forSelection` and `forCombination` are the two questions this file asks and the only two the
 * seam exposes, so the adoption is a change of owner with no shape change - both already answered
 * with the same `ProjectedMemoryCheck` the renderer below reads.
 */
const advisory = () => applicationFacade().models.memoryAdvice;

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
