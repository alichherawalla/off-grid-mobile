import type { ModelModality, ResidentSpec } from '@offgrid/models';
import { useAppStore, useRemoteServerStore } from '../../stores';
import logger from '../../utils/logger';
import { nativeModelLifecycle } from '../adapters/native/modelLifecycle';
import { hardwareService } from '../hardware';
import { OverridableMemoryError } from '../modelLoadErrors';
import { estimateTextModelMemoryMB } from '../modelMemory';
import { remoteServerManager } from '../remoteServerManager';
import { whisperService, WHISPER_MODELS } from '../whisperService';
import { mobileRouteId } from './mobileRoute';
import { modelResidencyManager } from './residencyBootstrap';
import { refreshMobileLLMServiceInventory } from './mobileLLMService';

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

function existingResidentKey(
  modality: ModelModality,
  modelId: string,
  canonicalKey: string,
): string {
  return modelResidencyManager.getResidents().find(
    resident => resident.type === modality && resident.modelId === modelId,
  )?.key ?? canonicalKey;
}

async function textSpec(modelId: string): Promise<ResidentSpec> {
  const store = useAppStore.getState();
  const model = store.downloadedModels.find(candidate => candidate.id === modelId);
  if (!model) throw new Error('Model not found');
  const routeId = mobileRouteId({
    source: 'local',
    hostId: model.engine,
    modality: 'text',
    modelId,
  });
  return {
    key: existingResidentKey('text', modelId, `text:${routeId}`),
    type: 'text',
    modelId,
    sizeMB: await estimateTextModelMemoryMB(model, store.settings),
    dirtyMemory: model.engine === 'litert',
    residencyKey: 'mobile:text-engine',
  };
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
  return {
    key: existingResidentKey('image', modelId, `image:${routeId}`),
    type: 'image',
    modelId,
    sizeMB: Math.round(
      (hardwareService.estimateImageModelRam(model) || 0) / (1024 * 1024),
    ),
    dirtyMemory: true,
    residencyKey: 'mobile:image-engine',
  };
}

function transcriptionSpec(modelId: string): ResidentSpec {
  const model = WHISPER_MODELS.find(candidate => candidate.id === modelId);
  if (!model) throw new Error(`Unknown transcription model: ${modelId}`);
  const routeId = mobileRouteId({
    source: 'local',
    hostId: 'whisper.rn',
    modality: 'transcription',
    modelId,
  });
  return {
    key: existingResidentKey(
      'transcription',
      modelId,
      `transcription:${routeId}`,
    ),
    type: 'transcription',
    modelId,
    sizeMB: model.size,
    residencyKey: 'mobile:transcription-engine',
    lifecycle: 'persistent',
  };
}

function refusedLoad(override: boolean | undefined): Error {
  return override
    ? new Error(
        'Not enough free memory to load this model, even after freeing other models. Close other apps or choose a smaller model.',
      )
    : new OverridableMemoryError(
        'Not enough free memory to load this model. Close other apps or choose a smaller model.',
      );
}

export async function loadTextModel(
  modelId: string,
  timeoutMs = 120_000,
  options?: LoadOptions,
): Promise<void> {
  pendingTextModelId = modelId;
  const decision = await modelResidencyManager.ensureResidentLazy(
    () => textSpec(modelId),
    {
      load: () => nativeModelLifecycle.loadTextModel(
        modelId,
        timeoutMs,
        !!options?.override || modelResidencyManager.hasSessionOverride(modelId),
      ),
      unload: () => nativeModelLifecycle.unloadTextModel(true),
    },
    { override: options?.override },
  ).finally(async () => {
    if (pendingTextModelId === modelId) pendingTextModelId = null;
    await refreshMobileLLMServiceInventory();
  });
  if (!decision.fits) throw refusedLoad(options?.override);
}

export async function loadImageModel(
  modelId: string,
  timeoutMs = 180_000,
  options?: LoadOptions,
): Promise<void> {
  const currentSpec = nativeModelLifecycle.imageNeedsReload(modelId)
    ? await imageSpec(modelId)
    : null;
  if (currentSpec && modelResidencyManager.isResident(currentSpec.key)) {
    await modelResidencyManager.unload(
      currentSpec.key,
      () => nativeModelLifecycle.unloadImageModel(true),
    );
  }
  pendingImageModelId = modelId;
  const decision = await modelResidencyManager.ensureResidentLazy(
    () => imageSpec(modelId),
    {
      load: () => nativeModelLifecycle.loadImageModel(modelId, timeoutMs),
      unload: () => nativeModelLifecycle.unloadImageModel(true),
    },
    { override: options?.override },
  ).finally(() => {
    if (pendingImageModelId === modelId) pendingImageModelId = null;
  });
  if (!decision.fits) throw refusedLoad(options?.override);
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
    const spec = transcriptionSpec(modelId);
    const modelPath = whisperService.getModelPath(modelId);
    const lease = await modelResidencyManager.acquire(
      spec,
      {
        load: async () => {
          await whisperService.loadModel(modelPath);
          observer.onLoaded?.();
        },
        unload: async () => {
          await whisperService.unloadModel();
          observer.onUnloaded?.();
        },
      },
    );
    if (!lease.acquired) return 'blocked';
    await lease.release();
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
    await refreshMobileLLMServiceInventory();
  }
}

export async function unloadTextModel(keepSelection = false): Promise<boolean> {
  const store = useAppStore.getState();
  const modelId = nativeModelLifecycle.getState().loadedTextModelId ??
    store.activeModelId ?? pendingTextModelId;
  if (!modelId) return false;
  const model = store.downloadedModels.find(candidate => candidate.id === modelId);
  const key = model
    ? (await textSpec(modelId)).key
    : existingResidentKey('text', modelId, `text:${modelId}`);
  await modelResidencyManager.unload(
    key,
    () => nativeModelLifecycle.unloadTextModel(true),
  );
  if (!keepSelection) {
    store.setActiveModelId(null);
    store.setTextModelEvicted(false);
  }
  await refreshMobileLLMServiceInventory();
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
    : existingResidentKey('image', modelId, `image:${modelId}`);
  await modelResidencyManager.unload(
    key,
    () => nativeModelLifecycle.unloadImageModel(true),
  );
  if (!keepSelection) store.setActiveImageModelId(null);
  return true;
}

export async function unloadTranscriptionModel(
  modelId?: string | null,
  observer: TranscriptionLifecycleObserver = {},
): Promise<boolean> {
  const selectedModelId = modelId ?? pendingTranscriptionModelId;
  const resident = selectedModelId
    ? transcriptionSpec(selectedModelId)
    : modelResidencyManager.getResidents().find(
        candidate => candidate.type === 'transcription',
      );
  if (!resident && !whisperService.isModelLoaded()) return false;
  const key = resident?.key ?? 'transcription';
  const unloaded = await modelResidencyManager.unload(key, async () => {
    await whisperService.unloadModel();
    observer.onUnloaded?.();
  });
  observer.onUnloaded?.();
  await refreshMobileLLMServiceInventory();
  return unloaded;
}

export async function unloadAllModels(
  keepSelection = false,
): Promise<{ textUnloaded: boolean; imageUnloaded: boolean }> {
  let textUnloaded = false;
  let imageUnloaded = false;
  try {
    textUnloaded = await unloadTextModel(keepSelection);
  } catch {
    // Continue so one failed native engine does not strand the other engine.
  }
  try {
    imageUnloaded = await unloadImageModel(keepSelection);
  } catch {
    // Return the partial result to the caller.
  }
  return { textUnloaded, imageUnloaded };
}

export async function ejectAllModels(): Promise<{ count: number }> {
  const remote = useRemoteServerStore.getState();
  const hasRemote = !!(
    remote.activeRemoteTextModelId || remote.activeRemoteImageModelId
  );
  logger.log(`[MODEL-SM] ejectAll → start hasRemote=${hasRemote}`);
  const local = await unloadAllModels(true);
  let count = Number(local.textUnloaded) + Number(local.imageUnloaded);
  const sidecars = await modelResidencyManager.evictAll();
  count += sidecars.length;
  if (hasRemote) {
    remoteServerManager.clearActiveRemoteModel();
    count += 1;
  }
  logger.log(`[MODEL-SM] ejectAll → done count=${count}`);
  return { count };
}
