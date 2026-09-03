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
  /** @deprecated Legacy persistence read once by the selection migration. The active server is the text route's. */
  activeServerId?: string | null;
  /** Models discovered per server */
  discoveredModels: Record<string, RemoteModel[]>;
  /** Server health status */
  serverHealth: Record<string, RemoteServerHealth>;
  /** Loading states */
  isLoading: boolean;
  testingServerId: string | null;
  discoveringServerId: string | null;

  /** @deprecated Legacy persistence read once by the selection migration. */
  activeRemoteTextModelId?: string | null;
  /** @deprecated Legacy persistence read once by the selection migration. */
  activeRemoteImageModelId?: string | null;
  /** @deprecated Legacy persistence read once by the selection migration. */
  activeRemoteMediaServerIds?: Partial<
    Record<Exclude<RemoteModelCategory, 'text'>, string>
  >;

  // Discovery and health projections
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
      discoveredModels: {},
      serverHealth: {},
      isLoading: false,
      testingServerId: null,
      discoveringServerId: null,
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
        discoveredModels: state.discoveredModels,
        // Don't persist health status - it should be refreshed
      }),
    },
  ),
);
