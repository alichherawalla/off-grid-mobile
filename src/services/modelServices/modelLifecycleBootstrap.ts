import {
  activeRemoteModelModalities,
  ejectModelResidency,
  ensurePersistentResident,
  modelLoadRefusal,
  modelResidentSpec,
  runIndependentUnloads,
  unloadPersistentResident,
  type ResidentSpec,
} from '@offgrid/models';
import { useAppStore } from '../../stores/appStore';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import logger from '../../utils/logger';
import { nativeModelLifecycle } from '../adapters/native/modelLifecycle';
import { hardwareService } from '../hardware';
import { OverridableMemoryError } from '../modelLoadErrors';
import { estimateTextModelMemoryMB } from '../modelMemory';
import { whisperService, WHISPER_MODELS } from '../whisperService';
import { mobileRouteId } from './mobileRoute';
import { modelResidencyManager } from './residencyBootstrap';
import { lifecycleProjectionPort } from './lifecycleProjectionPort';

interface LoadOptions {
  override?: boolean;
}

let pendingTextModelId: string | null = null;
let pendingImageModelId: string | null = null;
let pendingTranscriptionModelId: string | null = null;

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

export async function loadTextModel(
  modelId: string,
  timeoutMs = 120_000,
  options?: LoadOptions,
): Promise<void> {
  const store = useAppStore.getState();
  const model = store.downloadedModels.find(candidate => candidate.id === modelId);
  if (!model) throw new Error('Model not found');
  pendingTextModelId = modelId;
  try {
    const spec = await resolveTextResidentSpec(modelId);
    const acquired = await ensurePersistentResident({
      manager: modelResidencyManager,
      spec,
      handlers: {
        load: () => nativeModelLifecycle.loadTextModel(
          modelId,
          timeoutMs,
          !!options?.override || modelResidencyManager.hasSessionOverride(modelId),
        ),
        unload: () => nativeModelLifecycle.unloadTextModel(true),
      },
      override: options?.override,
    });
    if (!acquired) throw refusedLoad(options?.override);
    await lifecycleProjectionPort.selectRoute('text', mobileRouteId({
      source: 'local',
      hostId: model.engine,
      modality: 'text',
      modelId,
    }));
  } finally {
    if (pendingTextModelId === modelId) pendingTextModelId = null;
    await lifecycleProjectionPort.refreshInventory();
  }
}

export async function loadImageModel(
  modelId: string,
  timeoutMs = 180_000,
  options?: LoadOptions,
): Promise<void> {
  const currentSpec = nativeModelLifecycle.imageNeedsReload(modelId)
    ? await imageSpec(modelId)
    : null;
  pendingImageModelId = modelId;
  try {
    const spec = currentSpec ?? await imageSpec(modelId);
    const acquired = await ensurePersistentResident({
      manager: modelResidencyManager,
      spec,
      handlers: {
        load: () => nativeModelLifecycle.loadImageModel(modelId, timeoutMs),
        unload: () => nativeModelLifecycle.unloadImageModel(true),
      },
      override: options?.override,
      forceReload: !!currentSpec,
    });
    if (!acquired) throw refusedLoad(options?.override);
    const model = useAppStore.getState().downloadedImageModels.find(
      candidate => candidate.id === modelId,
    );
    if (!model) throw new Error('Model not found');
    await lifecycleProjectionPort.selectRoute('image', mobileRouteId({
      source: 'local',
      hostId: model.backend ?? 'image-runtime',
      modality: 'image',
      modelId,
    }));
  } finally {
    if (pendingImageModelId === modelId) pendingImageModelId = null;
  }
}

/**
 * Load the selected local transcription model through the shared atomic
 * admission and residency lifecycle. Native Whisper remains an I/O adapter.
 */
export async function loadTranscriptionModel(
  modelId: string,
  observer: TranscriptionLifecycleObserver = {},
): Promise<TranscriptionLoadResult> {
  pendingTranscriptionModelId = modelId;
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
    if (pendingTranscriptionModelId === modelId) {
      pendingTranscriptionModelId = null;
    }
    await lifecycleProjectionPort.refreshInventory();
  }
}

export async function unloadTextModel(keepSelection = false): Promise<boolean> {
  const store = useAppStore.getState();
  const modelId = nativeModelLifecycle.getState().loadedTextModelId ??
    store.activeModelId ?? pendingTextModelId;
  if (!modelId) return false;
  const model = store.downloadedModels.find(candidate => candidate.id === modelId);
  const key = model
    ? (await resolveTextResidentSpec(modelId)).key
    : modelResidentSpec({
        modality: 'text',
        modelId,
        routeId: modelId,
        sizeMB: 0,
        residencyKey: 'mobile:text-engine',
      }, modelResidencyManager.getResidents()).key;
  await unloadPersistentResident({
    manager: modelResidencyManager,
    key,
    nativeUnload: () => nativeModelLifecycle.unloadTextModel(true),
  });
  if (!keepSelection) {
    await lifecycleProjectionPort.selectRoute('text', null);
    store.setTextModelEvicted(false);
  }
  await lifecycleProjectionPort.refreshInventory();
  return true;
}

export async function unloadImageModel(keepSelection = false): Promise<boolean> {
  const store = useAppStore.getState();
  const modelId = nativeModelLifecycle.getState().loadedImageModelId ??
    store.activeImageModelId ?? pendingImageModelId;
  if (!modelId) return false;
  const model = store.downloadedImageModels.find(candidate => candidate.id === modelId);
  const key = model
    ? (await imageSpec(modelId)).key
    : modelResidentSpec({
        modality: 'image',
        modelId,
        routeId: modelId,
        sizeMB: 0,
        residencyKey: 'mobile:image-engine',
      }, modelResidencyManager.getResidents()).key;
  await unloadPersistentResident({
    manager: modelResidencyManager,
    key,
    nativeUnload: () => nativeModelLifecycle.unloadImageModel(true),
  });
  if (!keepSelection) {
    await lifecycleProjectionPort.selectRoute('image', null);
  }
  return true;
}

export async function unloadTranscriptionModel(
  modelId?: string | null,
  observer: TranscriptionLifecycleObserver = {},
): Promise<boolean> {
  const selectedModelId = modelId ?? pendingTranscriptionModelId;
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
  const ejected = await ejectModelResidency({
    manager: modelResidencyManager,
    localUnloads: {
      textUnloaded: () => unloadTextModel(true),
      imageUnloaded: () => unloadImageModel(true),
    },
    remoteModalities,
    clearRemoteRoute: modality => lifecycleProjectionPort.selectRoute(modality, null),
  });
  logger.log(`[MODEL-SM] ejectAll → done count=${ejected.count}`);
  return { count: ejected.count };
}
