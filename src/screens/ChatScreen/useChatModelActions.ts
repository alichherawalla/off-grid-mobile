import { Dispatch, SetStateAction, useEffect } from 'react';
import { modelNotReadyAlert } from '@offgrid/models';
import {
  AlertState,
  showAlert,
  hideAlert,
} from '../../components';
import {
  llmService,
  modelLibrary,
  selectedTextModelId,
} from '../../services';
import { mobileResidencyIntents } from '../../services/modelServices/residencyIntents';
import { selectMobileModel } from '../../services/modelServices';
import { isModelReady, activeLocalTextCapabilities, activeTextCapabilities, backendFallbackNotice } from '../../services/engines';
import { useAppStore } from '../../stores';
import { DownloadedModel, RemoteModel, ONNXImageModel } from '../../types';
import logger from '../../utils/logger';
import { ModelReadyOutcome } from './modelReadiness';
import { mobileChatModelReadiness } from '../../services/modelServices/chatModelReadinessPort';
import { mobileChatSession } from './mobileChatSession';

type SetState<T> = Dispatch<SetStateAction<T>>;

/** Vision support for a just-loaded local model, via the single engine-registry reader
 *  (engines.activeLocalTextCapabilities) — so these post-load sites don't branch on the engine. */
function loadedModelVision(model: DownloadedModel): boolean {
  return activeLocalTextCapabilities(model).vision;
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
  createConversation: (modelId: string, title?: string, projectId?: string) => string;
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
  deps: Pick<ModelActionDeps, 'activeConversationId' | 'settings' | 'addMessage'>,
  content: string,
) {
  if (!deps.activeConversationId || !deps.settings.showGenerationDetails) return;
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
 * engine layer (engines.backendFallbackNotice); this only renders it.
 */
function addBackendFallbackMsg(deps: Pick<ModelActionDeps, 'activeModel' | 'activeConversationId' | 'addMessage'>) {
  const notice = backendFallbackNotice(deps.activeModel);
  if (!notice || !deps.activeConversationId) return;
  deps.addMessage(deps.activeConversationId, {
    role: 'assistant',
    content: `_${notice}_`,
    isSystemInfo: true,
  });
}

export async function initiateModelLoad(
  deps: ModelActionDeps,
  alreadyLoading: boolean,
  /** When the load was requested to satisfy a chat turn, resume that turn after a
   *  successful "Load Anyway". Non-generation callers (model select / reload) omit it,
   *  so nothing is auto-resumed for them. */
  options?: (() => void) | { force?: boolean; onLoadedResume?: () => void },
): Promise<ModelReadyOutcome> {
  const force = typeof options === 'object' && !!options.force;
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId) return { ok: false, reason: 'no-model-selected', forceLoadAllowed: false };
  let started = false;

  try {
    const service = mobileChatModelReadiness({
      activeModel,
      activeModelId,
      remote: !!deps.activeModelInfo?.isRemote,
      beforeLoad: alreadyLoading ? undefined : async () => {
        started = true;
        deps.setIsModelLoading(true);
        deps.setLoadingModel(activeModel);
        deps.modelLoadStartTimeRef.current = Date.now();
        await waitForRenderFrame();
      },
    });
    const outcome = force ? await service.forceLoad() : await service.ensureReady();
    if (!outcome.ok) return outcome;
    deps.setSupportsVision(loadedModelVision(activeModel));
    if (started && deps.modelLoadStartTimeRef.current && deps.settings.showGenerationDetails) {
      const loadTime = ((Date.now() - deps.modelLoadStartTimeRef.current) / 1000).toFixed(1);
      addSystemMsg(deps, `Model loaded: ${activeModel.name} (${loadTime}s)`);
    }
    if (started) addBackendFallbackMsg(deps);
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
  // The SELECTION first, remembered choice second - from the service, which owns that order. Reading
  // lastTextModelId alone loaded the previously-picked model and left the selected one on screen.
  const modelId = selectedTextModelId();
  if (!modelId) {
    deps.setShowModelSelector(true);
    return false;
  }
  deps.setLoadingModel(
    useAppStore.getState().downloadedModels.find(m => m.id === modelId) ?? null,
  );
  deps.setIsModelLoading(true);
  try {
    await mobileResidencyIntents.ensureText(modelId);
    return true;
  } catch {
    return false;
  } finally {
    deps.setIsModelLoading(false);
    deps.setLoadingModel(null);
  }
}

export async function ensureModelLoadedFn(
  deps: ModelActionDeps,
  onLoadedResume?: () => void,
): Promise<ModelReadyOutcome> {
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId) return { ok: false, reason: 'no-model-selected', forceLoadAllowed: false };
  return initiateModelLoad(deps, false, onLoadedResume);
}

export async function forceLoadModelFn(deps: ModelActionDeps): Promise<ModelReadyOutcome> {
  return initiateModelLoad(deps, false, { force: true });
}

function presentModelLoadOutcome(
  deps: ModelActionDeps,
  outcome: ModelReadyOutcome,
  onLoadedResume?: () => void,
): void {
  if (outcome.ok) return;
  const copy = modelNotReadyAlert(outcome.reason, outcome.detail);
  const buttons = outcome.forceLoadAllowed
    ? [
        { text: 'Cancel', style: 'cancel' as const },
        {
          text: 'Load Anyway',
          style: 'destructive' as const,
          onPress: () => {
            deps.setAlertState(hideAlert());
            forceLoadModelFn(deps).then(forced => {
              if (forced.ok) onLoadedResume?.();
              else presentModelLoadOutcome(deps, forced);
            }).catch(error => logger.error('[ModelLoad] Force load failed:', error));
          },
        },
      ]
    : undefined;
  deps.setAlertState(showAlert(copy.title, copy.message, buttons));
}

export async function proceedWithModelLoadFn(
  deps: ModelActionDeps,
  model: DownloadedModel,
): Promise<void> {
  // Close the picker FIRST so the load runs behind the dismissed sheet and the
  // minimal in-chat loading card shows — not a load running with the sheet still open.
  deps.setShowModelSelector(false);
  const outcome = await initiateModelLoad({
    ...deps,
    activeModel: model,
    activeModelId: model.id,
  }, false);
  presentModelLoadOutcome({ ...deps, activeModel: model, activeModelId: model.id }, outcome);
}

/**
 * Selecting a text model in chat is the SAME decision Home/ChatsList/ModelSelector
 * make: load it through the MEASURED residency loader, offering the shared
 * "Load Anyway" override if that loader refuses. There is NO separate predictive
 * pre-check gate here — the residency loader (makeRoomFor, evict-then-measure) is
 * authoritative, so a model the old fileSize×1.5 estimate would have blocked in
 * chat now loads exactly as it does from Home (bug OD3).
 */
export async function handleModelSelectFn(
  deps: ModelActionDeps,
  model: DownloadedModel,
): Promise<void> {
  await selectMobileModel({
    source: 'local',
    hostId: model.engine,
    modality: 'text',
    modelId: model.id,
  });
  if (llmService.getLoadedModelPath() === model.filePath) {
    deps.setShowModelSelector(false);
    return;
  }
  await proceedWithModelLoadFn(deps, model);
}

export async function handleUnloadModelFn(deps: ModelActionDeps): Promise<void> {
  const { activeModel, isStreaming, clearStreamingMessage } = deps;
  if (isStreaming) {
    if (deps.activeConversationId) mobileChatSession.stopConversation(deps.activeConversationId);
    else mobileChatSession.stop();
    clearStreamingMessage();
  }
  const modelName = activeModel?.name;
  deps.setIsModelLoading(true);
  deps.setLoadingModel(activeModel ?? null);
  try {
    await mobileResidencyIntents.unloadText();
    deps.setSupportsVision(false);
    if (deps.settings.showGenerationDetails && modelName) {
      addSystemMsg(deps, `Model unloaded: ${modelName}`);
    }
  } catch (error) {
    deps.setAlertState(showAlert('Error', `Failed to unload model: ${(error as Error).message}`));
  } finally {
    deps.setIsModelLoading(false);
    deps.setLoadingModel(null);
    deps.setShowModelSelector(false);
  }
}

type ImageModelEffectsDeps = {
  setDownloadedImageModels: (models: ONNXImageModel[]) => void;
  settings: { imageGenerationMode: string; autoDetectMethod: string; classifierModelId: string | null | undefined };
  activeImageModelId: string | null;
  downloadedModels: DownloadedModel[];
};
export function useChatImageModelEffects(deps: ImageModelEffectsDeps): void {
  const { setDownloadedImageModels, settings, activeImageModelId, downloadedModels } = deps;
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
        const { downloadedImageModels: current, activeImageModelId: activeId } = useAppStore.getState();
        const merged = activeId && !models.some(m => m.id === activeId)
          ? [...models, ...current.filter(m => m.id === activeId)]
          : models;
        setDownloadedImageModels(merged);
      }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };

  }, []);
  useEffect(() => {
    let cancelled = false;
    const preload = async () => {
      if (
        settings.imageGenerationMode === 'auto' && settings.autoDetectMethod === 'llm' &&
        settings.classifierModelId && activeImageModelId
      ) {
        const classifierModel = downloadedModels.find(m => m.id === settings.classifierModelId);
        if (classifierModel?.filePath && !llmService.getLoadedModelPath()) {
          try {
            if (!cancelled) await mobileResidencyIntents.ensureText(settings.classifierModelId);
          }
          catch (error) { if (!cancelled) logger.warn('[ChatScreen] Failed to preload classifier model:', error); }
        }
      }
    };
    preload();
    return () => { cancelled = true; };

  }, [settings.imageGenerationMode, settings.autoDetectMethod, settings.classifierModelId, activeImageModelId]);
}

type ModelStateSyncDeps = {
  activeModelInfo: { isRemote: boolean };
  activeModelId: string | null;
  activeModel: DownloadedModel | undefined;
  modelDeps: any;
  activeRemoteModel: { capabilities?: { supportsVision?: boolean; supportsToolCalling?: boolean; supportsThinking?: boolean } } | null;
  isModelLoading: boolean;
  setSupportsVision: (v: boolean) => void;
  setSupportsToolCalling: (v: boolean) => void;
  setSupportsThinking: (v: boolean) => void;
  prepareSelectedModel?: boolean;
};
export function useChatModelStateSync(deps: ModelStateSyncDeps): void {
  const { activeModelInfo, activeModelId, activeModel, activeRemoteModel, isModelLoading, setSupportsVision, setSupportsToolCalling, setSupportsThinking, prepareSelectedModel } = deps;
  const activeModelMmProjPath = activeModel?.engine === 'llama' ? activeModel.mmProjPath : undefined;
  // A brand-new chat is an explicit request to get the selected model ready. Start the
  // real load here so the chat renders its authoritative loading state before Send.
  // Existing conversations still load on demand, and remote models have no local load.
  useEffect(() => {
    if (
      !prepareSelectedModel ||
      activeModelInfo.isRemote ||
      !activeModel ||
      !activeModelId ||
      isModelReady(activeModel)
    ) return;
    initiateModelLoad(deps.modelDeps, false)
      .then(outcome => presentModelLoadOutcome(deps.modelDeps, outcome))
      .catch(error => logger.error('[ChatScreen] New-chat model preparation failed:', error));
    // modelDeps is a render snapshot; the identity inputs below own when a new load starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepareSelectedModel, activeModelInfo.isRemote, activeModelId, activeModel?.filePath]);

  useEffect(() => {
    // Single capability rule (engines.activeTextCapabilities); vision keys on activeModelInfo.isRemote.
    setSupportsVision(activeTextCapabilities({
      isRemote: activeModelInfo.isRemote,
      remoteCaps: activeRemoteModel?.capabilities,
      model: activeModel,
    }).vision);
  }, [activeModelInfo.isRemote, activeRemoteModel?.capabilities?.supportsVision, activeModelMmProjPath, isModelLoading]);
  useEffect(() => {
    // Use the same canonical route source for tool and thinking capabilities.
    const caps = activeTextCapabilities({
      isRemote: activeModelInfo.isRemote,
      remoteCaps: activeRemoteModel?.capabilities,
      model: activeModel,
    });
    setSupportsToolCalling(caps.tools);
    setSupportsThinking(caps.thinking);
  }, [activeModelId, activeModel?.engine, isModelLoading, activeModelInfo.isRemote, activeRemoteModel?.capabilities?.supportsToolCalling, activeRemoteModel?.capabilities?.supportsThinking]);
}
