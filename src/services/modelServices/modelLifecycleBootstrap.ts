import { useModelResidencyStore } from '../../stores/modelResidencyStore';
import {
  ensurePersistentResident,
  modelLoadRefusal,
  runIndependentUnloads,
  unloadPersistentResident,
} from '@offgrid/models';
import type { ModelLifecycleApplicationService } from '@offgrid/models';
import { activeRouteIsRemote } from './activeRoute';
import logger from '../../utils/logger';
import { OverridableMemoryError } from '../modelLoadErrors';
import { whisperService } from '../whisperService';
import { modelResidencyManager } from './residencyBootstrap';
import { lifecycleProjectionPort } from './lifecycleProjectionPort';
import { modelLifecycle } from '../composition/model-runtime';
import { resolveTextResidentSpec, resolveTranscriptionResidentSpec } from './modelLifecyclePorts';

export { resolveTextResidentSpec, resolveTranscriptionResidentSpec };

interface LoadOptions {
  override?: boolean;
}

export type TranscriptionLoadResult = 'loaded' | 'blocked' | 'error';

interface TranscriptionLifecycleObserver {
  onLoaded?(): void;
  onUnloaded?(): void;
}

function refusedLoad(override: boolean | undefined): Error {
  const refusal = modelLoadRefusal(!!override);
  return refusal.overridable
    ? new OverridableMemoryError(refusal.message)
    : new Error(refusal.message);
}

const lifecycleService = (): ModelLifecycleApplicationService => modelLifecycle();

export async function loadTextModel(
  modelId: string,
  timeoutMs?: number,
  options?: LoadOptions,
): Promise<void> {
  const acquired = await lifecycleService().load('text', modelId, {
    override: !!options?.override,
    timeoutMs,
  });
  if (!acquired) throw refusedLoad(options?.override);
}

export async function loadImageModel(
  modelId: string,
  timeoutMs?: number,
  options?: LoadOptions,
): Promise<void> {
  const acquired = await lifecycleService().load('image', modelId, {
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
  const unloaded = await lifecycleService().unload('text', keepSelection);
  if (!keepSelection) useModelResidencyStore.getState().setTextModelEvicted(false);
  return unloaded;
}

export async function unloadImageModel(keepSelection = false): Promise<boolean> {
  return lifecycleService().unload('image', keepSelection);
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
  // Which modalities a remote route answers is the active route's fact, per modality.
  const remoteModalities = (['text', 'image', 'transcription', 'voice'] as const).filter(modality =>
    activeRouteIsRemote(modality),
  );
  const hasRemote = remoteModalities.length > 0;
  logger.log(`[MODEL-SM] ejectAll → start hasRemote=${hasRemote}`);
  const ejected = await lifecycleService().eject({
    localUnloads: {
      textUnloaded: () => unloadTextModel(true),
      imageUnloaded: () => unloadImageModel(true),
    },
    remoteModalities,
  });
  logger.log(`[MODEL-SM] ejectAll → done count=${ejected.count}`);
  return { count: ejected.count };
}
