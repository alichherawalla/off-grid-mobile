import RNFS from 'react-native-fs';
import type { GeneratedImage } from '../types';
import { generateId } from '../utils/generateId';
import logger from '../utils/logger';

/**
 * Remote image generation: offload a diffusion run to an OpenAI-compatible
 * server (the Off Grid AI Desktop gateway serves POST /v1/images/generations)
 * and land the result as a local file, so everything above this engine - the
 * progress card, chat attach, gallery record, mesh publication - keeps working
 * exactly as it does for on-device generation.
 *
 * The request opts into the gateway's async mode: a 202 + poll_url comes back
 * immediately and the phone polls for phase/step. Because the finished result
 * is held server-side at the poll URL, a dropped connection mid-run costs
 * nothing - polling resumes and still finds the image.
 */

interface RemoteImageRequest {
  /** Server base endpoint, e.g. http://192.168.1.50:7878 */
  endpoint: string;
  /** Optional bearer (the per-device token when the server is a paired Mac). */
  apiKey?: string;
  /** Model id on the server. */
  model: string;
  prompt: string;
  negativePrompt?: string;
  steps: number;
  guidanceScale: number;
  seed?: number;
  width: number;
  height: number;
}

interface RemoteImageProgress {
  stage?: string;
  step?: number;
  total?: number;
}

const POLL_INTERVAL_MS = 1000;
/** A desktop diffusion run is O(minutes); past this the job is presumed lost. */
const OVERALL_DEADLINE_MS = 10 * 60_000;
/** Transient poll failures tolerated before giving up (Wi-Fi blips). */
const MAX_POLL_FAILURES = 30;
const REQUEST_TIMEOUT_MS = 15_000;

const OUTPUT_DIR = `${RNFS.DocumentDirectoryPath}/generated-images`;

function baseUrl(endpoint: string): string {
  let url = endpoint;
  while (url.endsWith('/')) url = url.slice(0, -1);
  return url;
}

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: Record<string, any> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let body: Record<string, any> = {};
    try {
      body = await response.json();
    } catch {
      /* non-JSON error body - status carries the meaning */
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

/** Map an HTTP failure to the message the failure card shows. */
function requestError(status: number, body: Record<string, any>): Error {
  const serverMessage = body?.error?.message;
  if (status === 429) {
    return new Error(
      serverMessage || 'The server is generating another image - try again in a moment.',
    );
  }
  if (status === 401) {
    return new Error('The server rejected this device. Re-pair it and try again.');
  }
  if (status === 501) {
    return new Error(serverMessage || 'The server has no image model installed.');
  }
  return new Error(serverMessage || `Image request failed (HTTP ${status}).`);
}

class RemoteImageGeneratorService {
  private cancelled = false;

  /** Stop polling. The server finishes its run either way; if it is a paired
   *  Mac the image still syncs over when done. */
  async cancelGeneration(): Promise<boolean> {
    this.cancelled = true;
    return true;
  }

  async generateImage(
    request: RemoteImageRequest,
    onProgress?: (progress: RemoteImageProgress) => void,
  ): Promise<GeneratedImage> {
    this.cancelled = false;
    const base = baseUrl(request.endpoint);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (request.apiKey) headers.Authorization = `Bearer ${request.apiKey}`;

    const submit = await fetchJson(`${base}/v1/images/generations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: request.prompt,
        negative_prompt: request.negativePrompt || undefined,
        model: request.model,
        width: request.width,
        height: request.height,
        steps: request.steps,
        cfg_scale: request.guidanceScale,
        seed: request.seed,
        response_format: 'b64_json',
        async: true,
      }),
    });
    if (submit.status !== 202) throw requestError(submit.status, submit.body);
    const pollPath = String(submit.body.poll_url || '');
    if (!pollPath) throw new Error('The server accepted the job but returned no poll URL.');
    logger.log('[RemoteImage] job accepted:', submit.body.request_id);

    const result = await this.poll(`${base}${pollPath}`, headers, onProgress);
    return this.writeResult(request, result);
  }

  private async poll(
    pollUrl: string,
    headers: Record<string, string>,
    onProgress?: (progress: RemoteImageProgress) => void,
  ): Promise<Record<string, any>> {
    const deadline = Date.now() + OVERALL_DEADLINE_MS;
    let failures = 0;
    for (;;) {
      if (this.cancelled) throw new Error('cancelled');
      if (Date.now() > deadline) throw new Error('The server took too long to respond.');
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      if (this.cancelled) throw new Error('cancelled');
      let status = 0;
      let body: Record<string, any> = {};
      try {
        ({ status, body } = await fetchJson(pollUrl, { method: 'GET', headers }));
        failures = 0;
      } catch (error) {
        // A Wi-Fi blip must not lose a job the server is still running.
        failures += 1;
        if (failures > MAX_POLL_FAILURES) throw error;
        continue;
      }
      if (status === 404) throw new Error('The server no longer knows this job.');
      if (status >= 400) throw requestError(status, body);
      if (body.status === 'failed') {
        throw new Error(body?.error?.message || 'The server failed to generate the image.');
      }
      if (body.status === 'completed') return body.result || {};
      if (body.progress && onProgress) onProgress(body.progress as RemoteImageProgress);
    }
  }

  private async writeResult(
    request: RemoteImageRequest,
    result: Record<string, any>,
  ): Promise<GeneratedImage> {
    const datum = Array.isArray(result.data) ? result.data[0] : null;
    const b64 = datum?.b64_json;
    if (typeof b64 !== 'string' || b64.length === 0) {
      throw new Error('The server returned no image data.');
    }
    await RNFS.mkdir(OUTPUT_DIR);
    // The mesh identity when the server minted one - using it as the local id
    // means the synced copy arriving from a paired Mac is the SAME image, not a
    // duplicate gallery entry.
    const id = typeof datum.sync_id === 'string' && datum.sync_id ? datum.sync_id : generateId();
    const imagePath = `${OUTPUT_DIR}/img-${id}.png`;
    await RNFS.writeFile(imagePath, b64, 'base64');
    logger.log('[RemoteImage] saved:', imagePath);
    return {
      id,
      prompt: request.prompt,
      negativePrompt: request.negativePrompt,
      imagePath,
      width: request.width,
      height: request.height,
      steps: request.steps,
      seed: typeof datum.seed === 'number' ? datum.seed : request.seed ?? 0,
      modelId: typeof datum.model === 'string' ? datum.model : request.model,
      createdAt: new Date().toISOString(),
    };
  }
}

export const remoteImageGeneratorService = new RemoteImageGeneratorService();
