/**
 * Memory check helpers for ActiveModelService.
 * All functions are pure/standalone — they receive state via parameter objects.
 */

import { Platform } from 'react-native';
import { DownloadedModel, INFERENCE_BACKENDS, ONNXImageModel } from '../../types';
import { hardwareService } from '../hardware';
import { llmService } from '../llm';
import { liteRTService } from '../litert';
import { estimateRuntimeMemoryBytes, memoryAdvisory } from '@offgrid/models';
import {
  ModelType,
  MemoryCheckResult,
} from './modelStateTypes';
import { useAppStore } from '../../stores';
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

  if (ids.loadedTextModelId && (llmService.isModelLoaded() || liteRTService.isModelLoaded())) {
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
  if (modelType === 'image' && ids.loadedTextModelId && (llmService.isModelLoaded() || liteRTService.isModelLoaded())) {
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

  if (!model) {
    const verdict = memoryAdvisory({
      found: false,
      requiredMemoryMB: 0,
      budgetMB: memoryBudgetGB * 1024,
      warningThresholdMB: warningThresholdGB * 1024,
    });
    return {
      ...projectVerdict(verdict),
      message: 'Model not found',
    };
  }

  const requiredMemoryGB = estimateModelMemoryGB(model, modelType);
  const currentlyLoadedMemoryGB = getOtherLoadedMemoryGB(modelType, ids, lists);
  const modelName = 'name' in model ? model.name : modelId;
  const verdict = memoryAdvisory({
    requiredMemoryMB: requiredMemoryGB * 1024,
    currentlyLoadedMemoryMB: currentlyLoadedMemoryGB * 1024,
    budgetMB: memoryBudgetGB * 1024,
    warningThresholdMB: warningThresholdGB * 1024,
    override: sessionOverride,
  });
  const requiredStr = requiredMemoryGB.toFixed(1);
  const totalStr = (verdict.totalRequiredMemoryMB / 1024).toFixed(1);
  const budgetStr = memoryBudgetGB.toFixed(1);
  let message: string;
  if (sessionOverride) {
    message = `${modelName} — load override approved for this session.`;
  } else if (verdict.severity === 'critical') {
    message =
      currentlyLoadedMemoryGB > 0
        ? `Cannot load ${modelName} (~${requiredStr} GB) while other models are loaded. ` +
          `Total would be ~${totalStr} GB, exceeding your device's ~${budgetStr} GB safe limit. ` +
          `Unload the other model first, or choose a smaller model.`
        : `${modelName} requires ~${requiredStr} GB which exceeds your device's ~${budgetStr} GB safe limit. ` +
          `This model is too large for your device. Choose a smaller model.`;
  } else if (verdict.severity === 'warning') {
    message =
      `Loading ${modelName} will use ~${requiredStr} GB. ` +
      `Total model memory will be ~${totalStr} GB, near your device's safe limit. ` +
      `The app may become slow. Continue anyway?`;
  } else {
    message = `${modelName} requires ~${requiredStr} GB. Safe to load.`;
  }

  return {
    ...projectVerdict(verdict),
    message,
  };
}

function projectVerdict(
  verdict: ReturnType<typeof memoryAdvisory>,
): Omit<MemoryCheckResult, 'message'> {
  return {
    canLoad: verdict.canLoad,
    severity: verdict.severity,
    availableMemoryGB: verdict.availableMemoryMB / 1024,
    requiredMemoryGB: verdict.requiredMemoryMB / 1024,
    currentlyLoadedMemoryGB: verdict.currentlyLoadedMemoryMB / 1024,
    totalRequiredMemoryGB: verdict.totalRequiredMemoryMB / 1024,
    remainingAfterLoadGB: verdict.remainingAfterLoadMB / 1024,
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

  let totalRequiredGB = 0;
  const modelNames: string[] = [];

  if (textModelId) {
    const textModel = lists.downloadedModels.find(m => m.id === textModelId);
    if (textModel) {
      totalRequiredGB += estimateModelMemoryGB(textModel, 'text');
      modelNames.push(textModel.name);
    }
  }

  if (imageModelId) {
    const imageModel = lists.downloadedImageModels.find(m => m.id === imageModelId);
    if (imageModel) {
      totalRequiredGB += estimateModelMemoryGB(imageModel, 'image');
      modelNames.push(imageModel.name);
    }
  }

  const namesStr = modelNames.join(' + ');
  const requiredStr = totalRequiredGB.toFixed(1);
  const budgetStr = memoryBudgetGB.toFixed(1);
  const verdict = memoryAdvisory({
    requiredMemoryMB: totalRequiredGB * 1024,
    budgetMB: memoryBudgetGB * 1024,
    warningThresholdMB: warningThresholdGB * 1024,
  });
  let message: string;

  if (verdict.severity === 'critical') {
    message =
      `Cannot load both models. ` +
      `${namesStr} would require ~${requiredStr} GB, exceeding your device's ~${budgetStr} GB safe limit.`;
  } else if (verdict.severity === 'warning') {
    message =
      `Loading ${namesStr} will use ~${requiredStr} GB, near your device's safe limit. ` +
      `Performance may be affected.`;
  } else {
    message = `${namesStr} will use ~${requiredStr} GB. Safe to load.`;
  }

  return {
    ...projectVerdict(verdict),
    message,
  };
}
