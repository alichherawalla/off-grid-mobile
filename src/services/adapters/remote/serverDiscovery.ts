/**
 * Remote Server Helpers
 *
 * Pure async helpers for testing server connections and fetching model lists.
 * Extracted from remoteServerStore to keep the store file under the line limit.
 */

import {
  RemoteServer,
  RemoteModel,
  RemoteModelCatalog,
  ServerTestResult,
} from '../../../types';
import { testEndpoint, detectServerType } from '../../httpClient';
import logger from '../../../utils/logger';
import {
  fetchModelCapabilities,
} from './modelCapabilityDiscovery';
import { readOffGridDesktopModelState } from './offGridDesktopModels';
import {
  defaultRemoteSelections,
  detectRemoteToolCallingCapability,
  detectRemoteVisionCapability,
  displayRemoteModelName,
  projectRemoteTextModels,
  remoteDiscoveryEndpoints,
  remoteGatewayCatalog,
  remoteTextDiscoveryCandidates,
  REMOTE_DISCOVERY_TIMEOUT_MS,
  REMOTE_FETCH_REDIRECT_POLICY,
  remoteAuthorizationHeaders,
} from '@offgrid/models';

/** Timeout for model discovery fetches (non-critical, background operation) */
async function fetchForDiscovery(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    REMOTE_DISCOVERY_TIMEOUT_MS,
  );
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: REMOTE_FETCH_REDIRECT_POLICY,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchGatewayModelCatalog(
  server: RemoteServer,
): Promise<RemoteModelCatalog> {
  const endpoint = remoteDiscoveryEndpoints(server.endpoint)[0];
  const headers: Record<string, string> = { Accept: 'application/json' };
  Object.assign(
    headers,
    remoteAuthorizationHeaders(server.endpoint, server.apiKey),
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    REMOTE_DISCOVERY_TIMEOUT_MS,
  );
  try {
    const response = await fetch(endpoint.url, {
      headers,
      signal: controller.signal,
      redirect: REMOTE_FETCH_REDIRECT_POLICY,
    });
    if (!response.ok) return {};
    return remoteGatewayCatalog(await response.json());
  } catch {
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Human-readable label for a remote model. Some gateways report the model id as a
 * full file path (e.g. "/Users/admin/.offgrid/models/Qwen3.5-9B-Q4_K_M.gguf"),
 * which is unreadable in the picker. Show the basename without the extension while
 * keeping the raw id for loading.
 *
 * Only basename-strip when the id actually LOOKS like a filesystem path — an
 * absolute POSIX path ("/…"), a Windows path ("C:\…" / "C:/…"), or any string
 * that ends in a known model file extension. A namespace-style slug ("org/model",
 * "meta-llama/Llama-3.1-8B") is NOT a path: stripping its prefix would drop the
 * meaningful namespace and could collapse distinct models to the same label, so
 * it's returned unchanged.
 */
export const displayModelName = displayRemoteModelName;

export async function testServerConnection(
  server: RemoteServer,
): Promise<ServerTestResult> {
  try {
    const testResult = await testEndpoint(
      server.endpoint,
      10000,
      server.apiKey,
    );

    if (!testResult.success) {
      return {
        success: false,
        error: testResult.error,
        latency: testResult.latency,
      };
    }

    const desktopState = await readOffGridDesktopModelState(server);
    if (desktopState) {
      return {
        success: true,
        latency: testResult.latency,
        models: desktopState.textModels,
        selections: desktopState.active,
        catalog: desktopState.catalog,
        modelManagement: 'offgrid-desktop-v1',
        serverInfo: { name: 'off-grid-desktop' },
      };
    }
    if (server.modelManagement === 'offgrid-desktop-v1') {
      return {
        success: false,
        error: 'Desktop model state could not be read.',
        latency: testResult.latency,
      };
    }

    // Generic OpenAI-compatible servers use the Shared discovery plan.
    const [models, catalog] = await Promise.all([
      fetchModelsFromServer(server),
      fetchGatewayModelCatalog(server),
    ]);

    // Detect server type
    const serverType = await detectServerType(
      server.endpoint,
      5000,
      server.apiKey,
    );

    return {
      success: true,
      latency: testResult.latency,
      models,
      selections: defaultRemoteSelections(catalog),
      catalog,
      serverInfo: {
        name: serverType?.type,
        version: serverType?.version,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function testEndpointAndGetModels(
  endpoint: string,
  apiKey?: string,
): Promise<ServerTestResult> {
  try {
    const testResult = await testEndpoint(endpoint, 10000, apiKey);

    if (!testResult.success) {
      return {
        success: false,
        error: testResult.error,
        latency: testResult.latency,
      };
    }

    // Try to discover models with a temporary server config
    const tempServer: RemoteServer = {
      id: 'temp',
      name: 'temp',
      endpoint,
      provider: 'openai-compatible',
      createdAt: new Date().toISOString(),
      apiKey,
    };
    const desktopState = await readOffGridDesktopModelState(tempServer);
    if (desktopState) {
      return {
        success: true,
        latency: testResult.latency,
        models: desktopState.textModels,
        selections: desktopState.active,
        catalog: desktopState.catalog,
        modelManagement: 'offgrid-desktop-v1',
        serverInfo: { name: 'off-grid-desktop' },
      };
    }

    // Generic OpenAI-compatible servers use the Shared discovery plan.
    const [models, catalog] = await Promise.all([
      fetchModelsFromServer(tempServer),
      fetchGatewayModelCatalog(tempServer),
    ]);
    const serverType = await detectServerType(endpoint, 5000, apiKey);

    return {
      success: true,
      latency: testResult.latency,
      models,
      selections: defaultRemoteSelections(catalog),
      catalog,
      serverInfo: {
        name: serverType?.type,
        version: serverType?.version,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function fetchModelsFromServer(
  server: RemoteServer,
): Promise<RemoteModel[]> {
  // Headers for authentication
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  Object.assign(
    headers,
    remoteAuthorizationHeaders(server.endpoint, server.apiKey),
  );

  for (const endpoint of remoteDiscoveryEndpoints(server.endpoint)) {
    try {
      const response = await fetchForDiscovery(endpoint.url, { method: 'GET', headers });
      if (!response.ok) continue;
      const candidates = remoteTextDiscoveryCandidates(await response.json(), endpoint.protocol);
      if (!candidates.length) continue;
      const probedEntries = await Promise.all(candidates.map(async candidate => [
        candidate.id,
        await fetchModelCapabilities(endpoint.capabilityBaseUrl, candidate.id, {
          vision: detectRemoteVisionCapability,
          toolCalling: detectRemoteToolCallingCapability,
        }),
      ] as const));
      return projectRemoteTextModels({
        candidates,
        serverId: server.id,
        probed: new Map(probedEntries),
        now: new Date().toISOString(),
      });
    } catch (error) {
      logger.warn(`[RemoteServer] Failed to fetch from ${endpoint.url}:`, error);
    }
  }

  // No models found
  return [];
}
