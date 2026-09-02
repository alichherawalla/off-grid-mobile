import type { RemoteModel, RemoteModelCategory, RemoteServer, ServerTestResult } from '../../types';
import { testEndpointAndGetModels } from '../adapters/remote/serverDiscovery';
import { getApiKeyImpl, storeApiKeyImpl } from '../adapters/remote/serverRuntime';
import { selectCanonicalModel } from './modelSelectionCommandPort';
import { mobileRouteId } from './mobileRoute';
import { mobileRemoteServerApplication, shouldRecoverRemoteServers } from './remoteServerApplication';

/** Thin Mobile facade. Shared owns every remote-server decision and transaction. */
class RemoteServerManager {
  async addServer(
    config: Omit<RemoteServer, 'id' | 'createdAt'> & { apiKey?: string },
  ): Promise<RemoteServer> {
    const { apiKey, ...server } = config;
    return mobileRemoteServerApplication.save({
      ...server, createdAt: new Date().toISOString(), credential: apiKey,
    }) as Promise<RemoteServer>;
  }

  async updateServer(
    id: string,
    updates: Partial<Omit<RemoteServer, 'id' | 'createdAt'>>,
  ): Promise<void> {
    const existing = mobileRemoteServerApplication.get(id);
    if (!existing) throw new Error(`Server not found: ${id}`);
    const { apiKey, ...publicUpdates } = updates;
    await mobileRemoteServerApplication.save({
      ...existing, ...publicUpdates, id,
      credential: apiKey || undefined, clearCredential: apiKey === '',
    });
  }

  removeServer(id: string): Promise<void> { return mobileRemoteServerApplication.remove(id); }
  getServers(): RemoteServer[] { return mobileRemoteServerApplication.list() as RemoteServer[]; }
  getServer(id: string): RemoteServer | null {
    return mobileRemoteServerApplication.get(id) as RemoteServer | null;
  }

  async getServerWithApiKey(id: string): Promise<(RemoteServer & { apiKey?: string }) | null> {
    const server = this.getServer(id);
    if (!server) return null;
    const apiKey = await this.getApiKey(id);
    return { ...server, apiKey: apiKey ?? undefined };
  }

  async testConnection(id: string): Promise<ServerTestResult> {
    return mobileRemoteServerApplication.check(id) as Promise<ServerTestResult>;
  }
  testConnectionByEndpoint(endpoint: string, apiKey?: string): Promise<ServerTestResult> {
    return testEndpointAndGetModels(endpoint, apiKey);
  }
  async discoverModels(id: string): Promise<RemoteModel[]> {
    return ((await mobileRemoteServerApplication.discover(id)).models ?? []) as RemoteModel[];
  }

  setActiveRemoteTextModel(serverId: string, modelId: string): Promise<void> {
    return selectCanonicalModel('text', mobileRouteId({
      source: 'remote', hostId: serverId, modality: 'text', modelId,
    }));
  }
  prepareRemoteTextModel(serverId: string, modelId: string): Promise<void> {
    return mobileRemoteServerApplication.prepareActivation(serverId, 'text', modelId);
  }
  setActiveRemoteImageModel(serverId: string, modelId: string): Promise<void> {
    return selectCanonicalModel('image', mobileRouteId({
      source: 'remote', hostId: serverId, modality: 'image', modelId,
    }));
  }
  setActiveRemoteMediaModel(
    serverId: string, category: Exclude<RemoteModelCategory, 'text'>, modelId: string,
  ): Promise<void> {
    return selectCanonicalModel(category, mobileRouteId({
      source: 'remote', hostId: serverId, modality: category, modelId,
    }));
  }
  prepareRemoteMediaModel(
    serverId: string, category: Exclude<RemoteModelCategory, 'text'>, modelId: string,
  ): Promise<void> {
    return mobileRemoteServerApplication.prepareActivation(serverId, category, modelId);
  }
  clearActiveRemoteTextModel(): Promise<void> { return selectCanonicalModel('text', null); }
  clearActiveRemoteMediaModel(category: Exclude<RemoteModelCategory, 'text'>): Promise<void> {
    return selectCanonicalModel(category, null);
  }
  initializeProviders(): Promise<void> { return mobileRemoteServerApplication.initialize(); }

  async scanAndReconcile(
    onFound?: (server: { endpoint: string; name: string }) => void,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{
    moved: string[];
    found: Array<{ endpoint: string; name: string; type: 'gateway' }>;
  }> {
    const result = await mobileRemoteServerApplication.reconcile({ onFound, onProgress });
    return { ...result, found: result.found.map(server => ({ ...server, type: 'gateway' })) };
  }
  async recoverActiveConnection(): Promise<void> {
    await mobileRemoteServerApplication.recover(shouldRecoverRemoteServers());
  }
  async clearAllServers(): Promise<void> {
    for (const server of this.getServers()) await mobileRemoteServerApplication.remove(server.id);
  }
  storeApiKey(serverId: string, apiKey: string): Promise<void> {
    return storeApiKeyImpl(serverId, apiKey);
  }
  getApiKey(serverId: string): Promise<string | null> { return getApiKeyImpl(serverId); }
}

export const remoteServerManager = new RemoteServerManager();
