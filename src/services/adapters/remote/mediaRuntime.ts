import { remoteServerManager } from '../../remoteServerManager';
import type { RemoteMediaModelIds, RemoteServer } from '../../../types';
import { remoteMediaEndpoint, resolveRemoteRoute, remoteErrorBodyMessage, remoteImageRequest, parseRemoteImageResponse } from '@offgrid/models';
import { REMOTE_FETCH_REDIRECT_POLICY, remoteAuthorizationHeaders } from '@offgrid/models';


export interface RemoteImageResult {
  base64?: string;
  url?: string;
}

export interface RemoteVoiceResult {
  audio: ArrayBuffer;
  contentType: string;
}

export interface RemoteMediaRequestOptions {
  signal?: AbortSignal;
}

function endpoint(server: RemoteServer, path: string): string {
  const modality = path.endsWith('/images/generations')
    ? 'image'
    : path.endsWith('/audio/transcriptions')
      ? 'transcription'
      : 'voice';
  return remoteMediaEndpoint(server.endpoint, modality);
}

async function request<T>(
  input: {
    server: RemoteServer;
    path: string;
    /** A full URL chosen by shared policy; `path` names the modality for the endpoint rule. */
    url?: string;
    init: RequestInit;
    signal?: AbortSignal;
  },
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const { server, path, init, signal } = input;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const apiKey = await remoteServerManager.getApiKey(server.id);
    if (controller.signal.aborted) throw new Error('Remote request cancelled');
    const response = await fetch(input.url ?? endpoint(server, path), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init.headers,
        ...remoteAuthorizationHeaders(server.endpoint, apiKey),
      },
      signal: controller.signal,
      redirect: REMOTE_FETCH_REDIRECT_POLICY,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(remoteErrorBodyMessage(detail, response.status));
    }
    // Keep caller cancellation attached until the response body is
    // consumed. A successful header is not a completed image/audio transfer.
    return await consume(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Remote request cancelled');
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

function requiredModel(
  server: RemoteServer,
  kind: keyof RemoteMediaModelIds,
): string {
  const resolved = resolveRemoteRoute(
    server,
    kind,
    { status: 'unknown' },
    { strict: true },
  );
  if (!resolved.ready) throw new Error(`No remote ${kind} model is configured`);
  return resolved.route.modelId;
}

/** Thin OpenAI-compatible adapters. The server record owns every endpoint and model choice. */
export const remoteMediaRuntime = {
  async generateImage(
    server: RemoteServer,
    input: {
      prompt: string;
      model?: string;
      width?: number;
      height?: number;
      allowUnsafeMemoryOverride?: boolean;
    },
    options: RemoteMediaRequestOptions = {},
  ): Promise<RemoteImageResult> {
    const plan = remoteImageRequest({
      provider: server.provider,
      endpoint: server.endpoint,
      model: input.model ?? requiredModel(server, 'image'),
      prompt: input.prompt,
      width: input.width,
      height: input.height,
      allowUnsafeMemoryOverride: input.allowUnsafeMemoryOverride,
    });
    const artifact = await request({
      server,
      path: '/v1/images/generations',
      url: plan.url,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan.body),
      },
      signal: options.signal,
    }, async response => parseRemoteImageResponse(await response.json(), plan.transport));
    return { base64: artifact.base64, url: artifact.url };
  },

  async transcribe(
    server: RemoteServer,
    input: { fileUri: string; language?: string; model?: string },
    options: RemoteMediaRequestOptions = {},
  ): Promise<string> {
    const body = new FormData();
    body.append('model', input.model ?? requiredModel(server, 'transcription'));
    if (input.language) body.append('language', input.language);
    body.append('file', {
      uri: input.fileUri,
      name: 'recording.wav',
      type: 'audio/wav',
    } as unknown as Blob);
    const payload = await request({
      server,
      path: '/v1/audio/transcriptions',
      init: { method: 'POST', body },
      signal: options.signal,
    }, response => response.json() as Promise<{ text?: unknown }>);
    if (typeof payload.text !== 'string') {
      throw new TypeError('Remote server returned no transcript');
    }
    return payload.text.trim();
  },

  async synthesizeVoice(
    server: RemoteServer,
    input: { text: string; voice?: string; model?: string },
    options: RemoteMediaRequestOptions = {},
  ): Promise<RemoteVoiceResult> {
    return request({
      server,
      path: '/v1/audio/speech',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: input.model ?? requiredModel(server, 'voice'),
          input: input.text,
          voice: input.voice ?? 'alloy',
          response_format: 'mp3',
        }),
      },
      signal: options.signal,
    }, async response => ({
      audio: await response.arrayBuffer(),
      contentType: response.headers.get('content-type') ?? 'audio/mpeg',
    }));
  },
};
