/**
 * Remote Server Manager
 *
 * Manages remote LLM server connections, including:
 * - CRUD operations for server configurations
 * - Secure API key storage using React Native Keychain
 * - Provider creation and management
 */

import { RemoteServer, RemoteModel, ServerTestResult } from '../types';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { useAppStore } from '../stores/appStore';
import { OpenAICompatibleProvider } from './providers/openAICompatibleProvider';
import { providerRegistry } from './providers/registry';
import { discoverLANServers, DiscoveredServer } from './networkDiscovery';
import { shouldAutoDiscoverRemoteModels } from '../utils/remoteAutoDiscovery';
import logger from '../utils/logger';
import {
  storeApiKeyImpl,
  getApiKeyImpl,
  removeApiKeyImpl,
  createProviderForServerImpl,
  setActiveRemoteTextModelImpl,
  setActiveRemoteImageModelImpl,
  initializeProvidersImpl,
} from './remoteServerManagerUtils';
import {
  canReconcileCredentialedEndpoint,
  remoteAuthorizationHeaders,
} from './remoteTransportPolicy';

/** Normalize an endpoint for identity comparison (lowercase, no trailing slashes). */
const trimSlash = (url: string): string => {
  let s = url.toLowerCase();
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
};

/** Extract the port from an endpoint, or null if it cannot be parsed. */
const portOf = (endpoint: string): string | null => {
  try {
    return new URL(endpoint).port;
  } catch {
    return null;
  }
};

function uniqueSamePortServer(
  discovered: DiscoveredServer,
  missingExisting: RemoteServer[],
  unmatchedDiscovered: DiscoveredServer[],
): RemoteServer | null {
  const port = portOf(discovered.endpoint);
  if (!port) return null;
  const existingOnPort = missingExisting.filter(
    server => portOf(server.endpoint) === port,
  );
  const discoveredOnPort = unmatchedDiscovered.filter(
    server => portOf(server.endpoint) === port,
  );
  return existingOnPort.length === 1 && discoveredOnPort.length === 1
    ? existingOnPort[0]
    : null;
}

class RemoteServerManager {
  /**
   * Add a new remote server
   */
  async addServer(
    config: Omit<RemoteServer, 'id' | 'createdAt'> & { apiKey?: string },
  ): Promise<RemoteServer> {
    const store = useRemoteServerStore.getState();

    // Deduplicate: if a server with the same endpoint already exists, return it
    const normalizedEndpoint = trimSlash(config.endpoint);
    const existing = store.servers.find(
      s => trimSlash(s.endpoint) === normalizedEndpoint,
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

    const provider = providerRegistry.getProvider(id);
    if (provider && 'updateConfig' in provider) {
      const apiKey = await this.getApiKey(id);
      const endpoint = updates.endpoint || existingServer.endpoint;
      const authorization = remoteAuthorizationHeaders(endpoint, apiKey);
      (provider as OpenAICompatibleProvider).updateConfig({
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
    providerRegistry.unregisterProvider(id);
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
    return store.testConnection(id);
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

    return store.discoverModels(id);
  }

  /**
   * Set the active server (null for local)
   */
  setActiveServer(id: string | null): void {
    useRemoteServerStore.getState().setActiveServerId(id);
    providerRegistry.setActiveProvider(id ?? 'local');
    logger.log('[RemoteServerManager] Active server set to:', id || 'local');
  }

  /** Set the active remote text model */
  async setActiveRemoteTextModel(
    serverId: string,
    modelId: string,
  ): Promise<void> {
    return setActiveRemoteTextModelImpl(serverId, modelId);
  }

  /** Set the active remote vision/image model */
  async setActiveRemoteImageModel(
    serverId: string,
    modelId: string,
  ): Promise<void> {
    return setActiveRemoteImageModelImpl(serverId, modelId);
  }

  /**
   * Clear active remote model (switch back to local)
   */
  clearActiveRemoteModel(): void {
    const store = useRemoteServerStore.getState();
    store.setActiveServerId(null);
    store.setActiveRemoteTextModelId(null);
    store.setActiveRemoteImageModelId(null);
    providerRegistry.setActiveProvider('local');
    logger.log('[RemoteServerManager] Cleared active remote model');
  }

  /** Get the active server */
  getActiveServer(): RemoteServer | null {
    return useRemoteServerStore.getState().getActiveServer();
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
    const existingEndpoints = new Set(
      existingServers.map(s => trimSlash(s.endpoint)),
    );
    const discoveredEndpoints = new Set(
      discovered.map(server => trimSlash(server.endpoint)),
    );
    const unmatchedDiscovered = discovered.filter(
      server => !existingEndpoints.has(trimSlash(server.endpoint)),
    );
    const missingExisting = existingServers.filter(
      server => !discoveredEndpoints.has(trimSlash(server.endpoint)),
    );
    const moved: string[] = [];
    const found: DiscoveredServer[] = [];

    for (const d of unmatchedDiscovered) {
      const samePortServer = uniqueSamePortServer(
        d,
        missingExisting,
        unmatchedDiscovered,
      );
      if (
        !samePortServer ||
        !(await this.reconcileMovedServer(samePortServer, d))
      ) {
        found.push(d);
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

    if (activeId) {
      const result = await this.testConnection(activeId).catch(() => ({
        success: false,
      }));
      if (result.success && !autoDiscover) {
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

    const allowScan = autoDiscover || !!activeId;
    if (!allowScan) return;

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
    providerRegistry.clear();
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
