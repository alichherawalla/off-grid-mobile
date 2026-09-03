/** Mobile raw HTTP adapter for Shared remote capability discovery(). */

import {
  isGenerativeRemoteModel,
  type RemoteCapabilityProbeEvidence,
  type RemoteCapabilityProbeRequest,
  type RemoteModelCapabilityInfo,
} from '@offgrid/models';
import type { RemoteCapabilityDiscoveryApplicationService } from '@offgrid/models';
import logger from '../../../utils/logger';
import { remoteCapabilityDiscovery } from '../../composition/remote';

export type RemoteModelInfo = RemoteModelCapabilityInfo;

async function execute(
  request: RemoteCapabilityProbeRequest,
): Promise<RemoteCapabilityProbeEvidence> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: { ...request.headers },
      body: request.body,
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false };
    return request.response === 'text'
      ? { ok: true, text: await response.text() }
      : { ok: true, payload: await response.json() };
  } catch (error) {
    logger.warn(
      '[remote-capability] probe unavailable:',
      request.kind,
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Raw HTTP probe as the discovery port. */
export function mobileRemoteCapabilityPorts(): ConstructorParameters<typeof RemoteCapabilityDiscoveryApplicationService>[0] {
  return { execute };
}

const discovery = (): RemoteCapabilityDiscoveryApplicationService => remoteCapabilityDiscovery();

export function fetchRemoteModelInfo(
  endpoint: string,
  modelName: string,
): Promise<RemoteModelInfo> {
  return discovery().ollama(endpoint, modelName);
}

export function fetchLmStudioModelInfo(
  endpoint: string,
  modelId: string,
): Promise<RemoteModelInfo> {
  return discovery().lmStudio(endpoint, modelId);
}

export function fetchLlamaCppProps(
  endpoint: string,
): Promise<RemoteModelInfo | null> {
  return discovery().llamaCpp(endpoint);
}

export function fetchModelCapabilities(
  endpoint: string,
  modelId: string,
  nameBasedDetect: {
    vision: (id: string) => boolean;
    toolCalling: (id: string) => boolean;
  },
): Promise<RemoteModelInfo> {
  return discovery().discover({
    endpoint,
    modelId,
    fallbackVision: nameBasedDetect.vision(modelId),
    fallbackToolCalling: nameBasedDetect.toolCalling(modelId),
  });
}

export function isGenerativeModel(modelId: string): boolean {
  return isGenerativeRemoteModel(modelId);
}
