import {
  RemoteServerApplicationService,
  mergeRemoteSelections,
  type PersistedRemoteServer,
  type RemoteModelModality,
  type RemoteServerConfiguration,
} from '@offgrid/models';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { useAppStore } from '../../stores/appStore';
import { generateId } from '../../utils/generateId';
import { remoteTextTransportRegistry } from '../adapters/providers/registry';
import { discoverLANServers } from '../networkDiscovery';
import {
  fetchModelsFromServer,
  testServerConnection,
} from '../adapters/remote/serverDiscovery';
import {
  createProviderForServerImpl,
  getApiKeyImpl,
  removeApiKeyImpl,
  storeApiKeyImpl,
} from '../adapters/remote/serverRuntime';
import { activateOffGridDesktopModel } from '../adapters/remote/offGridDesktopModels';
import {
  removeCanonicalServerSelections,
  selectCanonicalModel,
} from './modelSelectionCommandPort';
import { mobileRouteId } from './mobileRoute';
import type { RemoteModel, RemoteServer } from '../../types';

function readConfiguration(): RemoteServerConfiguration {
  const state = useRemoteServerStore.getState();
  return { version: 1, activeServerId: state.activeServerId, servers: state.servers };
}

function writeConfiguration(value: RemoteServerConfiguration): void {
  const ids = new Set(value.servers.map(server => server.id));
  useRemoteServerStore.setState(state => ({
    servers: value.servers.map(server => ({
      ...server,
      createdAt: server.createdAt ?? new Date(0).toISOString(),
    })),
    discoveredModels: Object.fromEntries(
      Object.entries(state.discoveredModels).filter(([id]) => ids.has(id)),
    ),
    serverHealth: Object.fromEntries(
      Object.entries(state.serverHealth).filter(([id]) => ids.has(id)),
    ),
  }));
}

interface ManagedActivationInput {
  server: PersistedRemoteServer;
  modality: RemoteModelModality;
  modelId: string;
  credential: string | null;
}

/** Translate Shared's credential-free record into the Mobile HTTP adapter input. */
function mobileTransportServer(
  server: PersistedRemoteServer,
  credential: string | null,
): RemoteServer {
  return {
    id: server.id,
    name: server.name,
    endpoint: server.endpoint,
    provider: server.provider,
    selections: server.selections,
    catalog: server.catalog,
    ...(server.modelManagement
      ? { modelManagement: server.modelManagement }
      : {}),
    createdAt: server.createdAt ?? new Date(0).toISOString(),
    ...(server.screenFramesAllowed === true
      ? { screenFramesAllowed: true }
      : {}),
    ...(credential ? { apiKey: credential } : {}),
  };
}

function isRemoteModel(value: unknown): value is RemoteModel {
  if (!value || typeof value !== 'object') return false;
  const model = value as Partial<RemoteModel>;
  return (
    typeof model.id === 'string' &&
    typeof model.name === 'string' &&
    typeof model.serverId === 'string' &&
    typeof model.lastUpdated === 'string' &&
    Boolean(model.capabilities)
  );
}

function activateManagedRemote({
  server,
  modality,
  modelId,
  credential,
}: ManagedActivationInput) {
  return activateOffGridDesktopModel(
    mobileTransportServer(server, credential),
    modality,
    modelId,
  );
}

/** Mobile composition: all decisions live in Shared; this file only connects platform I/O. */
export const mobileRemoteServerApplication = new RemoteServerApplicationService(
  {
    configuration: { read: readConfiguration, write: writeConfiguration },
    credentials: {
      read: getApiKeyImpl,
      write: storeApiKeyImpl,
      remove: removeApiKeyImpl,
    },
    providers: {
      register: (server, credential) => createProviderForServerImpl(server, credential),
      update: (server, credential) => createProviderForServerImpl(server, credential),
      unregister(serverId) { remoteTextTransportRegistry.unregister(serverId); },
    },
    async select(modality, route) {
      await selectCanonicalModel(
        modality,
        route
          ? mobileRouteId({
              source: 'remote', hostId: route.serverId, modality, modelId: route.modelId,
            })
          : null,
      );
    },
    clearSelections: removeCanonicalServerSelections,
    async discover(server, credential) {
      const models = await fetchModelsFromServer({
        ...server,
        createdAt: server.createdAt ?? new Date(0).toISOString(),
        apiKey: credential ?? undefined,
      });
      return { models };
    },
    projectDiscovery(serverId, result) {
      useRemoteServerStore.getState().setDiscoveredModels(
        serverId,
        (result.models ?? []).filter(isRemoteModel),
      );
    },
    async test(server, credential) {
      const result = await testServerConnection({
        ...server,
        createdAt: server.createdAt ?? new Date(0).toISOString(),
        apiKey: credential ?? undefined,
      });
      useRemoteServerStore.getState().updateServerHealth(server.id, result.success);
      if (result.models) {
        useRemoteServerStore.getState().setDiscoveredModels(server.id, result.models);
      }
      if (result.success && result.selections) {
        const current = readConfiguration();
        const found = current.servers.find(candidate => candidate.id === server.id);
        if (found) {
          writeConfiguration({
            ...current,
            servers: current.servers.map(candidate => candidate.id === server.id
              ? {
                  ...candidate,
                  selections: mergeRemoteSelections(
                    candidate.selections,
                    result.selections,
                    result.modelManagement === 'offgrid-desktop-v1',
                  ),
                  catalog: result.catalog ?? candidate.catalog,
                  modelManagement: result.modelManagement ?? candidate.modelManagement,
                }
              : candidate),
          });
        }
      }
      return result;
    },
    scan: discoverLANServers,
    activateManaged(...args) {
      return activateManagedRemote({
        server: args[0],
        modality: args[1],
        modelId: args[2],
        credential: args[3],
      });
    },
  },
  generateId,
);

export function shouldRecoverRemoteServers(): boolean {
  return Boolean(useAppStore.getState().settings.autoDiscoverRemoteModels);
}
