import {
  catalogKindForArtifact,
  decodeModelRouteId,
  isGrounderModel,
  runtimeModalityForModelKind,
  type ModelModality,
  type ModelSelectionStore,
} from '@offgrid/models';
import { useAppStore } from '../../stores/appStore';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { useWhisperStore } from '../../stores/whisperStore';
import { mobileRouteId } from './mobileRoute';
import { selectMobileLocalVoiceRoute, selectedMobileLocalVoiceRoute } from './voiceGenerationAdapter';

type RemoteMediaModality = 'image' | 'transcription' | 'voice' | 'embedding';

function remoteMediaRoute(modality: RemoteMediaModality): string | null {
  const state = useRemoteServerStore.getState();
  const serverId = state.activeRemoteMediaServerIds[modality];
  const server = serverId ? state.servers.find(candidate => candidate.id === serverId) : null;
  const modelId = server?.selections?.[modality]?.trim();
  return serverId && modelId
    ? mobileRouteId({ source: 'remote', hostId: serverId, modality, modelId })
    : null;
}

function readTextSelection(): string | null {
  const remote = useRemoteServerStore.getState();
  if (remote.activeServerId && remote.activeRemoteTextModelId) {
    const discovered = remote.discoveredModels[remote.activeServerId]?.find(
      candidate => candidate.id === remote.activeRemoteTextModelId,
    );
    if (isGrounderModel(discovered?.name ?? remote.activeRemoteTextModelId)) return null;
    return mobileRouteId({ source: 'remote', hostId: remote.activeServerId, modality: 'text',
      modelId: remote.activeRemoteTextModelId });
  }
  const state = useAppStore.getState();
  const model = state.downloadedModels.find(candidate => candidate.id === state.activeModelId);
  const kind = model ? catalogKindForArtifact(model) : null;
  return model && runtimeModalityForModelKind(kind ?? 'text') === 'text'
    ? mobileRouteId({ source: 'local', hostId: model.engine, modality: 'text', modelId: model.id })
    : null;
}

function readImageSelection(): string | null {
  const remote = remoteMediaRoute('image');
  if (remote) return remote;
  const state = useAppStore.getState();
  const model = state.downloadedImageModels.find(candidate => candidate.id === state.activeImageModelId);
  return model ? mobileRouteId({ source: 'local', hostId: model.backend ?? 'image-runtime',
    modality: 'image', modelId: model.id }) : null;
}

function readTranscriptionSelection(): string | null {
  const remote = remoteMediaRoute('transcription');
  if (remote) return remote;
  const modelId = useWhisperStore.getState().downloadedModelId;
  return modelId
    ? mobileRouteId({ source: 'local', hostId: 'whisper.rn', modality: 'transcription', modelId })
    : null;
}

function readClassifierSelection(): string | null {
  const state = useAppStore.getState();
  const modelId = state.settings.classifierModelId ?? state.activeModelId ?? state.lastTextModelId;
  const model = state.downloadedModels.find(candidate => candidate.id === modelId);
  const kind = model ? catalogKindForArtifact(model) : null;
  return model && kind !== 'computer_use'
    ? mobileRouteId({ source: 'local', hostId: model.engine, modality: 'classifier', modelId: model.id })
    : null;
}

/** Read the one persisted projection used by Shared LLMService. */
export function readMobileModelSelection(modality: ModelModality): string | null {
  switch (modality) {
    case 'text': return readTextSelection();
    case 'image': return readImageSelection();
    case 'transcription': return readTranscriptionSelection();
    case 'voice': return remoteMediaRoute('voice') ?? selectedMobileLocalVoiceRoute();
    case 'embedding': return remoteMediaRoute('embedding');
    case 'classifier': return readClassifierSelection();
    default: return null;
  }
}

function clearRemoteMedia(modality: RemoteMediaModality): void {
  useRemoteServerStore.setState(state => ({
    activeRemoteMediaServerIds: Object.fromEntries(
      Object.entries(state.activeRemoteMediaServerIds).filter(([key]) => key !== modality),
    ),
    ...(modality === 'image' ? { activeRemoteImageModelId: null } : {}),
  }));
}

type DecodedRoute = NonNullable<ReturnType<typeof decodeModelRouteId>>;

function writeTextSelection(route: DecodedRoute | null): void {
  const serverId = route?.serverId;
  useAppStore.setState({
    activeModelId: serverId ? null : route?.modelId ?? null,
    ...(!serverId && route?.modelId ? { lastTextModelId: route.modelId } : {}),
  });
  useRemoteServerStore.setState({ activeServerId: serverId ?? null,
    activeRemoteTextModelId: serverId ? route?.modelId ?? null : null });
}

function writeImageSelection(route: DecodedRoute | null): void {
  const serverId = route?.serverId;
  useAppStore.setState({ activeImageModelId: serverId ? null : route?.modelId ?? null });
  if (!serverId) return clearRemoteMedia('image');
  useRemoteServerStore.setState(state => ({
    activeRemoteMediaServerIds: { ...state.activeRemoteMediaServerIds, image: serverId },
    activeRemoteImageModelId: route.modelId,
  }));
}

function writeTranscriptionSelection(route: DecodedRoute | null): void {
  const serverId = route?.serverId;
  useWhisperStore.setState({ downloadedModelId: serverId ? null : route?.modelId ?? null,
    isModelLoaded: false, error: null });
  if (!serverId) return clearRemoteMedia('transcription');
  useRemoteServerStore.setState(state => ({
    activeRemoteMediaServerIds: { ...state.activeRemoteMediaServerIds, transcription: serverId },
  }));
}

async function writeVoiceSelection(route: DecodedRoute | null, canonicalId: string | null): Promise<void> {
  if (route?.serverId) {
    await selectMobileLocalVoiceRoute(null);
    useRemoteServerStore.setState(state => ({
      activeRemoteMediaServerIds: { ...state.activeRemoteMediaServerIds, voice: route.serverId },
    }));
  } else {
    clearRemoteMedia('voice');
    await selectMobileLocalVoiceRoute(route ? canonicalId : null);
  }
}

function writeRemoteMediaSelection(
  modality: 'embedding',
  route: DecodedRoute | null,
): void {
  if (!route?.serverId) return clearRemoteMedia(modality);
  useRemoteServerStore.setState(state => ({
    activeRemoteMediaServerIds: {
      ...state.activeRemoteMediaServerIds,
      [modality]: route.serverId,
    },
  }));
}

/** The only raw writer for persisted Mobile selection projections. */
export async function writeMobileModelSelection(modality: ModelModality, canonicalId: string | null): Promise<void> {
  const route = canonicalId ? decodeModelRouteId(canonicalId) : null;
  if (canonicalId && !route) throw new Error('The selected model route is invalid');
  switch (modality) {
    case 'text': writeTextSelection(route); break;
    case 'image': writeImageSelection(route); break;
    case 'transcription': writeTranscriptionSelection(route); break;
    case 'voice': await writeVoiceSelection(route, canonicalId); break;
    case 'embedding': writeRemoteMediaSelection('embedding', route); break;
    case 'classifier':
      useAppStore.getState().updateSettings({ classifierModelId: route?.modelId ?? null });
      break;
  }
}

export const mobileModelSelectionProjection: ModelSelectionStore = {
  read: readMobileModelSelection,
  write: writeMobileModelSelection,
};
