/** Real shared application root for Mobile model-lifecycle tests. */
import {
  createOffGridApplication,
  modelsFailureMessage,
  type OffGridApplication,
} from '@offgrid/application';
import type {
  Resident,
  ResidencyAcquireOptions,
  ResidencyLifecycleHandlers,
  ResidencyReclaimPolicy,
  ResidentSpec,
} from '@offgrid/models';
import { ModelResidencyManager } from '@offgrid/models';
import { generateId } from '../../src/utils/generateId';
import { registerApplicationFacade } from '../../src/services/applicationFacade';
import { mobileModelWorkspacePorts } from '../../src/services/modelServices/workspace';
import {
  refreshMobileModelServices,
  startMobileModelServices,
  stopMobileModelServices,
} from '../../src/services/modelServices';
import { getResourceUsage } from '../../src/services/modelServices/modelStateNativeProjection';
import { useRemoteServerStore } from '../../src/stores/remoteServerStore';

let application: OffGridApplication;
let residencyOwner: ModelResidencyManager;
function composeApplication(): OffGridApplication {
  const memory = mobileModelWorkspacePorts.memory;
  if (!memory) throw new Error('The Mobile model test root requires its native memory port.');
  residencyOwner = new ModelResidencyManager(memory);
  return createOffGridApplication({
    models: {
      ...mobileModelWorkspacePorts,
      // Remote persistence and transports are outside these local-residency journeys.
      remote: {
        configuration: {
          read: () => ({
            version: 1,
            activeServerId: null,
            servers: useRemoteServerStore.getState().servers,
          }),
          write: async value => {
            useRemoteServerStore.setState({servers: [...value.servers] as never});
          },
        },
        credentials: {
          read: async () => null,
          write: async () => undefined,
          remove: async () => undefined,
        },
        providers: {
          register: async () => undefined,
          unregister: async () => undefined,
        },
      },
      residencyManager: residencyOwner,
    },
    newId: generateId,
  });
}

function installApplication(): void {
  application = composeApplication();
  registerApplicationFacade(() => application);
}

installApplication();

/** Replace all shared domain state while retaining Mobile's production boundary adapters. */
export async function resetModelApplication(
  options: { readonly budgetMB?: number | null } = {},
): Promise<OffGridApplication> {
  stopMobileModelServices();
  await application.stop();
  if (options.budgetMB != null) {
    throw new Error('Set deterministic native memory values instead of overriding domain policy.');
  }
  installApplication();
  startMobileModelServices();
  await refreshMobileModelServices();
  return application;
}

export function modelApplication(): OffGridApplication {
  return application;
}

/**
 * Compatibility vocabulary for older memory specifications. It delegates to the public Models
 * facade and reads its immutable projection. It does not own domain state.
 */
export const modelResidencyManager = {
  acquire(
    spec: ResidentSpec,
    handlers: ResidencyLifecycleHandlers,
    options?: ResidencyAcquireOptions,
  ) {
    return application.models.residency.acquire(spec, handlers, options);
  },
  getResidents(): readonly Resident[] {
    return application.models.snapshot().residents;
  },
  isResident(key: string): boolean {
    return application.models.residency.isResident(key);
  },
  hasSessionOverride(modelId?: string): boolean {
    return application.models.snapshot().sessionOverrides.includes(modelId ?? '');
  },
  setLoadPolicy(policy: 'conservative' | 'balanced' | 'aggressive'): void {
    application.models.setLoadPolicy(policy);
  },
  getLoadPolicy(): 'conservative' | 'balanced' | 'aggressive' {
    return application.models.snapshot().loadPolicy;
  },
  setBudgetOverrideMB(value: number | null): void {
    residencyOwner.setBudgetOverrideMB(value);
  },
  _reset(): Promise<OffGridApplication> {
    return resetModelApplication();
  },
  async evictByKey(key: string): Promise<boolean> {
    const outcome = await application.models.ejectResident({key});
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    return outcome.value;
  },
  async reclaim(policy: ResidencyReclaimPolicy): Promise<readonly string[]> {
    const outcome = await application.models.reclaim(policy);
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    return outcome.value;
  },
  unload(
    key: string,
    unloadUntracked: Parameters<OffGridApplication['models']['residency']['unload']>[1],
  ) {
    return application.models.residency.unload(key, unloadUntracked);
  },
};

type ModelsOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: Parameters<typeof modelsFailureMessage>[0] };

async function unwrap<T>(promise: Promise<ModelsOutcome<T>>): Promise<T> {
  const outcome = await promise;
  if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
  return outcome.value;
}

export const activeModelService = {
  checkMemoryForDualModel: (firstId: string | null, secondId: string | null) =>
    application.models.memoryAdvice.forCombination([
      ...(firstId ? [{id: firstId, type: 'text' as const}] : []),
      ...(secondId ? [{id: secondId, type: 'image' as const}] : []),
    ]),
  checkMemoryForModel: (modelId: string, modality: 'text' | 'image') =>
    application.models.memoryAdvice.forSelection(modelId, modality),
  ejectAll: () => unwrap(application.models.eject()),
  getActiveModels: () => application.models.snapshot().active,
  getLoadedModelIds: () => ({
    textModelId: application.models.snapshot().active.text?.ready
      ? application.models.activeModelId('text')
      : null,
    imageModelId: application.models.snapshot().active.image?.ready
      ? application.models.activeModelId('image')
      : null,
  }),
  getCurrentlyLoadedMemoryGB: () =>
    application.models.snapshot().residents.reduce(
      (total, resident) => total + resident.sizeMB,
      0,
    ) / 1024,
  // Device telemetry is a native projection, not application-owned model lifecycle state.
  getResourceUsage,
  hasAnyModelLoaded: () => application.models.snapshot().residents.length > 0,
  loadImageModel: (modelId: string, timeoutMs?: number, options?: {override?: boolean}) =>
    unwrap(application.models.load({modality: 'image', modelId, timeoutMs, override: !!options?.override})),
  loadTextModel: (modelId: string, timeoutMs?: number, options?: {override?: boolean}) =>
    unwrap(application.models.load({modality: 'text', modelId, timeoutMs, override: !!options?.override})),
  resolveSelectedTextModel: () => application.models.snapshot().active.text?.model ?? null,
  selectedTextModelId: () => application.models.activeModelId('text'),
  selectTextModel: (modelId: string | null) =>
    unwrap(application.models.select({modality: 'text', modelId})),
  subscribe: (listener: Parameters<OffGridApplication['models']['subscribe']>[0]) =>
    application.models.subscribe(listener),
  supportsAudioInput: () =>
    application.models.snapshot().active.text?.model?.capabilities.audioInput ?? false,
  syncWithNativeState: () => application.models.refresh(),
  unloadAllModels: async (keepSelection = false) => ({
    textUnloaded: await unwrap(application.models.unload({modality: 'text', keepSelection})),
    imageUnloaded: await unwrap(application.models.unload({modality: 'image', keepSelection})),
  }),
  unloadImageModel: (keepSelection = false) =>
    unwrap(application.models.unload({modality: 'image', keepSelection})),
  unloadTextModel: (keepSelection = false) =>
    unwrap(application.models.unload({modality: 'text', keepSelection})),
};
