import {
  catalogKindForArtifact,
  catalogModelKind,
  decodeModelRouteId,
  reconcileModelSelection,
  type ModelModality,
  type ModelSelectionProjectionPort,
  type PersistedSelectionCandidate,
  type PersistedSelectionProjection,
  type SelectionProjectionWrite,
} from '@offgrid/models';
import { useAppStore } from '../../stores/appStore';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { useWhisperStore } from '../../stores/whisperStore';
import { mobileRouteId } from './mobileRoute';
import {
  selectMobileLocalVoiceRoute,
  selectedMobileLocalVoiceRoute,
} from './voiceGenerationAdapter';

type RemoteMediaModality = 'image' | 'transcription' | 'voice' | 'embedding';

function candidate(
  routeId: string | null,
  kind: string,
  name?: string,
): PersistedSelectionCandidate | null {
  return routeId ? { routeId, kind, ...(name ? { name } : {}) } : null;
}

function localTextCandidate(
  modelId: string | null,
  modality: 'text' | 'classifier' = 'text',
): PersistedSelectionCandidate | null {
  if (!modelId) return null;
  const model = useAppStore.getState().downloadedModels.find(item => item.id === modelId);
  if (!model) return null;
  const kind = catalogKindForArtifact(model) ?? catalogModelKind(model.name, [], model.id);
  return candidate(
    mobileRouteId({
      source: 'local', hostId: model.engine, modality, modelId: model.id,
    }),
    kind === 'code' ? 'text' : kind,
    model.name,
  );
}

function remoteTextCandidate(): PersistedSelectionCandidate | null {
  const state = useRemoteServerStore.getState();
  if (!state.activeServerId || !state.activeRemoteTextModelId) return null;
  const model = state.discoveredModels[state.activeServerId]?.find(
    item => item.id === state.activeRemoteTextModelId,
  );
  const name = model?.name ?? state.activeRemoteTextModelId;
  const kind = catalogModelKind(name, [], state.activeRemoteTextModelId);
  return candidate(
    mobileRouteId({
      source: 'remote', hostId: state.activeServerId, modality: 'text',
      modelId: state.activeRemoteTextModelId,
    }),
    kind === 'code' ? 'text' : kind,
    name,
  );
}

function remoteMediaCandidate(
  modality: RemoteMediaModality,
): PersistedSelectionCandidate | null {
  const state = useRemoteServerStore.getState();
  const serverId = state.activeRemoteMediaServerIds[modality];
  const server = serverId ? state.servers.find(item => item.id === serverId) : null;
  const modelId = server?.selections?.[modality]?.trim();
  const option = server?.catalog?.[modality]?.find(item => item.id === modelId);
  return serverId && modelId
    ? candidate(
        mobileRouteId({ source: 'remote', hostId: serverId, modality, modelId }),
        modality,
        option?.name,
      )
    : null;
}

function localImageCandidate(): PersistedSelectionCandidate | null {
  const state = useAppStore.getState();
  const model = state.downloadedImageModels.find(item => item.id === state.activeImageModelId);
  return model
    ? candidate(
        mobileRouteId({
          source: 'local', hostId: model.backend ?? 'image-runtime',
          modality: 'image', modelId: model.id,
        }),
        'image',
        model.name,
      )
    : null;
}

function localTranscriptionCandidate(): PersistedSelectionCandidate | null {
  const modelId = useWhisperStore.getState().downloadedModelId;
  return modelId
    ? candidate(
        mobileRouteId({
          source: 'local', hostId: 'whisper.rn', modality: 'transcription', modelId,
        }),
        'transcription',
      )
    : null;
}

function classifierProjection(): PersistedSelectionProjection {
  const state = useAppStore.getState();
  const active = localTextCandidate(state.activeModelId, 'classifier');
  const remembered = localTextCandidate(state.lastTextModelId, 'classifier');
  return {
    local: localTextCandidate(state.settings.classifierModelId, 'classifier'),
    remote: null,
    localFallbacks: [active, remembered].filter(
      (item): item is PersistedSelectionCandidate => item !== null,
    ),
  };
}

/** Read raw platform persistence facts. Shared owns every reconciliation decision. */
export function readMobileSelectionProjection(
  modality: ModelModality,
): PersistedSelectionProjection {
  const app = useAppStore.getState();
  switch (modality) {
    case 'text':
      return {
        local: localTextCandidate(app.activeModelId),
        remote: remoteTextCandidate(),
        localFallbacks: [localTextCandidate(app.lastTextModelId)].filter(
          (item): item is PersistedSelectionCandidate => item !== null,
        ),
      };
    case 'image':
      return { local: localImageCandidate(), remote: remoteMediaCandidate('image') };
    case 'transcription':
      return { local: localTranscriptionCandidate(), remote: remoteMediaCandidate('transcription') };
    case 'voice':
      return {
        local: candidate(selectedMobileLocalVoiceRoute(), 'voice'),
        remote: remoteMediaCandidate('voice'),
      };
    case 'embedding':
      return { local: null, remote: remoteMediaCandidate('embedding') };
    case 'classifier':
      return classifierProjection();
    default:
      return { local: null, remote: null };
  }
}

/** Canonical read for non-reactive adapter code. Reconciliation remains owned by Shared. */
export function readMobileModelSelection(modality: ModelModality): string | null {
  return reconcileModelSelection(modality, readMobileSelectionProjection(modality)).selectedRouteId;
}

function clearRemoteMedia(modality: RemoteMediaModality): void {
  useRemoteServerStore.setState(state => ({
    activeRemoteMediaServerIds: Object.fromEntries(
      Object.entries(state.activeRemoteMediaServerIds).filter(([key]) => key !== modality),
    ),
    ...(modality === 'image' ? { activeRemoteImageModelId: null } : {}),
  }));
}

function rawRoute(routeId: string | null) {
  const route = routeId ? decodeModelRouteId(routeId) : null;
  if (routeId && !route) throw new Error('The selected model route is invalid');
  return route;
}

/** Mechanical persistence projection. It does not choose a source, fallback, or eligible model. */
export async function writeMobileSelectionProjection(
  modality: ModelModality,
  projection: SelectionProjectionWrite,
): Promise<void> {
  const local = rawRoute(projection.localRouteId);
  const remote = rawRoute(projection.remoteRouteId);
  switch (modality) {
    case 'text':
      useAppStore.setState({
        activeModelId: local?.modelId ?? null,
        ...(projection.rememberedLocalRouteId
          ? { lastTextModelId: rawRoute(projection.rememberedLocalRouteId)?.modelId ?? null }
          : {}),
      });
      useRemoteServerStore.setState({
        activeServerId: remote?.serverId ?? null,
        activeRemoteTextModelId: remote?.modelId ?? null,
      });
      break;
    case 'image':
      useAppStore.setState({ activeImageModelId: local?.modelId ?? null });
      if (!remote?.serverId) clearRemoteMedia('image');
      else {
        useRemoteServerStore.setState(state => ({
          activeRemoteMediaServerIds: { ...state.activeRemoteMediaServerIds, image: remote.serverId },
          activeRemoteImageModelId: remote.modelId,
        }));
      }
      break;
    case 'transcription':
      useWhisperStore.setState({
        downloadedModelId: local?.modelId ?? null, isModelLoaded: false, error: null,
      });
      if (!remote?.serverId) clearRemoteMedia('transcription');
      else {
        useRemoteServerStore.setState(state => ({
          activeRemoteMediaServerIds: {
            ...state.activeRemoteMediaServerIds, transcription: remote.serverId,
          },
        }));
      }
      break;
    case 'voice':
      await selectMobileLocalVoiceRoute(projection.localRouteId);
      if (!remote?.serverId) clearRemoteMedia('voice');
      else {
        useRemoteServerStore.setState(state => ({
          activeRemoteMediaServerIds: { ...state.activeRemoteMediaServerIds, voice: remote.serverId },
        }));
      }
      break;
    case 'embedding':
      if (!remote?.serverId) clearRemoteMedia('embedding');
      else {
        useRemoteServerStore.setState(state => ({
          activeRemoteMediaServerIds: { ...state.activeRemoteMediaServerIds, embedding: remote.serverId },
        }));
      }
      break;
    case 'classifier':
      useAppStore.setState(state => ({
        settings: { ...state.settings, classifierModelId: local?.modelId ?? null },
      }));
      break;
  }
}

export const mobileModelSelectionProjection: ModelSelectionProjectionPort = {
  read: readMobileSelectionProjection,
  write: writeMobileSelectionProjection,
};
