import { Dispatch, SetStateAction, useEffect } from 'react';
import { AlertState, showAlert } from '../../components';
import { modelLibrary } from '../../services';
import {
  mobileModelCommands,
  selectLocalTextModelOnDemand,
} from '../../services/modelServices/modelCommandApplication';
import { mobileTextEngineControl } from '../../services/modelServices/textEngineControl';
import { useAppStore, useChatStore } from '../../stores';
import { DownloadedModel, RemoteModel, ONNXImageModel } from '../../types';
import { ModelReadyOutcome } from './modelReadiness';
import { mobileChatModelReadiness } from '../../services/modelServices/chatModelReadinessPort';
import { activeMobileRoute } from '../../services/modelServices/mobileLLMService';
import { mobileChatSession } from './mobileChatSession';
import logger from '../../utils/logger';

type SetState<T> = Dispatch<SetStateAction<T>>;

/** Vision support for a just-loaded local model from Shared's canonical route projection. */
function loadedModelVision(model: DownloadedModel): boolean {
  return mobileTextEngineControl.capabilities(model.id).vision;
}

type ActiveModelInfo = {
  isRemote: boolean;
  model: DownloadedModel | RemoteModel | null;
  modelId: string | null;
  modelName: string;
};

type ModelActionDeps = {
  activeModel: DownloadedModel | null | undefined;
  activeModelId: string | null;
  activeModelInfo?: ActiveModelInfo;
  hasActiveModel?: boolean;
  activeConversationId: string | null | undefined;
  isStreaming: boolean;
  settings: { showGenerationDetails: boolean };
  clearStreamingMessage: () => void;
  createConversation: (
    modelId: string,
    title?: string,
    projectId?: string,
  ) => string;
  addMessage: (convId: string, msg: any) => void;
  setIsModelLoading: (loading: boolean) => void;
  setLoadingModel: (model: DownloadedModel | null) => void;
  setSupportsVision: SetState<boolean>;
  setShowModelSelector: SetState<boolean>;
  setAlertState: SetState<AlertState>;
  modelLoadStartTimeRef: React.MutableRefObject<number | null>;
};

import { InteractionManager } from 'react-native';

/** Wait for loading UI to render before blocking the JS bridge with native calls. */
function waitForRenderFrame(): Promise<void> {
  return new Promise<void>(resolve => {
    InteractionManager.runAfterInteractions(() => setTimeout(resolve, 350));
  });
}

function addSystemMsg(
  deps: Pick<
    ModelActionDeps,
    'activeConversationId' | 'settings' | 'addMessage'
  >,
  content: string,
) {
  if (!deps.activeConversationId || !deps.settings.showGenerationDetails)
    return;
  deps.addMessage(deps.activeConversationId, {
    role: 'assistant',
    content: `_${content}_`,
    isSystemInfo: true,
  });
}

/**
 * Surface a silent backend downgrade after a successful load — NOT gated on showGenerationDetails:
 * a user who explicitly selected GPU and got CPU must see it without any debug setting (the
 * device-reported "Backend=GPU but the turn ran on CPU" class). The verdict is owned by the
 * Shared control plane through the native runtime port; this only renders it.
 */
function addBackendFallbackMsg(
  deps: Pick<
    ModelActionDeps,
    'activeModel' | 'activeConversationId' | 'addMessage'
  >,
) {
  const notice = mobileTextEngineControl.backendFallbackNotice(
    deps.activeModel?.id,
  );
  if (!notice || !deps.activeConversationId) return;
  logger.warn('[TextEngine] GPU fallback:', notice);
  const alreadyVisible = useChatStore
    .getState()
    .getConversationMessages(deps.activeConversationId)
    .some(message => message.isSystemInfo && message.content.includes(notice));
  if (alreadyVisible) return;
  deps.addMessage(deps.activeConversationId, {
    role: 'assistant',
    content: `_${notice}_`,
    isSystemInfo: true,
  });
}

export async function initiateModelLoad(
  deps: ModelActionDeps,
  alreadyLoading: boolean,
  options?: { force?: boolean },
): Promise<ModelReadyOutcome> {
  const force = typeof options === 'object' && !!options.force;
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId)
    return { ok: false, reason: 'no-model-selected', forceLoadAllowed: false };
  let started = false;

  try {
    const service = mobileChatModelReadiness({
      activeModel,
      activeModelId,
      remote: !!deps.activeModelInfo?.isRemote,
      beforeLoad: alreadyLoading
        ? undefined
        : async () => {
            started = true;
            deps.setIsModelLoading(true);
            deps.setLoadingModel(activeModel);
            deps.modelLoadStartTimeRef.current = Date.now();
            await waitForRenderFrame();
          },
    });
    const outcome = force
      ? await service.forceLoad()
      : await service.ensureReady();
    if (!outcome.ok) return outcome;
    deps.setSupportsVision(loadedModelVision(activeModel));
    if (
      started &&
      deps.modelLoadStartTimeRef.current &&
      deps.settings.showGenerationDetails
    ) {
      const loadTime = (
        (Date.now() - deps.modelLoadStartTimeRef.current) /
        1000
      ).toFixed(1);
      addSystemMsg(deps, `Model loaded: ${activeModel.name} (${loadTime}s)`);
    }
    addBackendFallbackMsg(deps);
    return outcome;
  } finally {
    if (started) {
      deps.setIsModelLoading(false);
      deps.setLoadingModel(null);
      deps.modelLoadStartTimeRef.current = null;
    }
  }
}

/**
 * For a chat request with no text model loaded: load the last-selected text
 * model (residency manager fits it into memory), or open the model selector
 * if the user never chose one. Returns true when a model is loading/loaded.
 */
export async function ensureTextModelForChatFn(deps: {
  setShowModelSelector: (v: boolean) => void;
  setLoadingModel: (m: DownloadedModel | null) => void;
  setIsModelLoading: (v: boolean) => void;
}): Promise<boolean> {
  // The shared selection is the one owner of the text route. A remote route needs no local
  // load; a local one is loaded by id. The old local-only id lagged behind a remote switch and
  // loaded a stale small model beside the remote one.
  const active = activeMobileRoute('text').model;
  const remote = active?.source === 'remote';
  const modelId = active?.source === 'local' ? active.id : null;
  const model =
    useAppStore.getState().downloadedModels.find(m => m.id === modelId) ?? null;
  let started = false;
  const service = mobileChatModelReadiness({
    activeModel: model,
    activeModelId: modelId,
    remote,
    beforeLoad: () => {
      started = true;
      deps.setLoadingModel(model);
      deps.setIsModelLoading(true);
    },
  });
  try {
    const outcome = await service.ensureReady();
    if (!outcome.ok && outcome.reason === 'no-model-selected') {
      deps.setShowModelSelector(true);
    }
    return outcome.ok;
  } finally {
    if (started) {
      deps.setIsModelLoading(false);
      deps.setLoadingModel(null);
    }
  }
}

export async function ensureModelLoadedFn(
  deps: ModelActionDeps,
): Promise<ModelReadyOutcome> {
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId)
    return { ok: false, reason: 'no-model-selected', forceLoadAllowed: false };
  return initiateModelLoad(deps, false);
}

export async function forceLoadModelFn(
  deps: ModelActionDeps,
): Promise<ModelReadyOutcome> {
  return initiateModelLoad(deps, false, { force: true });
}

/**
 * A picker tap changes the canonical route only. The first local generation owns
 * residency acquisition through ChatModelReadinessService. This keeps navigation
 * and selection free of native model I/O.
 */
export async function handleModelSelectFn(
  deps: ModelActionDeps,
  model: DownloadedModel,
): Promise<void> {
  await selectLocalTextModelOnDemand(model);
  deps.setShowModelSelector(false);
}

export async function handleUnloadModelFn(
  deps: ModelActionDeps,
): Promise<void> {
  const { activeModel, isStreaming, clearStreamingMessage } = deps;
  if (isStreaming) {
    if (deps.activeConversationId)
      mobileChatSession.stopConversation(deps.activeConversationId);
    else mobileChatSession.stop();
    clearStreamingMessage();
  }
  const modelName = activeModel?.name;
  deps.setIsModelLoading(true);
  deps.setLoadingModel(activeModel ?? null);
  try {
    await mobileModelCommands.unload('text');
    deps.setSupportsVision(false);
    if (deps.settings.showGenerationDetails && modelName) {
      addSystemMsg(deps, `Model unloaded: ${modelName}`);
    }
  } catch (error) {
    deps.setAlertState(
      showAlert('Error', `Failed to unload model: ${(error as Error).message}`),
    );
  } finally {
    deps.setIsModelLoading(false);
    deps.setLoadingModel(null);
    deps.setShowModelSelector(false);
  }
}

type ImageModelEffectsDeps = {
  setDownloadedImageModels: (models: ONNXImageModel[]) => void;
};
export function useChatImageModelEffects(deps: ImageModelEffectsDeps): void {
  const { setDownloadedImageModels } = deps;
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!cancelled) {
        const models = await modelLibrary.getDownloadedImageModels();
        if (cancelled) return;
        // Never orphan the currently-active image model: activeImageModelId is persisted
        // but downloadedImageModels is not, so on a cold mount the disk scan is the sole
        // hydrator. If it hasn't surfaced the active model yet (slow FS, or one already
        // placed in the store), keep that entry rather than blanking the selection —
        // otherwise activeImageModel resolves to undefined and image routing dies.
        const { downloadedImageModels: current, activeImageModelId: activeId } =
          useAppStore.getState();
        const merged =
          activeId && !models.some(m => m.id === activeId)
            ? [...models, ...current.filter(m => m.id === activeId)]
            : models;
        setDownloadedImageModels(merged);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [setDownloadedImageModels]);
}

type ModelStateSyncDeps = {
  activeModelInfo: { isRemote: boolean };
  activeModelId: string | null;
  activeModel: DownloadedModel | undefined;
  activeRemoteModel: {
    capabilities?: {
      supportsVision?: boolean;
      supportsToolCalling?: boolean;
      supportsThinking?: boolean;
    };
  } | null;
  isModelLoading: boolean;
  setSupportsVision: (v: boolean) => void;
  setSupportsToolCalling: (v: boolean) => void;
  setSupportsThinking: (v: boolean) => void;
};
export function useChatModelStateSync(deps: ModelStateSyncDeps): void {
  const {
    activeModelInfo,
    activeModelId,
    activeModel,
    activeRemoteModel,
    isModelLoading,
    setSupportsVision,
    setSupportsToolCalling,
    setSupportsThinking,
  } = deps;
  const activeModelMmProjPath =
    activeModel?.engine === 'llama' ? activeModel.mmProjPath : undefined;

  useEffect(() => {
    // Shared projects the canonical route capabilities for every runtime.
    setSupportsVision(
      mobileTextEngineControl.capabilities(activeModelId).vision,
    );
  }, [
    activeModelId,
    activeModelInfo.isRemote,
    activeRemoteModel?.capabilities?.supportsVision,
    activeModelMmProjPath,
    isModelLoading,
    setSupportsVision,
  ]);
  useEffect(() => {
    // Use the same canonical route source for tool and thinking capabilities.
    const caps = mobileTextEngineControl.capabilities(activeModelId);
    setSupportsToolCalling(caps.tools);
    setSupportsThinking(caps.thinking);
  }, [
    activeModelId,
    activeModel?.engine,
    isModelLoading,
    activeModelInfo.isRemote,
    activeRemoteModel?.capabilities?.supportsToolCalling,
    activeRemoteModel?.capabilities?.supportsThinking,
    setSupportsThinking,
    setSupportsToolCalling,
  ]);
}
