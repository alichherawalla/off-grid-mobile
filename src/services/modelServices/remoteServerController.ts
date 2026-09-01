/**
 * Remote Server Manager
 *
 * Manages remote LLM server connections, including:
 * - CRUD operations for server configurations
 * - Secure API key storage using React Native Keychain
 * - Provider creation and management
 */

import {
  RemoteServer,
  RemoteModel,
  RemoteModelCategory,
  ServerTestResult,
} from '../../types';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { useAppStore } from '../../stores/appStore';
import { remoteTextTransportRegistry } from '../adapters/providers/registry';
import { discoverLANServers, DiscoveredServer } from '../networkDiscovery';
import {
  reconcileRemoteServerDiscovery,
  remoteEndpointIdentity,
  remoteRecoveryDecision,
  isRemoteModelModality,
  selectedModalitiesForRemovedServer,
  selectionAfterRemoteServerRemoval,
  shouldAutoDiscoverRemoteModels,
} from '@offgrid/models';
import logger from '../../utils/logger';
import {
  storeApiKeyImpl,
  getApiKeyImpl,
  removeApiKeyImpl,
  createProviderForServerImpl,
  setActiveRemoteTextModelImpl,
  setActiveRemoteImageModelImpl,
  initializeProvidersImpl,
} from '../adapters/remote/serverRuntime';
import {
  canReconcileCredentialedEndpoint,
  remoteAuthorizationHeaders,
} from '@offgrid/models';
import { activateOffGridDesktopModel } from '../adapters/remote/offGridDesktopModels';
import { selectCanonicalModel } from './modelSelectionCommandPort';
import { mobileRouteId } from './mobileRoute';

class RemoteServerManager {
  /**
   * Add a new remote server
   */
  async addServer(
    config: Omit<RemoteServer, 'id' | 'createdAt'> & { apiKey?: string },
  ): Promise<RemoteServer> {
    const store = useRemoteServerStore.getState();

    // Deduplicate: if a server with the same endpoint already exists, return it
    const normalizedEndpoint = remoteEndpointIdentity(config.endpoint);
    const existing = store.servers.find(
      s => remoteEndpointIdentity(s.endpoint) === normalizedEndpoint,
    );
    if (existing) {
      logger.log('[RemoteServerManager] Server already exists:', existing.name);
      return existing;
    }

    // Credentials belong only in Keychain. Never put them in the persisted Zustand server record.
    const { apiKey, ...publicConfig } = config;
    const id = store.addServer(publicConfig);
    if (apiKey) {
      await this.storeApiKey(id, apiKey);
    }

    const server = store.getServerById(id);
    if (!server) throw new Error('Failed to create server');

    await createProviderForServerImpl(server);
    logger.log('[RemoteServerManager] Added server:', server.name);
    return server;
  }

  /**
   * Update a server configuration
   */
  async updateServer(
    id: string,
    updates: Partial<Omit<RemoteServer, 'id' | 'createdAt'>>,
  ): Promise<void> {
    const store = useRemoteServerStore.getState();
    const existingServer = store.getServerById(id);

    if (!existingServer) throw new Error(`Server not found: ${id}`);

    if (updates.apiKey !== undefined) {
      if (updates.apiKey) {
        await this.storeApiKey(id, updates.apiKey);
      } else {
        await this.removeApiKey(id);
      }
    }

    const { apiKey: _, ...storeUpdates } = updates;
    store.updateServer(id, storeUpdates);

    const transport = remoteTextTransportRegistry.get(id);
    if (transport?.updateConfig) {
      const apiKey = await this.getApiKey(id);
      const endpoint = updates.endpoint || existingServer.endpoint;
      const authorization = remoteAuthorizationHeaders(endpoint, apiKey);
      transport.updateConfig({
        endpoint,
        apiKey: authorization.Authorization?.replace(/^Bearer /, ''),
      });
    }

    logger.log('[RemoteServerManager] Updated server:', id);
  }

  /**
   * Remove a server
   */
  async removeServer(id: string): Promise<void> {
    const selection = useRemoteServerStore.getState();
    const modalities = selectedModalitiesForRemovedServer({
      serverId: id,
      activeTextServerId: selection.activeServerId,
      activeMediaServerIds: selection.activeRemoteMediaServerIds,
    });
    const app = useAppStore.getState();
    const lastLocal = app.downloadedModels.find(model => model.id === app.lastTextModelId);
    const localTextFallback = lastLocal
      ? mobileRouteId({
          source: 'local',
          hostId: lastLocal.engine,
          modality: 'text',
          modelId: lastLocal.id,
        })
      : null;
    const remoteModalities = modalities.filter(
      (modality): modality is RemoteModelCategory => isRemoteModelModality(modality),
    );
    await Promise.all(remoteModalities.map(modality => {
      const mediaServerId = modality === 'text'
        ? selection.activeServerId
        : selection.activeRemoteMediaServerIds[modality];
      const mediaServer = selection.servers.find(server => server.id === mediaServerId);
      const modelId = modality === 'text'
        ? selection.activeRemoteTextModelId
        : mediaServer?.selections?.[modality];
      const selectedRouteId = mediaServerId && modelId
        ? mobileRouteId({ source: 'remote', hostId: mediaServerId, modality, modelId })
        : null;
      return selectCanonicalModel(
        modality,
        selectionAfterRemoteServerRemoval({
          removedServerId: id,
          selectedRouteId,
          localFallbackRouteId: modality === 'text' ? localTextFallback : null,
        }),
      );
    }));
    remoteTextTransportRegistry.unregister(id);
    await this.removeApiKey(id);
    useRemoteServerStore.getState().removeServer(id);
    logger.log('[RemoteServerManager] Removed server:', id);
  }

  /** Get all servers (without API keys) */
  getServers(): RemoteServer[] {
    return useRemoteServerStore.getState().servers;
  }

  /** Get a server by ID */
  getServer(id: string): RemoteServer | null {
    return useRemoteServerStore.getState().getServerById(id);
  }

  /** Get server with API key (for provider) */
  async getServerWithApiKey(
    id: string,
  ): Promise<(RemoteServer & { apiKey?: string }) | null> {
    const server = this.getServer(id);
    if (!server) return null;
    const apiKey = await this.getApiKey(id);
    return { ...server, apiKey: apiKey || undefined };
  }

  /**
   * Test server connection
   */
  async testConnection(
    id: string,
  ): Promise<{ success: boolean; error?: string; models?: RemoteModel[] }> {
    const store = useRemoteServerStore.getState();
    const apiKey = await this.getApiKey(id);
    return store.testConnection(id, apiKey || undefined);
  }

  /** Test connection to a server by endpoint (before adding) */
  async testConnectionByEndpoint(
    endpoint: string,
    apiKey?: string,
  ): Promise<ServerTestResult> {
    return useRemoteServerStore
      .getState()
      .testConnectionByEndpoint(endpoint, apiKey);
  }

  /**
   * Discover models from a server
   */
  async discoverModels(id: string): Promise<RemoteModel[]> {
    const store = useRemoteServerStore.getState();
    const server = store.getServerById(id);
    if (!server) throw new Error(`Server not found: ${id}`);

    const apiKey = await this.getApiKey(id);
    return store.discoverModels(id, apiKey || undefined);
  }

  /** Set the active remote text model */
  async setActiveRemoteTextModel(
    serverId: string,
    modelId: string,
  ): Promise<void> {
    return selectCanonicalModel('text', mobileRouteId({
      source: 'remote', hostId: serverId, modality: 'text', modelId,
    }));
  }

  /** Prepare transport and Desktop activation before the selection adapter commits. */
  async prepareRemoteTextModel(serverId: string, modelId: string): Promise<void> {
    return setActiveRemoteTextModelImpl(serverId, modelId);
  }

  /** Set the active remote vision/image model */
  async setActiveRemoteImageModel(
    serverId: string,
    modelId: string,
  ): Promise<void> {
    return selectCanonicalModel('image', mobileRouteId({
      source: 'remote', hostId: serverId, modality: 'image', modelId,
    }));
  }

  /** Select one remote model for image, transcription, or voice work. */
  async setActiveRemoteMediaModel(
    serverId: string,
    category: Exclude<RemoteModelCategory, 'text'>,
    modelId: string,
  ): Promise<void> {
    return selectCanonicalModel(category, mobileRouteId({
      source: 'remote', hostId: serverId, modality: category, modelId,
    }));
  }

  /** Prepare remote runtime state; canonical selection commits through LLMService afterward. */
  async prepareRemoteMediaModel(
    serverId: string,
    category: Exclude<RemoteModelCategory, 'text'>,
    modelId: string,
  ): Promise<void> {
    const store = useRemoteServerStore.getState();
    const server = store.getServerById(serverId);
    if (!server) throw new Error(`Server not found: ${serverId}`);
    const confirmedModels =
      server.modelManagement === 'offgrid-desktop-v1'
        ? await activateOffGridDesktopModel(
            {
              ...server,
              apiKey: (await this.getApiKey(serverId)) ?? undefined,
            },
            category,
            modelId,
          )
        : { ...server.selections, [category]: modelId };
    store.updateServer(serverId, {
      selections: confirmedModels,
    });
    if (category === 'image' && server.modelManagement !== 'offgrid-desktop-v1') {
      await setActiveRemoteImageModelImpl(serverId, modelId);
    }
    logger.log('[RemoteServerManager] Active remote media model set:', {
      serverId,
      category,
      modelId,
    });
  }

  clearActiveRemoteTextModel(): Promise<void> {
    return selectCanonicalModel('text', null);
  }

  clearActiveRemoteMediaModel(
    category: Exclude<RemoteModelCategory, 'text'>,
  ): Promise<void> {
    return selectCanonicalModel(category, null);
  }

  /**
   * Initialize providers for all stored servers.
   * Also re-discovers models for each server to repopulate discoveredModels.
   * Restores active remote model selection if persisted.
   */
  async initializeProviders(): Promise<void> {
    return initializeProvidersImpl(() => this.getServers());
  }

  /**
   * Scan the LAN and reconcile the result against saved servers. For each discovered endpoint that
   * matches a saved server on the same port but a new IP, update it in place and re-select the active
   * model. Returns the genuinely-new servers (not remaps) so a caller can surface them, plus the ids
   * of servers that moved. Does NOT gate on settings — the caller decides whether a scan is allowed.
   * This is the single owner of the "server moved to a new IP" reconciliation; UI callers delegate here.
   */
  async scanAndReconcile(): Promise<{
    moved: string[];
    found: DiscoveredServer[];
  }> {
    let discovered: DiscoveredServer[];
    try {
      discovered = await discoverLANServers();
    } catch (error) {
      logger.warn(
        '[RemoteServerManager] LAN scan failed:',
        (error as Error).message,
      );
      return { moved: [], found: [] };
    }
    if (discovered.length === 0) return { moved: [], found: [] };

    const store = useRemoteServerStore.getState();
    const existingServers = store.servers;
    const reconciliation = reconcileRemoteServerDiscovery(
      existingServers,
      discovered,
    );
    const moved: string[] = [];
    const found: DiscoveredServer[] = reconciliation.found.flatMap(candidate => {
      const original = discovered.find(server => server.endpoint === candidate.endpoint);
      return original ? [original] : [];
    });

    for (const move of reconciliation.moves) {
      const samePortServer = existingServers.find(server => server.id === move.serverId);
      const d = discovered.find(server => server.endpoint === move.endpoint);
      if (
        !samePortServer || !d ||
        !(await this.reconcileMovedServer(samePortServer, d))
      ) {
        if (d) found.push(d);
        continue;
      }
      moved.push(samePortServer.id);
    }

    return { moved, found };
  }

  private async reconcileMovedServer(
    server: RemoteServer,
    discovered: DiscoveredServer,
  ): Promise<boolean> {
    let apiKey: string | null;
    try {
      apiKey = await this.getApiKey(server.id);
    } catch {
      // An unavailable Keychain is not proof that this server has no credential.
      // Keep the discovery unclaimed until credential ownership can be confirmed.
      return false;
    }
    const hasStoredCredential = apiKey !== null;
    if (
      !canReconcileCredentialedEndpoint(
        discovered.endpoint,
        hasStoredCredential,
      )
    ) {
      return false;
    }
    await this.applyMovedServer(server, discovered.endpoint, discovered.name);
    return true;
  }

  /** Update a saved server that has moved to a new endpoint, and re-select it if it was active. */
  private async applyMovedServer(
    server: RemoteServer,
    endpoint: string,
    name: string,
  ): Promise<void> {
    logger.log(
      '[RemoteServerManager] Server moved to new IP, updating:',
      server.name,
      '->',
      endpoint,
    );
    await this.updateServer(server.id, { endpoint, name });
    try {
      await this.discoverModels(server.id);
    } catch {
      /* offline — models repopulate on next reach */
    }
    const store = useRemoteServerStore.getState();
    if (store.activeServerId === server.id && store.activeRemoteTextModelId) {
      try {
        await this.setActiveRemoteTextModel(
          server.id,
          store.activeRemoteTextModelId,
        );
      } catch {
        /* user can re-select from the picker */
      }
    }
  }

  /**
   * Recover the active remote connection after a network change. Cheap-first: if there is an active
   * server and it is still reachable at its known endpoint, do nothing. Only when it is unreachable
   * (or the user has enabled auto-discovery) do we scan the LAN to find where it moved and reconnect.
   * This keeps LAN scanning off unless the user is actually relying on a remote server, and makes the
   * "connected" state honest again after the peer's IP changes.
   */
  async recoverActiveConnection(): Promise<void> {
    const activeId = useRemoteServerStore.getState().activeServerId;
    const autoDiscover = shouldAutoDiscoverRemoteModels(
      useAppStore.getState().settings,
    );

    let activeHealthy = false;
    if (activeId) {
      const result = await this.testConnection(activeId).catch(() => ({
        success: false,
      }));
      activeHealthy = result.success;
      if (remoteRecoveryDecision({
        hasActiveServer: true,
        activeServerHealthy: activeHealthy,
        autoDiscover,
      }) === 'none') {
        logger.log(
          '[RemoteServerManager] Active server still reachable; no rescan needed',
        );
        return;
      }
      logger.log(
        result.success
          ? '[RemoteServerManager] Active server reachable; scanning because auto-discovery is enabled'
          : '[RemoteServerManager] Active server unreachable; rescanning to recover',
      );
    }

    const recovery = remoteRecoveryDecision({
      hasActiveServer: !!activeId,
      activeServerHealthy: activeHealthy,
      autoDiscover,
    });
    if (recovery === 'none') return;

    const { moved, found } = await this.scanAndReconcile();
    logger.log(
      `[RemoteServerManager] Recovery scan complete: ${moved.length} moved, ${found.length} new`,
    );
  }

  /**
   * Clear all servers
   */
  async clearAllServers(): Promise<void> {
    for (const server of this.getServers()) {
      await this.removeApiKey(server.id);
    }
    remoteTextTransportRegistry.clear();
    useRemoteServerStore.getState().clearAllServers();
  }

  // -------------------------------------------------------------------------
  // Keychain wrappers — public so tests + updateServer can call them
  // -------------------------------------------------------------------------

  async storeApiKey(serverId: string, apiKey: string): Promise<void> {
    return storeApiKeyImpl(serverId, apiKey);
  }

  async getApiKey(serverId: string): Promise<string | null> {
    return getApiKeyImpl(serverId);
  }

  private async removeApiKey(serverId: string): Promise<void> {
    return removeApiKeyImpl(serverId);
  }
}

/** Singleton instance */
export const remoteServerManager = new RemoteServerManager();
