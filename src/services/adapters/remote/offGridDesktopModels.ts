import type {
  RemoteMediaModelIds,
  RemoteModel,
  RemoteModelCatalog,
  RemoteModelCategory,
  RemoteServer,
} from '../../../types';
import {
  REMOTE_FETCH_REDIRECT_POLICY,
  projectOffGridDesktopModels,
  remoteAuthorizationHeaders,
} from '@offgrid/models';

const REQUEST_TIMEOUT_MS = 5_000;

export interface OffGridDesktopModelState {
  catalog: RemoteModelCatalog;
  active: RemoteMediaModelIds;
  textModels: RemoteModel[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function gatewayFetch(
  server: Pick<RemoteServer, 'endpoint' | 'apiKey'>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const endpoint = server.endpoint.replace(/\/+$/, '');
  try {
    return await fetch(`${endpoint}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...remoteAuthorizationHeaders(server.endpoint, server.apiKey),
        ...init.headers,
      },
      signal: controller.signal,
      redirect: REMOTE_FETCH_REDIRECT_POLICY,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Read raw Desktop inventory over HTTP, then delegate validation and projection to Shared. */
export async function readOffGridDesktopModelState(
  server: Pick<RemoteServer, 'id' | 'endpoint' | 'apiKey'>,
): Promise<OffGridDesktopModelState | null> {
  try {
    const [catalogResponse, installedResponse, activeResponse] = await Promise.all([
      gatewayFetch(server, '/v1/models/catalog'),
      gatewayFetch(server, '/v1/models/installed'),
      gatewayFetch(server, '/v1/models/active'),
    ]);
    if (!catalogResponse.ok || !installedResponse.ok || !activeResponse.ok) return null;
    const [catalog, installed, active] = await Promise.all([
      catalogResponse.json(), installedResponse.json(), activeResponse.json(),
    ]);
    const projected = projectOffGridDesktopModels({ catalog, installed, active });
    if (!projected) return null;
    const lastUpdated = new Date().toISOString();
    return {
      catalog: projected.catalog,
      active: projected.selections,
      textModels: projected.textModels.map(model => ({
        id: model.id,
        name: model.name,
        serverId: server.id,
        capabilities: {
          supportsVision: model.capabilities?.supportsVision === true,
          supportsToolCalling: model.capabilities?.supportsToolCalling === true,
          supportsThinking: model.capabilities?.supportsThinking === true,
        },
        lastUpdated,
      })),
    };
  } catch {
    return null;
  }
}

/** Activate one installed Desktop model, then confirm Desktop reports that exact selection. */
export async function activateOffGridDesktopModel(
  server: RemoteServer,
  category: RemoteModelCategory,
  modelId: string,
): Promise<RemoteMediaModelIds> {
  const response = await gatewayFetch(server, '/v1/models/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: modelId, kind: category }),
  });
  const result = record(await response.json().catch(() => null));
  if (!response.ok || result?.success !== true) {
    throw new Error(typeof result?.error === 'string'
      ? result.error
      : 'Desktop could not activate this model.');
  }
  const refreshed = await readOffGridDesktopModelState(server);
  if (!refreshed || refreshed.active[category] !== modelId) {
    throw new Error('Desktop did not confirm the selected model.');
  }
  return refreshed.active;
}
