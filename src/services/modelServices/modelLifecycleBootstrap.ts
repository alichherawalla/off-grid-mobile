import {
  activeRemoteModelModalities,
  ensurePersistentResident,
  ModelLifecycleApplicationService,
  modelLoadRefusal,
  modelResidentSpec,
  runIndependentUnloads,
  unloadPersistentResident,
  type ResidentSpec,
} from '@offgrid/models';
import { useAppStore } from '../../stores/appStore';
import { activeLocalModelId } from './activeRoute';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import logger from '../../utils/logger';
import { nativeModelLifecycle } from '../adapters/native/modelLifecycle';
import { hardwareService } from '../hardware';
import { OverridableMemoryError } from '../modelLoadErrors';
import { estimateTextModelMemoryMB } from '../modelMemory';
import { whisperService } from '../whisperService';
import { WHISPER_MODELS } from '@offgrid/models';
import { mobileRouteId } from './mobileRoute';
import { modelResidencyManager } from './residencyBootstrap';
import { lifecycleProjectionPort } from './lifecycleProjectionPort';

interface LoadOptions {
  override?: boolean;
}

export type TranscriptionLoadResult = 'loaded' | 'blocked' | 'error';

interface TranscriptionLifecycleObserver {
  onLoaded?(): void;
  onUnloaded?(): void;
}

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

function refusedLoad(override: boolean | undefined): Error {
  const refusal = modelLoadRefusal(!!override);
  return refusal.overridable
    ? new OverridableMemoryError(refusal.message)
    : new Error(refusal.message);
}

const lifecycleService = new ModelLifecycleApplicationService(modelResidencyManager, {
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
            command.timeoutMs ?? 120_000,
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
          load: () => nativeModelLifecycle.loadImageModel(modelId, command.timeoutMs ?? 180_000),
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
});

export async function loadTextModel(
  modelId: string,
  timeoutMs = 120_000,
  options?: LoadOptions,
): Promise<void> {
  const acquired = await lifecycleService.load('text', modelId, {
    override: !!options?.override,
    timeoutMs,
  });
  if (!acquired) throw refusedLoad(options?.override);
}

export async function loadImageModel(
  modelId: string,
  timeoutMs = 180_000,
  options?: LoadOptions,
): Promise<void> {
  const acquired = await lifecycleService.load('image', modelId, {
    override: !!options?.override,
    timeoutMs,
  });
  if (!acquired) throw refusedLoad(options?.override);
}

/**
 * Load the selected local transcription model through the shared atomic
 * admission and residency lifecycle. Native Whisper remains an I/O adapter.
 */
export async function loadTranscriptionModel(
  modelId: string,
  observer: TranscriptionLifecycleObserver = {},
): Promise<TranscriptionLoadResult> {
  try {
    const spec = resolveTranscriptionResidentSpec(modelId);
    const modelPath = whisperService.getModelPath(modelId);
    const acquired = await ensurePersistentResident({
      manager: modelResidencyManager,
      spec,
      handlers: {
        load: async () => {
          await whisperService.loadModel(modelPath);
          observer.onLoaded?.();
        },
        unload: async () => {
          await whisperService.unloadModel();
          observer.onUnloaded?.();
        },
      },
    });
    if (!acquired) return 'blocked';
    const loaded = whisperService.getLoadedModelPath() === modelPath;
    if (loaded) observer.onLoaded?.();
    return loaded ? 'loaded' : 'error';
  } catch (error) {
    logger.error('[TranscriptionLifecycle] Failed to load model', error);
    throw error;
  } finally {
    await lifecycleProjectionPort.refreshInventory();
  }
}

export async function unloadTextModel(keepSelection = false): Promise<boolean> {
  const unloaded = await lifecycleService.unload('text', keepSelection);
  if (!keepSelection) useAppStore.getState().setTextModelEvicted(false);
  return unloaded;
}

export async function unloadImageModel(keepSelection = false): Promise<boolean> {
  return lifecycleService.unload('image', keepSelection);
}

export async function unloadTranscriptionModel(
  modelId?: string | null,
  observer: TranscriptionLifecycleObserver = {},
): Promise<boolean> {
  const selectedModelId = modelId;
  const resident = selectedModelId
    ? resolveTranscriptionResidentSpec(selectedModelId)
    : modelResidencyManager.getResidents().find(
        candidate => candidate.type === 'transcription',
      );
  if (!resident && !whisperService.isModelLoaded()) return false;
  const key = resident?.key ?? 'transcription';
  const unloaded = await unloadPersistentResident({
    manager: modelResidencyManager,
    key,
    nativeUnload: async () => {
      await whisperService.unloadModel();
      observer.onUnloaded?.();
    },
  });
  observer.onUnloaded?.();
  await lifecycleProjectionPort.refreshInventory();
  return unloaded;
}

export async function unloadAllModels(
  keepSelection = false,
): Promise<{ textUnloaded: boolean; imageUnloaded: boolean }> {
  return runIndependentUnloads({
    textUnloaded: () => unloadTextModel(keepSelection),
    imageUnloaded: () => unloadImageModel(keepSelection),
  });
}

export async function ejectAllModels(): Promise<{ count: number }> {
  const remote = useRemoteServerStore.getState();
  const remoteModalities = activeRemoteModelModalities({
    textModelId: remote.activeRemoteTextModelId,
    imageModelId: remote.activeRemoteImageModelId,
    imageServerId: remote.activeRemoteMediaServerIds.image,
    transcriptionServerId: remote.activeRemoteMediaServerIds.transcription,
    voiceServerId: remote.activeRemoteMediaServerIds.voice,
  });
  const hasRemote = remoteModalities.length > 0;
  logger.log(`[MODEL-SM] ejectAll → start hasRemote=${hasRemote}`);
  const ejected = await lifecycleService.eject({
    localUnloads: {
      textUnloaded: () => unloadTextModel(true),
      imageUnloaded: () => unloadImageModel(true),
    },
    remoteModalities,
  });
  logger.log(`[MODEL-SM] ejectAll → done count=${ejected.count}`);
  return { count: ejected.count };
}
