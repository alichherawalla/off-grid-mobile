import {
  modelResidentSpec,
  modelLoadTimeoutMs,
  type ResidentSpec,
  WHISPER_MODELS,
} from '@offgrid/models';
import type { ModelLifecycleApplicationService } from '@offgrid/models';
import { useAppStore } from '../../stores/appStore';
import { activeLocalModelId } from './activeRoute';
import { nativeModelLifecycle } from '../adapters/native/modelLifecycle';
import { hardwareService } from '../hardware';
import { estimateTextModelMemoryMB } from '../modelMemory';
import { mobileRouteId } from './mobileRoute';
import { modelResidencyManager } from './residencyBootstrap';
import { lifecycleProjectionPort } from './lifecycleProjectionPort';

export async function resolveTextResidentSpec(modelId: string): Promise<ResidentSpec> {
  const store = useAppStore.getState();
  const model = store.downloadedModels.find(candidate => candidate.id === modelId);
  if (!model) throw new Error('Model not found');
  const routeId = mobileRouteId({
    source: 'local',
    hostId: model.engine,
    modality: 'text',
    modelId,
  });
  return modelResidentSpec({
    modality: 'text',
    modelId,
    routeId,
    sizeMB: await estimateTextModelMemoryMB(model, store.settings),
    dirtyMemory: model.engine === 'litert',
    residencyKey: 'mobile:text-engine',
  }, modelResidencyManager.getResidents());
}

async function imageSpec(modelId: string): Promise<ResidentSpec> {
  await hardwareService.getDeviceInfo();
  const model = useAppStore.getState().downloadedImageModels.find(
    candidate => candidate.id === modelId,
  );
  if (!model) throw new Error('Model not found');
  const routeId = mobileRouteId({
    source: 'local',
    hostId: model.backend ?? 'image-runtime',
    modality: 'image',
    modelId,
  });
  return modelResidentSpec({
    modality: 'image',
    modelId,
    routeId,
    sizeMB: Math.round(
      (hardwareService.estimateImageModelRam(model) || 0) / (1024 * 1024),
    ),
    dirtyMemory: true,
    residencyKey: 'mobile:image-engine',
  }, modelResidencyManager.getResidents());
}

export function resolveTranscriptionResidentSpec(modelId: string): ResidentSpec {
  const model = WHISPER_MODELS.find(candidate => candidate.id === modelId);
  if (!model) throw new Error(`Unknown transcription model: ${modelId}`);
  const routeId = mobileRouteId({
    source: 'local',
    hostId: 'whisper.rn',
    modality: 'transcription',
    modelId,
  });
  return modelResidentSpec({
    modality: 'transcription',
    modelId,
    routeId,
    sizeMB: model.size,
    residencyKey: 'mobile:transcription-engine',
    lifecycle: 'persistent',
  }, modelResidencyManager.getResidents());
}

/** Native load/unload handlers and route projection. Shared owns the lifecycle. */
export function mobileModelLifecyclePorts(): ConstructorParameters<typeof ModelLifecycleApplicationService>[1] {
  return {
  async resolveLoad(modality, modelId, command) {
    if (modality === 'text') {
      const model = useAppStore.getState().downloadedModels.find(candidate => candidate.id === modelId);
      if (!model) throw new Error('Model not found');
      return {
        spec: await resolveTextResidentSpec(modelId),
        routeId: mobileRouteId({ source: 'local', hostId: model.engine, modality, modelId }),
        handlers: {
          load: () => nativeModelLifecycle.loadTextModel(
            modelId,
            command.timeoutMs ?? modelLoadTimeoutMs('text'),
            command.override || modelResidencyManager.hasSessionOverride(modelId),
          ),
          unload: () => nativeModelLifecycle.unloadTextModel(true),
        },
      };
    }
    if (modality === 'image') {
      const model = useAppStore.getState().downloadedImageModels.find(candidate => candidate.id === modelId);
      if (!model) throw new Error('Model not found');
      return {
        spec: await imageSpec(modelId),
        routeId: mobileRouteId({ source: 'local', hostId: model.backend ?? 'image-runtime', modality, modelId }),
        handlers: {
          load: () => nativeModelLifecycle.loadImageModel(modelId, command.timeoutMs ?? modelLoadTimeoutMs('image')),
          unload: () => nativeModelLifecycle.unloadImageModel(true),
        },
        forceReload: nativeModelLifecycle.imageNeedsReload(modelId),
      };
    }
    throw new Error(`Unsupported persistent lifecycle modality: ${modality}`);
  },
  async resolveUnload(modality) {
    const text = modality === 'text';
    const modelId = text
      ? nativeModelLifecycle.getState().loadedTextModelId ?? activeLocalModelId('text')
      : nativeModelLifecycle.getState().loadedImageModelId ?? activeLocalModelId('image');
    const spec = modelId
      ? (text ? await resolveTextResidentSpec(modelId) : await imageSpec(modelId))
      : modelResidentSpec({
          modality,
          modelId: 'untracked',
          routeId: 'untracked',
          sizeMB: 0,
          residencyKey: text ? 'mobile:text-engine' : 'mobile:image-engine',
        }, modelResidencyManager.getResidents());
    return {
      key: spec.key,
      hadRuntime: !!modelId,
      unload: () => text
        ? nativeModelLifecycle.unloadTextModel(true)
        : nativeModelLifecycle.unloadImageModel(true),
    };
  },
  selectRoute: (modality, routeId) => lifecycleProjectionPort.selectRoute(modality, routeId),
  refreshInventory: async () => { await lifecycleProjectionPort.refreshInventory(); },
};
}
