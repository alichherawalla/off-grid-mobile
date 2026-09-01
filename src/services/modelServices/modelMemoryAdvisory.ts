/**
 * Memory check helpers for ActiveModelService.
 * All functions are pure/standalone — they receive state via parameter objects.
 */

import { Platform } from 'react-native';
import { DownloadedModel, INFERENCE_BACKENDS, ONNXImageModel } from '../../types';
import { hardwareService } from '../hardware';
import {
  estimateRuntimeMemoryBytes,
  modelMemoryAdvisoryForCombination,
  modelMemoryAdvisoryForSelection,
  type ProjectedMemoryCheck,
} from '@offgrid/models';
import {
  ModelType,
  MemoryCheckResult,
} from './modelStateTypes';
import { useAppStore } from '../../stores/appStore';
import { modelMemoryBudgetMB, modelWarningThresholdMB, LoadPolicy } from '../memoryBudget';

// ---------------------------------------------------------------------------
// Budget helpers
// ---------------------------------------------------------------------------

// The pre-load check reads the SAME budget owner as the residency manager, so it
// must honour the SAME load policy — otherwise aggressive mode would relax the
// residency gate while the pre-check kept blocking/warning at balanced limits.
const getMemoryBudgetGB = async (policy: LoadPolicy = 'balanced'): Promise<number> => {
  const deviceInfo = await hardwareService.getDeviceInfo();
  const totalMB = deviceInfo.totalMemory / (1024 * 1024);
  return modelMemoryBudgetMB(totalMB, undefined, policy) / 1024;
};

const getMemoryWarningThresholdGB = async (): Promise<number> => {
  const deviceInfo = await hardwareService.getDeviceInfo();
  const totalMB = deviceInfo.totalMemory / (1024 * 1024);
  return modelWarningThresholdMB(totalMB) / 1024;
};

// ---------------------------------------------------------------------------
// Size estimators
// ---------------------------------------------------------------------------

function estimateModelMemoryGB(
  model: DownloadedModel | ONNXImageModel,
  type: ModelType,
): number {
  if (type === 'text') {
    const textModel = model as DownloadedModel;
    const backend = useAppStore.getState().settings.inferenceBackend;
    return estimateRuntimeMemoryBytes({
      artifactBytes: textModel.fileSize || 0,
      modality: 'text',
      accelerated: !!backend && backend !== INFERENCE_BACKENDS.CPU,
    }) / (1024 * 1024 * 1024);
  }
  const imageModel = model as ONNXImageModel;
  // ONE image-RAM estimator: delegate to the authoritative load-gate estimator so the
  // advisory pre-check and the gate can't diverge ('Safe to load' then a hard refusal).
  const estimate = hardwareService.estimateImageModelRam?.(imageModel);
  if (estimate != null) return estimate / (1024 * 1024 * 1024);
  return estimateRuntimeMemoryBytes({
    artifactBytes: imageModel.size || 0,
    modality: 'image',
    platform: Platform.OS,
  }) / (1024 * 1024 * 1024);
}

export interface LoadedModelIds {
  loadedTextModelId: string | null;
  loadedImageModelId: string | null;
}

export interface ModelLists {
  downloadedModels: DownloadedModel[];
  downloadedImageModels: ONNXImageModel[];
}

export function getCurrentlyLoadedMemoryGB(
  ids: LoadedModelIds,
  lists: ModelLists,
): number {
  let totalGB = 0;

  if (ids.loadedTextModelId) {
    const textModel = lists.downloadedModels.find(m => m.id === ids.loadedTextModelId);
    if (textModel) {
      totalGB += estimateModelMemoryGB(textModel, 'text');
    }
  }

  if (ids.loadedImageModelId) {
    const imageModel = lists.downloadedImageModels.find(
      m => m.id === ids.loadedImageModelId,
    );
    if (imageModel) {
      totalGB += estimateModelMemoryGB(imageModel, 'image');
    }
  }

  return totalGB;
}

/** Memory used by OTHER models already loaded (not the one being replaced). */
export function getOtherLoadedMemoryGB(
  modelType: ModelType,
  ids: LoadedModelIds,
  lists: ModelLists,
): number {
  let totalGB = 0;
  if (modelType === 'text' && ids.loadedImageModelId) {
    const imageModel = lists.downloadedImageModels.find(
      m => m.id === ids.loadedImageModelId,
    );
    if (imageModel) {
      totalGB += estimateModelMemoryGB(imageModel, 'image');
    }
  }
  if (modelType === 'image' && ids.loadedTextModelId) {
    const textModel = lists.downloadedModels.find(m => m.id === ids.loadedTextModelId);
    if (textModel) {
      totalGB += estimateModelMemoryGB(textModel, 'text');
    }
  }
  return totalGB;
}

// ---------------------------------------------------------------------------
// checkMemoryForModel
// ---------------------------------------------------------------------------

export interface CheckMemoryParams {
  modelId: string;
  modelType: ModelType;
  ids: LoadedModelIds;
  lists: ModelLists;
  /** Active load policy. Defaults to balanced so existing callers are unchanged. */
  policy?: LoadPolicy;
  /** User already approved a memory override for this model this session → don't re-prompt. */
  sessionOverride?: boolean;
}

export async function checkMemoryForModel(
  params: CheckMemoryParams,
): Promise<MemoryCheckResult> {
  const { modelId, modelType, ids, lists, policy, sessionOverride } = params;
  const memoryBudgetGB = await getMemoryBudgetGB(policy);
  const warningThresholdGB = await getMemoryWarningThresholdGB();

  const model =
    modelType === 'text'
      ? lists.downloadedModels.find(m => m.id === modelId)
      : lists.downloadedImageModels.find(m => m.id === modelId);
  const currentlyLoadedMemoryGB = getOtherLoadedMemoryGB(modelType, ids, lists);
  return projectVerdict(modelMemoryAdvisoryForSelection({
    model: model
      ? {
          id: modelId,
          name: model.name,
          type: modelType,
          requiredMemoryMB: estimateModelMemoryGB(model, modelType) * 1024,
        }
      : undefined,
    otherLoadedMemoryMB: currentlyLoadedMemoryGB * 1024,
    budgetMB: memoryBudgetGB * 1024,
    warningThresholdMB: warningThresholdGB * 1024,
    sessionOverride,
  }));
}

function projectVerdict(
  verdict: ProjectedMemoryCheck,
): MemoryCheckResult {
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

// ---------------------------------------------------------------------------
// checkMemoryForDualModel
// ---------------------------------------------------------------------------

export interface CheckDualMemoryParams {
  textModelId: string | null;
  imageModelId: string | null;
  lists: ModelLists;
}

export async function checkMemoryForDualModel(
  params: CheckDualMemoryParams,
): Promise<MemoryCheckResult> {
  const { textModelId, imageModelId, lists } = params;
  const memoryBudgetGB = await getMemoryBudgetGB();
  const warningThresholdGB = await getMemoryWarningThresholdGB();

  const models: Array<{
    id: string;
    name: string;
    type: ModelType;
    requiredMemoryMB: number;
  }> = [];

  if (textModelId) {
    const textModel = lists.downloadedModels.find(m => m.id === textModelId);
    if (textModel) {
      models.push({
        id: textModel.id,
        name: textModel.name,
        type: 'text',
        requiredMemoryMB: estimateModelMemoryGB(textModel, 'text') * 1024,
      });
    }
  }

  if (imageModelId) {
    const imageModel = lists.downloadedImageModels.find(m => m.id === imageModelId);
    if (imageModel) {
      models.push({
        id: imageModel.id,
        name: imageModel.name,
        type: 'image',
        requiredMemoryMB: estimateModelMemoryGB(imageModel, 'image') * 1024,
      });
    }
  }

  return projectVerdict(modelMemoryAdvisoryForCombination({
    models,
    budgetMB: memoryBudgetGB * 1024,
    warningThresholdMB: warningThresholdGB * 1024,
  }));
}
