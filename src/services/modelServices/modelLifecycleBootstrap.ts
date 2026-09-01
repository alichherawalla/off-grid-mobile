import type { ModelModality, ResidentSpec } from '@offgrid/models';
import { useAppStore, useRemoteServerStore } from '../../stores';
import logger from '../../utils/logger';
import { nativeModelLifecycle } from '../adapters/native/modelLifecycle';
import { hardwareService } from '../hardware';
import { OverridableMemoryError } from '../modelLoadErrors';
import { estimateTextModelMemoryMB } from '../modelMemory';
import { remoteServerManager } from '../remoteServerManager';
import { mobileRouteId } from './mobileRoute';
import { modelResidencyManager } from './residencyBootstrap';

interface LoadOptions {
  override?: boolean;
}

let pendingTextModelId: string | null = null;
let pendingImageModelId: string | null = null;

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
  ).finally(() => {
    if (pendingTextModelId === modelId) pendingTextModelId = null;
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
