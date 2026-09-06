import {
  catalogKindForArtifact,
  catalogModelKind,
  decodeModelRouteId,
  reconcileModelSelection,
  selectionProjectionAfterRemoval,
  selectedRemoteModelName,
  type ModelModality,
  type ModelSelectionProjectionPort,
  type PersistedSelectionCandidate,
  type PersistedSelectionProjection,
  type SelectionProjectionWrite,
} from '@offgrid/models';
import { useAppStore } from '../../stores/appStore';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { useWhisperStore } from '../../stores/whisperStore';
import { useModelSelectionStore, type PersistedSelectionEntry } from '../../stores/modelSelectionStore';
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

// ---------------------------------------------------------------------------------------------
// Candidates from the ONE selection store. A persisted route is a candidate only while the model it
// names is still on this device (a deleted download must not stay selected); that installed fact is
// the only thing read from the library stores.
// ---------------------------------------------------------------------------------------------

function localTextCandidateFor(
  modelId: string | null | undefined,
  modality: 'text' | 'classifier' = 'text',
): PersistedSelectionCandidate | null {
  if (!modelId) return null;
  const model = useAppStore.getState().downloadedModels.find(item => item.id === modelId);
  if (!model) return null;
  const kind = catalogKindForArtifact(model) ?? catalogModelKind(model.name, [], model.id);
  return candidate(
    mobileRouteId({ source: 'local', hostId: model.engine, modality, modelId: model.id }),
    kind,
    model.name,
  );
}

function localCandidateFromRoute(
  modality: ModelModality,
  routeId: string | null | undefined,
): PersistedSelectionCandidate | null {
  const route = routeId ? decodeModelRouteId(routeId) : null;
  if (!route || route.serverId) return null;
  switch (modality) {
    case 'text':
    case 'classifier':
      return localTextCandidateFor(route.modelId, modality);
    case 'image': {
      const model = useAppStore
        .getState()
        .downloadedImageModels.find(item => item.id === route.modelId);
      return model ? candidate(routeId!, 'image', model.name) : null;
    }
    case 'transcription':
      return candidate(routeId!, 'transcription');
    case 'voice':
      return candidate(selectedMobileLocalVoiceRoute(), 'voice');
    default:
      return null;
  }
}

function remoteCandidateFromRoute(
  modality: ModelModality,
  routeId: string | null | undefined,
): PersistedSelectionCandidate | null {
  const route = routeId ? decodeModelRouteId(routeId) : null;
  if (!route?.serverId) return null;
  const server = useRemoteServerStore.getState().servers.find(item => item.id === route.serverId);
  if (!server) return null;
  if (modality === 'text') {
    const name =
      selectedRemoteModelName(
        { ...server, selections: { ...server.selections, text: route.modelId } },
        'text',
      ) ?? route.modelId;
    const kind = catalogModelKind(name, [], route.modelId);
    return candidate(routeId!, kind, name);
  }
  return candidate(
    routeId!,
    modality,
    selectedRemoteModelName(server, modality as RemoteMediaModality) ?? undefined,
  );
}

function projectionFromEntry(
  modality: ModelModality,
  entry: PersistedSelectionEntry,
): PersistedSelectionProjection {
  const remembered = localCandidateFromRoute(modality, entry.rememberedLocalRouteId);
  return {
    local: localCandidateFromRoute(modality, entry.localRouteId),
    remote: remoteCandidateFromRoute(modality, entry.remoteRouteId),
    localFallbacks: remembered ? [remembered] : [],
  };
}

// ---------------------------------------------------------------------------------------------
// One-time migration from the retired per-store fields. Read only when the selection store has no
// entry for a modality; the result is written into the selection store so it never runs again.
// ---------------------------------------------------------------------------------------------

function consumeLegacyWhisperModelId(): string | null {
  const modelId = useWhisperStore.getState().downloadedModelId;
  if (modelId) useWhisperStore.setState({ downloadedModelId: null });
  return modelId;
}

interface LegacyStores {
  app: ReturnType<typeof useAppStore.getState>;
  remote: ReturnType<typeof useRemoteServerStore.getState>;
}

/**
 * Before the selection store, a media selection lived on the legacy active server's own
 * `selections`; an image selection also needed the retired activeRemoteImageModelId. Read here once.
 */
function legacyRemoteMediaRoute(stores: LegacyStores, media: RemoteMediaModality): string | null {
  const { remote } = stores;
  if (media === 'embedding') return null;
  if (media === 'image' && !remote.activeRemoteImageModelId) return null;
  const server = remote.activeServerId
    ? remote.servers.find(item => item.id === remote.activeServerId)
    : null;
  const modelId = server?.selections?.[media]?.trim();
  return server && modelId
    ? mobileRouteId({ source: 'remote', hostId: server.id, modality: media, modelId })
    : null;
}

function legacyLocalTextRoute(stores: LegacyStores, modelId: string | null | undefined): string | null {
  const model = modelId ? stores.app.downloadedModels.find(item => item.id === modelId) : null;
  return model
    ? mobileRouteId({ source: 'local', hostId: model.engine, modality: 'text', modelId: model.id })
    : null;
}

function legacyEntryOf(
  localRouteId: string | null,
  remoteRouteId: string | null,
  remembered?: string | null,
): PersistedSelectionEntry | null {
  if (!localRouteId && !remoteRouteId && !remembered) return null;
  return { localRouteId, remoteRouteId, ...(remembered ? { rememberedLocalRouteId: remembered } : {}) };
}

function legacyTextEntry(stores: LegacyStores): PersistedSelectionEntry | null {
  const { remote, app } = stores;
  const remoteRouteId =
    remote.activeServerId && remote.activeRemoteTextModelId
      ? mobileRouteId({
          source: 'remote',
          hostId: remote.activeServerId,
          modality: 'text',
          modelId: remote.activeRemoteTextModelId,
        })
      : null;
  return legacyEntryOf(
    legacyLocalTextRoute(stores, app.activeModelId),
    remoteRouteId,
    legacyLocalTextRoute(stores, app.lastTextModelId),
  );
}

function legacyImageEntry(stores: LegacyStores): PersistedSelectionEntry | null {
  const model = stores.app.downloadedImageModels.find(item => item.id === stores.app.activeImageModelId);
  const localRouteId = model
    ? mobileRouteId({
        source: 'local',
        hostId: model.backend ?? 'image-runtime',
        modality: 'image',
        modelId: model.id,
      })
    : null;
  return legacyEntryOf(localRouteId, legacyRemoteMediaRoute(stores, 'image'));
}

function legacyTranscriptionEntry(stores: LegacyStores): PersistedSelectionEntry | null {
  const modelId = consumeLegacyWhisperModelId();
  const localRouteId = modelId
    ? mobileRouteId({ source: 'local', hostId: 'whisper.rn', modality: 'transcription', modelId })
    : null;
  return legacyEntryOf(localRouteId, legacyRemoteMediaRoute(stores, 'transcription'));
}

function legacyClassifierEntry(stores: LegacyStores): PersistedSelectionEntry | null {
  const classifierId = stores.app.settings.classifierModelId;
  const localRouteId = classifierId
    ? localTextCandidateFor(classifierId, 'classifier')?.routeId ?? null
    : null;
  return legacyEntryOf(
    localRouteId,
    null,
    legacyLocalTextRoute(stores, stores.app.activeModelId ?? stores.app.lastTextModelId),
  );
}

/** The retired per-store fields, read once per modality. */
function legacyEntry(modality: ModelModality): PersistedSelectionEntry | null {
  const stores: LegacyStores = {
    app: useAppStore.getState(),
    remote: useRemoteServerStore.getState(),
  };
  switch (modality) {
    case 'text':
      return legacyTextEntry(stores);
    case 'image':
      return legacyImageEntry(stores);
    case 'transcription':
      return legacyTranscriptionEntry(stores);
    case 'voice':
      return legacyEntryOf(selectedMobileLocalVoiceRoute(), legacyRemoteMediaRoute(stores, 'voice'));
    case 'embedding':
      return legacyEntryOf(null, legacyRemoteMediaRoute(stores, 'embedding'));
    case 'classifier':
      return legacyClassifierEntry(stores);
    default:
      return null;
  }
}

function entryFor(modality: ModelModality): PersistedSelectionEntry | null {
  const store = useModelSelectionStore.getState();
  const entry = store.entries[modality];
  if (entry) return entry;
  const migrated = legacyEntry(modality);
  if (migrated) store.setEntry(modality, migrated);
  return migrated;
}

/** Read raw persistence facts. Shared owns every reconciliation decision. */
function readMobileSelectionProjection(modality: ModelModality): PersistedSelectionProjection {
  const entry = entryFor(modality);
  if (!entry) return { local: null, remote: null };
  const projection = projectionFromEntry(modality, entry);
  if (modality === 'classifier' && !projection.local && !projection.localFallbacks?.length) {
    // A classifier with no explicit pick falls back to the active or remembered text model.
    const text = entryFor('text');
    const fallbacks = [text?.localRouteId, text?.rememberedLocalRouteId]
      .map(routeId => {
        const route = routeId ? decodeModelRouteId(routeId) : null;
        return route ? localTextCandidateFor(route.modelId, 'classifier') : null;
      })
      .filter((item): item is PersistedSelectionCandidate => item !== null);
    return { ...projection, localFallbacks: fallbacks };
  }
  return projection;
}

/** The last explicitly selected LOCAL text model, kept for restoration after eviction. */
export function rememberedLocalTextModelId(): string | null {
  const routeId = entryFor('text')?.rememberedLocalRouteId;
  return routeId ? decodeModelRouteId(routeId)?.modelId ?? null : null;
}

/** Canonical read for non-reactive adapter code. Reconciliation remains owned by Shared. */
export function readMobileModelSelection(modality: ModelModality): string | null {
  return reconcileModelSelection(modality, readMobileSelectionProjection(modality)).selectedRouteId;
}

function selectedRoute(modality: ModelModality) {
  const routeId = readMobileModelSelection(modality);
  return routeId ? decodeModelRouteId(routeId) : null;
}

/** The selected LOCAL model id for a modality; a remote route reads as null. */
export function selectedLocalModelId(modality: ModelModality): string | null {
  const route = selectedRoute(modality);
  return route && !route.serverId ? route.modelId : null;
}

/** True when the selected route for a modality points at a remote server. */
export function selectedRouteIsRemote(modality: ModelModality): boolean {
  return Boolean(selectedRoute(modality)?.serverId);
}

/** The selected remote server identity, read from the canonical persisted selection. */
export function selectedRemoteServerId(modality: ModelModality): string | null {
  return selectedRoute(modality)?.serverId ?? null;
}

function rawRoute(routeId: string | null | undefined) {
  const route = routeId ? decodeModelRouteId(routeId) : null;
  if (routeId && !route) throw new Error('The selected model route is invalid');
  return route;
}

/**
 * Mechanical persistence: the entry is written to the one selection store. The two native runtimes
 * that read their own selected model (whisper.rn, the TTS engine) get their projection here too.
 */
async function writeMobileSelectionProjection(
  modality: ModelModality,
  projection: SelectionProjectionWrite,
): Promise<void> {
  const local = rawRoute(projection.localRouteId);
  rawRoute(projection.remoteRouteId);
  const previous = useModelSelectionStore.getState().entries[modality];
  useModelSelectionStore.getState().setEntry(modality, {
    localRouteId: projection.localRouteId,
    remoteRouteId: projection.remoteRouteId,
    // A clear must not erase restoration history.
    ...(projection.rememberedLocalRouteId
      ? { rememberedLocalRouteId: projection.rememberedLocalRouteId }
      : previous?.rememberedLocalRouteId
        ? { rememberedLocalRouteId: previous.rememberedLocalRouteId }
        : {}),
  });
  switch (modality) {
    case 'voice':
      await selectMobileLocalVoiceRoute(projection.localRouteId);
      break;
    case 'classifier':
      useAppStore.setState(state => ({
        settings: { ...state.settings, classifierModelId: local?.modelId ?? null },
      }));
      break;
    default:
      break;
  }
}

export const mobileModelSelectionProjection: ModelSelectionProjectionPort = {
  read: readMobileSelectionProjection,
  write: writeMobileSelectionProjection,
};

export async function removeMobileServerSelection(
  modality: ModelModality,
  serverId: string,
): Promise<boolean> {
  const persisted = mobileModelSelectionProjection.read(modality);
  const selectedRouteId = reconcileModelSelection(modality, persisted).selectedRouteId;
  const update = selectionProjectionAfterRemoval({
    modality,
    selectedRouteId,
    removedServerId: serverId,
    localFallback: persisted.localFallbacks?.[0] ?? null,
  });
  if (!update) return false;
  await mobileModelSelectionProjection.write(modality, update);
  return true;
}
