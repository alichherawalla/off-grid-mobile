import {
  catalogKindForArtifact,
  isGrounderModel,
  projectGgufCapabilities,
  runtimeModalityForModelKind,
  selectedRemoteModelName,
  type ModelInventoryAdapter,
  type RuntimeModel,
} from '@offgrid/models';
import { useAppStore } from '../../stores/appStore';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { useWhisperStore } from '../../stores/whisperStore';
import type {
  DownloadedModel,
  RemoteModel,
  RemoteModelCategory,
  RemoteServer,
} from '../../types';
import { displayModelName } from '../adapters/remote/serverDiscovery';
import { remoteTextTransportRegistry } from '../adapters/providers';
import { llmService } from '../llm';
import { liteRTService } from '../litert';
import { whisperService } from '../whisperService';
import { WHISPER_MODELS } from '@offgrid/models';
import {
  getActiveModels,
} from './modelState';
import {
  EMBEDDING_MODEL_FILENAME,
  EMBEDDING_RESIDENT_MB,
  embeddingService,
} from '../adapters/native/embeddingRuntimeAdapter';
import {
  mobileExecutionAdapterId,
  mobileRouteId,
  type MobileRouteFacts,
} from './mobileRoute';
import { mobileLocalVoiceInventoryAdapter } from './voiceGenerationAdapter';
import { readMobileModelSelection } from './modelSelectionProjection';

type MobileRemoteMediaModality = 'image' | 'transcription' | 'voice' | 'embedding';

function runtime(
  identity: MobileRouteFacts,
  values: Omit<RuntimeModel, 'id' | 'source' | 'modality' | 'adapterId' | 'providerId'>,
): RuntimeModel {
  return {
    ...values,
    id: identity.modelId,
    source: identity.source,
    modality: identity.modality,
    adapterId: mobileExecutionAdapterId(
      identity.source,
      identity.hostId,
      identity.modality,
    ),
    providerId: identity.source === 'local' ? identity.hostId : undefined,
    serverId: identity.source === 'remote' ? identity.hostId : undefined,
  };
}

function localTextRuntime(model: DownloadedModel): RuntimeModel {
  const catalogKind = catalogKindForArtifact(model);
  const identity: MobileRouteFacts = {
    source: 'local',
    hostId: model.engine,
    modality: 'text',
    modelId: model.id,
  };
  const state = useAppStore.getState();
  const selected = readMobileModelSelection('text') === mobileRouteId(identity);
  const loaded = selected &&
    state.loadedTextModelId === model.id &&
    (model.engine === 'litert'
      ? liteRTService.isModelLoaded()
      : llmService.isModelLoaded());
  const projected = model.engine === 'llama'
    ? projectGgufCapabilities({
        artifact: {
          id: model.id,
          name: model.name,
          fileName: model.fileName,
          projectorPresent: !!model.mmProjPath,
        },
        runtime: loaded
          ? {
              loaded: true,
              tools: llmService.supportsToolCalling(),
              thinking: llmService.supportsThinking(),
              vision: llmService.supportsVision(),
            }
          : undefined,
      })
    : { tools: false, thinking: false, vision: false };
  const supportsVision = model.engine === 'litert'
    ? model.liteRTVision
    : projected.vision;
  return runtime(identity, {
    name: model.name,
    // Capability is the SSOT for route kind. A LiteRT vision bundle must be
    // selectable for a vision operation just like a GGUF with a projector.
    kind: catalogKind ?? (supportsVision ? 'vision' : 'text'),
    capabilities: {
      textGeneration: true,
      streaming: true,
      vision: supportsVision,
      audioInput: model.engine === 'litert' && !!model.liteRTAudio,
      // Mobile provides the portable tool loop for every local text route. The
      // catalog flag describes native template evidence, not route capability.
      tools: true,
      thinking: model.engine === 'litert' ? true : projected.thinking,
    },
    reasoning: model.engine === 'llama' && loaded
      ? llmService.getReasoningMetadata()
      : undefined,
    // The window the route runs with. LiteRT and remote routes leave it unknown (gap as data),
    // so Shared keeps its flat tool-result bound there.
    contextLength: model.engine === 'llama'
      ? llmService.getPerformanceSettings().contextLength || undefined
      : undefined,
    residentSizeMB: Math.ceil(
      (model.fileSize + (model.engine === 'llama' ? model.mmProjFileSize ?? 0 : 0)) /
        (1024 * 1024),
    ),
    residencyKey: 'mobile:text-engine',
    installed: true,
    ready: true,
    loaded,
    loading: selected && state.isLoadingModel,
  });
}

export const localLlamaInventoryAdapter: ModelInventoryAdapter = {
  id: 'mobile-local-llama-inventory',
  async listModels() {
    return useAppStore.getState().downloadedModels
      .filter(model => model.engine === 'llama' &&
        runtimeModalityForModelKind(catalogKindForArtifact(model) ?? 'text') === 'text')
      .map(localTextRuntime);
  },
};

export const localLiteRTInventoryAdapter: ModelInventoryAdapter = {
  id: 'mobile-local-litert-inventory',
  async listModels() {
    return useAppStore.getState().downloadedModels
      .filter(model => model.engine === 'litert' &&
        runtimeModalityForModelKind(catalogKindForArtifact(model) ?? 'text') === 'text')
      .map(localTextRuntime);
  },
};

const localImageInventoryAdapter: ModelInventoryAdapter = {
  id: 'mobile-local-image-inventory',
  async listModels() {
    const state = useAppStore.getState();
    return state.downloadedImageModels.map(model => {
      const identity: MobileRouteFacts = {
        source: 'local',
        hostId: model.backend ?? 'image-runtime',
        modality: 'image',
        modelId: model.id,
      };
      const selected = state.activeImageModelId === model.id;
      const imageState = getActiveModels().image;
      return runtime(identity, {
        name: model.name,
        kind: 'image',
        capabilities: { imageGeneration: true },
        residentSizeMB: Math.ceil(model.size / (1024 * 1024)),
        residencyKey: 'mobile:image-engine',
        installed: true,
        ready: true,
        loaded: selected && imageState.isLoaded,
        loading: selected && imageState.isLoading,
      });
    });
  },
};

const localWhisperInventoryAdapter: ModelInventoryAdapter = {
  id: 'mobile-local-whisper-inventory',
  async listModels() {
    const state = useWhisperStore.getState();
    const ids = new Set(state.presentModelIds);
    if (state.downloadedModelId) ids.add(state.downloadedModelId);
    return [...ids].map(modelId => {
      const model = WHISPER_MODELS.find(candidate => candidate.id === modelId);
      const identity: MobileRouteFacts = {
        source: 'local',
        hostId: 'whisper.rn',
        modality: 'transcription',
        modelId,
      };
      const selected = state.downloadedModelId === modelId;
      return runtime(identity, {
        name: model?.name ?? modelId,
        kind: 'transcription',
        capabilities: { audioInput: true, transcription: true },
        residentSizeMB: model?.size,
        installed: true,
        ready: true,
        loaded:
          selected &&
          state.isModelLoaded &&
          whisperService.getLoadedModelPath() === whisperService.getModelPath(modelId),
        loading: selected && state.isModelLoading,
        error: selected ? state.error ?? undefined : undefined,
      });
    });
  },
};

function remoteTextModels(server: RemoteServer): RemoteModel[] {
  const state = useRemoteServerStore.getState();
  const discovered = (state.discoveredModels[server.id] ?? []).filter(
    model => !isGrounderModel(model.name || model.id),
  );
  const selectedId = state.activeServerId === server.id
    ? state.activeRemoteTextModelId
    : null;
  if (selectedId && isGrounderModel(selectedId)) return discovered;
  return discovered;
}

function undiscoveredSelectedRemoteTextRuntime(
  server: RemoteServer,
  discovered: readonly RemoteModel[],
): RuntimeModel | null {
  const state = useRemoteServerStore.getState();
  const selectedId = state.activeServerId === server.id
    ? state.activeRemoteTextModelId
    : null;
  if (
    !selectedId ||
    isGrounderModel(selectedId) ||
    discovered.some(model => model.id === selectedId)
  ) return null;
  const identity: MobileRouteFacts = {
    source: 'remote',
    hostId: server.id,
    modality: 'text',
    modelId: selectedId,
  };
  return runtime(identity, {
    name: selectedRemoteModelName(server, 'text') ?? displayModelName(selectedId),
    kind: 'text',
    // The text route is known. Vision, tools, and thinking stay absent until discovery
    // provides evidence; absence is not negative capability evidence.
    capabilities: { textGeneration: true, streaming: true },
    installed: true,
    ready: !!remoteTextTransportRegistry.get(server.id),
    loaded: true,
    error: state.serverHealth[server.id]?.status === 'unhealthy'
      ? 'Remote server is unavailable'
      : undefined,
  });
}

function remoteMediaOptions(
  server: RemoteServer,
  category: Exclude<RemoteModelCategory, 'text'>,
): Array<{ id: string; name: string }> {
  const catalog = server.catalog?.[category] ?? [];
  const configured = server.selections?.[category]?.trim();
  if (!configured || catalog.some(model =>
    model.id === configured || model.activeAliases?.includes(configured),
  )) return catalog;
  return [...catalog, {
    id: configured,
    name: selectedRemoteModelName(server, category) ?? displayModelName(configured),
  }];
}

function remoteMediaRuntime(
  server: RemoteServer,
  modality: MobileRemoteMediaModality,
  option: { id: string; name: string },
): RuntimeModel {
  const identity: MobileRouteFacts = {
    source: 'remote',
    hostId: server.id,
    modality,
    modelId: option.id,
  };
  const selectedServerId =
    useRemoteServerStore.getState().activeRemoteMediaServerIds[modality];
  const selected =
    selectedServerId === server.id && server.selections?.[modality] === option.id;
  return runtime(identity, {
    name: option.name,
    kind: modality,
    capabilities: modality === 'transcription'
      ? { audioInput: true, transcription: true }
      : modality === 'image'
      ? { imageGeneration: true }
      : modality === 'voice'
      ? { speechSynthesis: true }
      : { embeddings: true },
    installed: true,
    ready: selected,
    loaded: selected,
  });
}

const remoteModelInventoryAdapter: ModelInventoryAdapter = {
  id: 'mobile-remote-model-inventory',
  async listModels() {
    const state = useRemoteServerStore.getState();
    return state.servers.flatMap(server => {
      const transport = remoteTextTransportRegistry.get(server.id);
      const discoveredText = remoteTextModels(server);
      const text = discoveredText.map(model => {
        const identity: MobileRouteFacts = {
          source: 'remote',
          hostId: server.id,
          modality: 'text',
          modelId: model.id,
        };
        return runtime(identity, {
          name: model.name,
          kind: model.capabilities.supportsVision ? 'vision' : 'text',
          capabilities: {
            textGeneration: true,
            streaming: true,
            vision: model.capabilities.supportsVision,
            tools: model.capabilities.supportsToolCalling,
            thinking: model.capabilities.supportsThinking,
          },
          reasoning: model.capabilities.reasoning,
          installed: true,
          ready: !!transport,
          loaded: state.activeServerId === server.id && state.activeRemoteTextModelId === model.id,
          error: state.serverHealth[server.id]?.status === 'unhealthy'
            ? 'Remote server is unavailable'
            : undefined,
        });
      });
      const undiscoveredSelection = undiscoveredSelectedRemoteTextRuntime(
        server,
        discoveredText,
      );
      return [
        ...text,
        ...(undiscoveredSelection ? [undiscoveredSelection] : []),
        ...remoteMediaOptions(server, 'image').map(option =>
          remoteMediaRuntime(server, 'image', option),
        ),
        ...remoteMediaOptions(server, 'transcription').map(option =>
          remoteMediaRuntime(server, 'transcription', option),
        ),
        ...remoteMediaOptions(server, 'voice').map(option =>
          remoteMediaRuntime(server, 'voice', option),
        ),
        ...remoteMediaOptions(server, 'embedding').map(option =>
          remoteMediaRuntime(server, 'embedding', option),
        ),
      ];
    });
  },
};

function embeddingRuntime(modality: 'embedding'): RuntimeModel {
  return runtime(
    {
      source: 'local',
      hostId: 'llama.rn-sidecar',
      modality,
      modelId: EMBEDDING_MODEL_FILENAME,
    },
    {
      name: 'MiniLM tool and memory index',
      kind: modality,
      capabilities: modality === 'embedding'
        ? { embeddings: true }
        : { toolSelection: true, embeddings: true },
      residentSizeMB: EMBEDDING_RESIDENT_MB,
      installed: true,
      ready: true,
      loaded: embeddingService.isLoaded(),
    },
  );
}

const embeddingInventoryAdapter: ModelInventoryAdapter = {
  id: 'mobile-local-embedding-inventory',
  async listModels() {
    return [embeddingRuntime('embedding')];
  },
};

const classifierInventoryAdapter: ModelInventoryAdapter = {
  id: 'mobile-local-classifier-inventory',
  async listModels() {
    const state = useAppStore.getState();
    const modelId = state.settings.classifierModelId ?? state.activeModelId ?? state.lastTextModelId;
    const model = modelId
      ? state.downloadedModels.find(candidate => candidate.id === modelId)
      : null;
    if (!model || catalogKindForArtifact(model) === 'computer_use') return [];
    return [runtime(
      {
        source: 'local',
        hostId: model.engine,
        modality: 'classifier',
        modelId: model.id,
      },
      {
        name: model.name,
        kind: 'classifier',
        capabilities: { classification: true, textGeneration: true },
        residentSizeMB: Math.ceil(model.fileSize / (1024 * 1024)),
        residencyKey: 'mobile:text-engine',
        residencyLifecycle: 'operation',
        installed: true,
        ready: true,
        loaded: state.loadedTextModelId === model.id,
        loading: state.isLoadingModel && state.activeModelId === model.id,
      },
    )];
  },
};

export const mobileInventoryAdapters: ModelInventoryAdapter[] = [
  localLlamaInventoryAdapter,
  localLiteRTInventoryAdapter,
  localImageInventoryAdapter,
  localWhisperInventoryAdapter,
  mobileLocalVoiceInventoryAdapter,
  embeddingInventoryAdapter,
  classifierInventoryAdapter,
  remoteModelInventoryAdapter,
];
