/**
 * Remote Server Store
 *
 * Zustand store for managing remote LLM server configurations.
 * Handles server CRUD, model discovery, and active server selection.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  RemoteServer,
  RemoteModel,
  RemoteModelCategory,
} from '../types';
import {
  migrateRemoteServerConfiguration,
  type RemoteServerHealth,
} from '@offgrid/models';

interface RemoteServerState {
  /** Configured remote servers */
  servers: RemoteServer[];
  /** Currently active server ID (null = local only) */
  activeServerId: string | null;
  /** Models discovered per server */
  discoveredModels: Record<string, RemoteModel[]>;
  /** Server health status */
  serverHealth: Record<string, RemoteServerHealth>;
  /** Loading states */
  isLoading: boolean;
  testingServerId: string | null;
  discoveringServerId: string | null;

  /** Active remote text model ID (when using remote for text generation) */
  activeRemoteTextModelId: string | null;
  /** Active remote image/vision model ID (when using remote for vision) */
  activeRemoteImageModelId: string | null;
  /** Active server per non-text category. Text keeps activeServerId for provider routing. */
  activeRemoteMediaServerIds: Partial<
    Record<Exclude<RemoteModelCategory, 'text'>, string>
  >;

  // Active server
  getActiveServer: () => RemoteServer | null;

  // Active remote model selection
  getActiveRemoteTextModel: () => RemoteModel | null;
  getActiveRemoteImageModel: () => RemoteModel | null;
  getActiveRemoteMediaServer: (
    category: Exclude<RemoteModelCategory, 'text'>,
  ) => RemoteServer | null;

  // Boundary projections
  setDiscoveredModels: (serverId: string, models: RemoteModel[]) => void;
  clearDiscoveredModels: (serverId: string) => void;
  updateServerHealth: (serverId: string, isHealthy: boolean) => void;

  // Utility
  getServerById: (id: string) => RemoteServer | null;
  getModelById: (serverId: string, modelId: string) => RemoteModel | null;
}

type PersistedRemoteServerState = Partial<RemoteServerState>;
export function migrateRemoteServerState(
  persisted: unknown,
): PersistedRemoteServerState {
  const raw = (persisted ?? {}) as PersistedRemoteServerState;
  const migrated = migrateRemoteServerConfiguration(persisted);
  const servers = migrated.servers.map(server => ({
    ...server,
    createdAt: server.createdAt ?? new Date(0).toISOString(),
  })) as RemoteServer[];
  const state: PersistedRemoteServerState = {
    ...raw,
    servers,
    activeServerId: migrated.activeServerId,
  };
  if (state.activeRemoteMediaServerIds) return state;
  const activeServer = servers?.find(
    server => server.id === state.activeServerId,
  );
  if (!activeServer) return { ...state, activeRemoteMediaServerIds: {} };
  return {
    ...state,
    activeRemoteMediaServerIds: {
      ...(state.activeRemoteImageModelId && activeServer.selections?.image
        ? { image: activeServer.id }
        : {}),
      ...(activeServer.selections?.transcription
        ? { transcription: activeServer.id }
        : {}),
      ...(activeServer.selections?.voice ? { voice: activeServer.id } : {}),
    },
  };
}

export const useRemoteServerStore = create<RemoteServerState>()(
  persist(
    (set, get) => ({
      servers: [],
      activeServerId: null,
      discoveredModels: {},
      serverHealth: {},
      isLoading: false,
      testingServerId: null,
      discoveringServerId: null,
      activeRemoteTextModelId: null,
      activeRemoteImageModelId: null,
      activeRemoteMediaServerIds: {},

      getActiveServer: () => {
        const { servers, activeServerId } = get();
        return servers.find(s => s.id === activeServerId) || null;
      },

      getActiveRemoteTextModel: () => {
        const { activeRemoteTextModelId, activeServerId, discoveredModels } =
          get();
        if (!activeRemoteTextModelId || !activeServerId) return null;
        const models = discoveredModels[activeServerId] || [];
        return models.find(m => m.id === activeRemoteTextModelId) || null;
      },

      getActiveRemoteImageModel: () => {
        const {
          activeRemoteImageModelId,
          activeRemoteMediaServerIds,
          discoveredModels,
        } = get();
        const serverId = activeRemoteMediaServerIds.image;
        if (!activeRemoteImageModelId || !serverId) return null;
        const models = discoveredModels[serverId] || [];
        return models.find(m => m.id === activeRemoteImageModelId) || null;
      },

      getActiveRemoteMediaServer: category => {
        const { servers, activeRemoteMediaServerIds } = get();
        const serverId = activeRemoteMediaServerIds[category];
        return servers.find(server => server.id === serverId) ?? null;
      },

      setDiscoveredModels: (serverId, models) => {
        set(state => ({
          discoveredModels: {
            ...state.discoveredModels,
            [serverId]: models,
          },
        }));
      },

      clearDiscoveredModels: serverId => {
        set(state => {
          const newDiscovered = { ...state.discoveredModels };
          delete newDiscovered[serverId];
          return { discoveredModels: newDiscovered };
        });
      },

      updateServerHealth: (serverId, isHealthy) => {
        set(state => ({
          serverHealth: {
            ...state.serverHealth,
            [serverId]: {
              status: isHealthy ? 'healthy' : 'unhealthy',
              checkedAt: new Date().toISOString(),
            },
          },
        }));
      },

      // Utility
      getServerById: id => {
        const { servers } = get();
        return servers.find(s => s.id === id) || null;
      },

      getModelById: (serverId, modelId) => {
        const { discoveredModels } = get();
        const models = discoveredModels[serverId] || [];
        return models.find(m => m.id === modelId) || null;
      },

    }),
    {
      name: 'remote-servers',
      version: 3,
      migrate: migrateRemoteServerState,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        servers: state.servers.map(({ apiKey: _apiKey, ...server }) => server),
        activeServerId: state.activeServerId,
        activeRemoteTextModelId: state.activeRemoteTextModelId,
        activeRemoteImageModelId: state.activeRemoteImageModelId,
        activeRemoteMediaServerIds: state.activeRemoteMediaServerIds,
        discoveredModels: state.discoveredModels,
        // Don't persist health status - it should be refreshed
      }),
    },
  ),
);
