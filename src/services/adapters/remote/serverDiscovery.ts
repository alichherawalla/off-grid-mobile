/** Mobile transport adapter for Shared remote-provider discovery. */

import type { RemoteModel, RemoteServer, ServerTestResult } from '../../../types';
import { fetchModelCapabilities } from './modelCapabilityDiscovery';
import { readOffGridDesktopModelEvidence } from './offGridDesktopModels';
import {
  REMOTE_FETCH_REDIRECT_POLICY,
  RemoteProviderDiscoveryApplicationService,
  detectRemoteToolCallingCapability,
  detectRemoteVisionCapability,
  displayRemoteModelName,
  projectRemoteTextModels,
  remoteAuthorizationHeaders,
  type RemoteProviderProbe,
  type RemoteProviderProbeEvidence,
  type RemoteTextDiscoveryCandidate,
} from '@offgrid/models';

export const displayModelName = displayRemoteModelName;

/** Typed adapter failure kept distinct from a successful empty remote catalog. */
export class RemoteModelDiscoveryError extends Error {
  readonly kind = 'remote-model-discovery' as const;

  constructor(message: string) {
    super(message);
    this.name = 'RemoteModelDiscoveryError';
  }
}

async function probeRemoteProvider(
  request: RemoteProviderProbe,
  authorizationHeaders: Readonly<Record<string, string>>,
): Promise<RemoteProviderProbeEvidence> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', ...authorizationHeaders },
      redirect: REMOTE_FETCH_REDIRECT_POLICY,
    });
    return {
      ok: response.ok,
      status: response.status,
      headers: {
        server:
          typeof response.headers?.get === 'function'
            ? response.headers.get('server') ?? ''
            : '',
      },
      payload: await response.json().catch(() => undefined),
      ...(!response.ok ? { error: `Server returned ${response.status}` } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function mapTextModels(input: {
  candidates: readonly RemoteTextDiscoveryCandidate[];
  capabilityBaseUrl: string;
  serverId: string;
}): Promise<RemoteModel[]> {
  const probedEntries = await Promise.all(input.candidates.map(async candidate => [
    candidate.id,
    await fetchModelCapabilities(input.capabilityBaseUrl, candidate.id, {
      vision: detectRemoteVisionCapability,
      toolCalling: detectRemoteToolCallingCapability,
    }),
  ] as const));
  return projectRemoteTextModels({
    candidates: input.candidates,
    serverId: input.serverId,
    probed: new Map(probedEntries),
    now: new Date().toISOString(),
  });
}

const remoteProviderDiscovery = new RemoteProviderDiscoveryApplicationService({
  probe: probeRemoteProvider,
  readDesktop: (input, timeoutMs) => readOffGridDesktopModelEvidence({
    endpoint: input.endpoint,
    apiKey: input.apiKey,
  }, timeoutMs),
  mapTextModels,
  authorizationHeaders: remoteAuthorizationHeaders,
  now: Date.now,
  timestamp: () => new Date().toISOString(),
});

async function discoverServer(server: RemoteServer): Promise<ServerTestResult> {
  const result = await remoteProviderDiscovery.discover({
    serverId: server.id,
    endpoint: server.endpoint,
    apiKey: server.apiKey,
    expectedModelManagement: server.modelManagement,
  });
  return {
    success: result.success,
    ...(result.error ? { error: result.error } : {}),
    latency: result.latency,
    models: result.models,
    selections: result.selections,
    catalog: result.catalog,
    modelManagement: result.modelManagement,
    serverInfo: result.serverInfo,
  };
}

export async function testServerConnection(
  server: RemoteServer,
): Promise<ServerTestResult> {
  try {
    return await discoverServer(server);
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
  return testServerConnection({
    id: 'temp',
    name: 'temp',
    endpoint,
    provider: 'openai-compatible',
    createdAt: new Date().toISOString(),
    apiKey,
  });
}

export async function fetchModelsFromServer(
  server: RemoteServer,
): Promise<RemoteModel[]> {
  const result = await discoverServer(server);
  if (!result.success) {
    throw new RemoteModelDiscoveryError(
      result.error ?? 'Remote server model discovery failed.',
    );
  }
  return result.models ?? [];
}
