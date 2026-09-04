import {
  modelResidentSpec,
  modelLoadTimeoutMs,
  type ResidentReclaim,
  type ResidentSpec,
  WHISPER_MODELS,
} from '@offgrid/models';
import type {
  ModelLifecycleApplicationService,
  ModelResidencyManager,
} from '@offgrid/models';
import { useAppStore } from '../../stores/appStore';
import { activeLocalModelId } from './activeRoute';
import { nativeModelLifecycle } from '../adapters/native/modelLifecycle';
import { hardwareService } from '../hardware';
import { estimateTextModelMemoryMB } from '../modelMemory';
import { mobileRouteId } from './mobileRoute';
import { lifecycleProjectionPort } from './lifecycleProjectionPort';
import type { NativeRelease } from '../nativeRelease';

/**
 * The one place mobile's native teardown answer becomes residency's answer.
 *
 * Residency admits the next model into memory it believes was reclaimed, so `reclaimed: true` may
 * only mean the engine actually let go. `reason` is carried for the report and is never matched
 * on - the boolean is the gating fact, and a refusal makes admission answer `unload_failed`
 * instead of overcommitting.
 */
async function asReclaim(
  release: Promise<NativeRelease>,
): Promise<ResidentReclaim> {
  const outcome = await release;
  return outcome.released
    ? { reclaimed: true }
    : {
        reclaimed: false,
        reason: outcome.reason ?? 'the engine did not release the model',
      };
}

/**
 * The ONLY two things a resident spec needs from residency: what is already resident, and whether
 * this model has a session memory override.
 *
 * It is a parameter rather than an import because residency is created BY the workspace
 * (`createModelWorkspace` builds the manager from the memory source and logger this app supplies),
 * and the workspace composes these ports. Importing the live manager here made that a cycle -
 * lifecycle ports -> residency bootstrap -> workspace -> lifecycle ports - and the bootstrap's
 * `require('./workspace')` was the edge that closed it. Taking the reads as an argument points the
 * dependency the way composition already runs: the workspace has the manager when it builds these
 * ports, so it hands them the two reads and nothing here has to go looking for it.
 */
export type ResidencyReads = Pick<
  ModelResidencyManager,
  'getResidents' | 'hasSessionOverride'
>;

export async function textResidentSpec(
  modelId: string,
  residency: ResidencyReads,
): Promise<ResidentSpec> {
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
  }, residency.getResidents());
}

async function imageSpec(
  modelId: string,
  residency: ResidencyReads,
): Promise<ResidentSpec> {
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
  }, residency.getResidents());
}

export function transcriptionResidentSpec(
  modelId: string,
  residency: ResidencyReads,
): ResidentSpec {
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
  }, residency.getResidents());
}

/** Native load/unload handlers and route projection. Shared owns the lifecycle. */
export function mobileModelLifecyclePorts(
  residency: ResidencyReads,
): ConstructorParameters<typeof ModelLifecycleApplicationService>[1] {
  return {
  async resolveLoad(modality, modelId, command) {
    if (modality === 'text') {
      const model = useAppStore.getState().downloadedModels.find(candidate => candidate.id === modelId);
      if (!model) throw new Error('Model not found');
      return {
        spec: await textResidentSpec(modelId, residency),
        routeId: mobileRouteId({ source: 'local', hostId: model.engine, modality, modelId }),
        handlers: {
          load: () => nativeModelLifecycle.loadTextModel(
            modelId,
            command.timeoutMs ?? modelLoadTimeoutMs('text'),
            command.override || residency.hasSessionOverride(modelId),
          ),
          unload: () => asReclaim(nativeModelLifecycle.unloadTextModel(true)),
        },
      };
    }
    if (modality === 'image') {
      const model = useAppStore.getState().downloadedImageModels.find(candidate => candidate.id === modelId);
      if (!model) throw new Error('Model not found');
      return {
        spec: await imageSpec(modelId, residency),
        routeId: mobileRouteId({ source: 'local', hostId: model.backend ?? 'image-runtime', modality, modelId }),
        handlers: {
          load: () => nativeModelLifecycle.loadImageModel(modelId, command.timeoutMs ?? modelLoadTimeoutMs('image')),
          unload: () => asReclaim(nativeModelLifecycle.unloadImageModel(true)),
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
      ? (text
          ? await textResidentSpec(modelId, residency)
          : await imageSpec(modelId, residency))
      : modelResidentSpec({
          modality,
          modelId: 'untracked',
          routeId: 'untracked',
          sizeMB: 0,
          residencyKey: text ? 'mobile:text-engine' : 'mobile:image-engine',
        }, residency.getResidents());
    return {
      key: spec.key,
      hadRuntime: !!modelId,
      unload: () => asReclaim(
        text
          ? nativeModelLifecycle.unloadTextModel(true)
          : nativeModelLifecycle.unloadImageModel(true),
      ),
    };
  },
  selectRoute: (modality, routeId) => lifecycleProjectionPort.selectRoute(modality, routeId),
  refreshInventory: async () => { await lifecycleProjectionPort.refreshInventory(); },
};
}
