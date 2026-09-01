import {
  decodeModelRouteId,
  type ModelSelectionStore,
} from '@offgrid/models';
import { useAppStore } from '../../stores/appStore';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { useWhisperStore } from '../../stores/whisperStore';
import {
  resolveSelectedTextModel,
  selectedTextModelId,
  selectTextModel,
} from './modelState';
import { remoteServerManager } from '../remoteServerManager';
import { mobileRouteId } from './mobileRoute';
import { selectedMobileLocalVoiceRoute } from './voiceGenerationAdapter';

type MobileRemoteMediaModality = 'image' | 'transcription' | 'voice';

function readRemoteMedia(modality: MobileRemoteMediaModality): string | null {
  const state = useRemoteServerStore.getState();
  const serverId = state.activeRemoteMediaServerIds[modality];
  const server = serverId ? state.servers.find(candidate => candidate.id === serverId) : null;
  const modelId = server?.selections?.[modality]?.trim();
  return serverId && modelId
    ? mobileRouteId({ source: 'remote', hostId: serverId, modality, modelId })
    : null;
}

/** Persisted Mobile stores are ports. The shared service owns selection semantics. */
export const mobileModelSelectionStore: ModelSelectionStore = {
  read(modality) {
    const remote = useRemoteServerStore.getState();
    if (modality === 'text') {
      if (remote.activeServerId && remote.activeRemoteTextModelId) {
        return mobileRouteId({
          source: 'remote',
          hostId: remote.activeServerId,
          modality,
          modelId: remote.activeRemoteTextModelId,
        });
      }
      const local = resolveSelectedTextModel();
      return local
        ? mobileRouteId({
            source: 'local',
            hostId: local.engine,
            modality,
            modelId: local.id,
          })
        : null;
    }
    const remoteMedia = modality === 'image' || modality === 'transcription' || modality === 'voice'
      ? readRemoteMedia(modality)
      : null;
    if (remoteMedia) return remoteMedia;
    if (modality === 'voice') return selectedMobileLocalVoiceRoute();
    if (modality === 'image') {
      const state = useAppStore.getState();
      const model = state.downloadedImageModels.find(
        candidate => candidate.id === state.activeImageModelId,
      );
      return model
        ? mobileRouteId({
            source: 'local',
            hostId: model.backend ?? 'image-runtime',
            modality,
            modelId: model.id,
          })
        : null;
    }
    if (modality === 'transcription') {
      const modelId = useWhisperStore.getState().downloadedModelId;
      return modelId
        ? mobileRouteId({
            source: 'local',
            hostId: 'whisper.rn',
            modality,
            modelId,
          })
        : null;
    }
    if (modality === 'classifier') {
      const state = useAppStore.getState();
      const modelId = state.settings.classifierModelId ?? selectedTextModelId();
      const model = modelId
        ? state.downloadedModels.find(candidate => candidate.id === modelId)
        : null;
      return model
        ? mobileRouteId({
            source: 'local',
            hostId: model.engine,
            modality,
            modelId: model.id,
          })
        : null;
    }
    return null;
  },

  async write(modality, canonicalId) {
    if (!canonicalId) {
      if (modality === 'text') {
        remoteServerManager.clearActiveRemoteTextModel();
        useAppStore.getState().setActiveModelId(null);
      } else if (modality === 'image') {
        remoteServerManager.clearActiveRemoteMediaModel('image');
        useAppStore.getState().setActiveImageModelId(null);
      } else if (modality === 'transcription') {
        remoteServerManager.clearActiveRemoteMediaModel('transcription');
        useWhisperStore.setState({ downloadedModelId: null, isModelLoaded: false });
      } else if (modality === 'voice') {
        remoteServerManager.clearActiveRemoteMediaModel('voice');
      } else if (modality === 'classifier') {
        useAppStore.getState().updateSettings({ classifierModelId: null });
      }
      return;
    }
    const route = decodeModelRouteId(canonicalId);
    if (!route) {
      throw new Error('The selected model route is invalid');
    }
    const serverId = route.serverId;
    if (serverId) {
      if (modality === 'text') {
        await remoteServerManager.setActiveRemoteTextModel(
          serverId,
          route.modelId,
        );
      } else if (
        modality === 'image' ||
        modality === 'transcription' ||
        modality === 'voice'
      ) {
        await remoteServerManager.setActiveRemoteMediaModel(
          serverId,
          modality,
          route.modelId,
        );
      } else {
        throw new Error(`Remote ${modality} selection is not supported`);
      }
      return;
    }
    if (modality === 'text') {
      remoteServerManager.clearActiveRemoteTextModel();
      selectTextModel(route.modelId);
    } else if (modality === 'image') {
      remoteServerManager.clearActiveRemoteMediaModel('image');
      useAppStore.getState().setActiveImageModelId(route.modelId);
    } else if (modality === 'transcription') {
      remoteServerManager.clearActiveRemoteMediaModel('transcription');
      useWhisperStore.setState({
        downloadedModelId: route.modelId,
        isModelLoaded: false,
        error: null,
      });
    } else if (modality === 'classifier') {
      useAppStore.getState().updateSettings({ classifierModelId: route.modelId });
    } else {
      throw new Error('Local voice selection is owned by the Pro voice adapter');
    }
  },
};
