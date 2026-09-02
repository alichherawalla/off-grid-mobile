import { Platform } from 'react-native';
import {
  ModelMemoryAdvisoryService,
  type ModelMemoryAdvisoryArtifact,
  type ProjectedMemoryCheck,
} from '@offgrid/models';
import { INFERENCE_BACKENDS } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { hardwareService } from '../hardware';
import { modelResidencyManager } from './residencyBootstrap';
import type { MemoryCheckResult, ModelType } from './modelStateTypes';

function observedArtifact(
  modelId: string,
  type: ModelType,
): ModelMemoryAdvisoryArtifact | undefined {
  const state = useAppStore.getState();
  if (type === 'text') {
    const model = state.downloadedModels.find(candidate => candidate.id === modelId);
    if (!model) return undefined;
    const backend = state.settings.inferenceBackend;
    return {
      id: model.id,
      name: model.name,
      type,
      artifactBytes: model.fileSize,
      projectorBytes: model.engine === 'llama' ? model.mmProjFileSize : undefined,
      accelerated: !!backend && backend !== INFERENCE_BACKENDS.CPU,
      platform: Platform.OS,
      residencyKey: 'mobile:text-engine',
    };
  }

  const model = state.downloadedImageModels.find(candidate => candidate.id === modelId);
  if (!model) return undefined;
  return {
    id: model.id,
    name: model.name,
    type,
    artifactBytes: model.size,
    nativeEstimatedBytes: hardwareService.estimateImageModelRam?.(model),
    platform: Platform.OS,
    residencyKey: 'mobile:image-engine',
  };
}

const advisory = new ModelMemoryAdvisoryService(modelResidencyManager, {
  async deviceMemory() {
    const device = await hardwareService.getDeviceInfo();
    return {
      totalMB: device.totalMemory / (1024 * 1024),
      availableMB: hardwareService.getAvailableMemoryGB() * 1024,
      platform: Platform.OS,
    };
  },
  artifact: observedArtifact,
});

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
  return renderVerdict(await advisory.forSelection(modelId, modelType));
}

export async function checkMemoryForDualModel(
  textModelId: string | null,
  imageModelId: string | null,
): Promise<MemoryCheckResult> {
  return renderVerdict(await advisory.forCombination([
    { id: textModelId, type: 'text' },
    { id: imageModelId, type: 'image' },
  ]));
}
