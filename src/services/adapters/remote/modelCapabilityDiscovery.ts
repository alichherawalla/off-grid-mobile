
/**
 * Remote Model Capabilities
 *
 * Helpers for fetching model metadata (context length, vision support)
 * from Ollama and LM Studio servers.
 */

import logger from '../../../utils/logger';
import {
  isGenerativeRemoteModel,
  llamaCppCapabilityInfo,
  lmStudioCapabilityInfo,
  ollamaCapabilityInfo,
  remoteDeltaHasReasoning,
  resolveRemoteCapabilityEvidence,
  UNKNOWN_REMOTE_MODEL_CAPABILITIES,
  type RemoteModelCapabilityInfo,
  RemoteCapabilityCache,
  remoteCapabilityCacheKey,
} from '@offgrid/models';
export type RemoteModelInfo = RemoteModelCapabilityInfo;

/**
 * Fetches model capabilities for an Ollama model via POST /api/show.
 * Vision is detected by inspecting model_info keys for "vision" or "clip" —
 * Ollama populates these for multimodal models (e.g. clip.vision.block_count).
 * Falls back to contextLength=4096, supportsVision=false on any failure.
 */
export async function fetchRemoteModelInfo(
  endpoint: string,
  modelName: string,
): Promise<RemoteModelInfo> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${endpoint}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return UNKNOWN_REMOTE_MODEL_CAPABILITIES;

    const data = await response.json();
    return ollamaCapabilityInfo(data);
  } catch {
    // Timeout, network error, parse error
  }

  return UNKNOWN_REMOTE_MODEL_CAPABILITIES;
}

/**
 * Fetches model capabilities for an LM Studio server via GET /api/v1/models.
 * LM Studio's native endpoint exposes vision and tool-use capability per model.
 * Falls back to contextLength=4096, supportsVision=false on any failure.
 */
export async function fetchLmStudioModelInfo(
  endpoint: string,
  modelId: string,
): Promise<RemoteModelInfo> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${endpoint}/api/v1/models`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return UNKNOWN_REMOTE_MODEL_CAPABILITIES;

    const data = await response.json();
    const supportsThinking = await probeLmStudioThinking(endpoint, modelId);
    return lmStudioCapabilityInfo(data, modelId, supportsThinking)?.capability
      ?? UNKNOWN_REMOTE_MODEL_CAPABILITIES;
  } catch {
    // Timeout, network error, parse error
  }

  return UNKNOWN_REMOTE_MODEL_CAPABILITIES;
}

/**
 * Probe an LM Studio model for thinking support by sending a short streaming
 * request and checking if any SSE delta contains thinking content.
 *
 * LM Studio only honours `chat_template_kwargs` in streaming mode.
 * React Native's fetch doesn't support ReadableStream, so the full SSE
 * response is collected with `response.text()` instead.
 *
 * LM Studio may return thinking in different ways:
 * - Inline `<think>` tags in message.content
 * - Separate message.reasoning_content field
 */
async function probeLmStudioThinking(endpoint: string, modelId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    // Use streaming — LM Studio only honours chat_template_kwargs in streaming mode.
    // Read the full SSE response as text (RN fetch supports .text() but not ReadableStream).
    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Say hi' }],
        max_tokens: 2,
        stream: true,
        chat_template_kwargs: { enable_thinking: true },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!response.ok) return false;

    // response.text() collects the full SSE stream as a string
    const text = await response.text();

    // Check all SSE data lines for thinking indicators
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        const chunk = JSON.parse(line.slice(6));
        const delta = chunk?.choices?.[0]?.delta;
        if (delta && remoteDeltaHasReasoning(delta)) return true;
      } catch { /* skip malformed lines */ }
    }

    return false;
  } catch (error) {
    // Timeout, network error, model not loaded
    logger.warn('[probeLmStudioThinking] Failed to probe for thinking support:', error);
  }
  return false;
}

/**
 * Fetches model capabilities from a llama.cpp server via GET /props.
 *
 * The Off Grid AI Gateway is a llama.cpp server: its /v1/models list carries no
 * capability data, but /props reports the loaded model's real capabilities —
 * authoritative because they come from the actually-loaded projector/template,
 * not a name guess. A llama.cpp server serves ONE model, so /props maps to it.
 *
 *   modalities:        { vision, video, audio }        → vision / audio input
 *   chat_template_caps.supports_tools                   → tool calling
 *   chat_template_caps.supports_preserve_reasoning /    → thinking (reasoning)
 *   default_generation_settings.params.reasoning_format
 *
 * Non-llama.cpp servers (Ollama, LM Studio) 404 here — the caller then falls
 * through to their own arms. Returns null on any failure so the orchestrator
 * can distinguish "no llama.cpp data" from a real all-false result.
 */
export async function fetchLlamaCppProps(
  endpoint: string,
): Promise<RemoteModelInfo | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${endpoint}/props`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    return llamaCppCapabilityInfo(await response.json());
  } catch (error) {
    // A non-llama.cpp server simply has no /props (network error / abort) — that's
    // expected and silent. Only an unexpected shape after a 200 is worth flagging,
    // but that path returns null from parsePropsCapabilities, not throw. Log at warn
    // for parity with probeLmStudioThinking so a regressing server leaves a breadcrumb.
    logger.warn('[fetchLlamaCppProps] /props unavailable:', endpoint, error instanceof Error ? error.message : error);
  } finally {
    // Always clear — an early fetch rejection (e.g. DNS failure) otherwise leaves
    // the abort timer scheduled to fire after the function has returned.
    clearTimeout(timeoutId);
  }
  return null;
}

/**
 * In-flight /props requests keyed by endpoint. /props is server-wide (a llama.cpp
 * server serves one model), but capability detection runs once per model — so a
 * multi-entry /v1/models would fire N identical /props requests. Sharing the
 * in-flight promise collapses them to one call per server per discovery pass.
 * Cleared when the request settles so a later refresh re-probes the live server.
 */
const propsInFlight = new RemoteCapabilityCache<RemoteModelInfo | null>(32);

/** De-duplicated wrapper around fetchLlamaCppProps — one /props call per endpoint. */
export function fetchLlamaCppPropsCached(endpoint: string): Promise<RemoteModelInfo | null> {
  // Deliberate in-flight-promise cache: return the pending promise un-awaited so concurrent
  // callers share one fetch. Explicit presence check (not a truthiness/await smell) so the
  // Promise-in-conditional rule (S6544) doesn't misread it as a forgotten await.
  const key = remoteCapabilityCacheKey({
    provider: 'llama.cpp', endpoint, modelId: '*',
  });
  const pending = propsInFlight.getOrLoad(key, () => fetchLlamaCppProps(endpoint));
  return pending.finally(() => propsInFlight.invalidate(key));
}

/**
 * Fetch model capabilities by trying llama.cpp /props, Ollama, and LM Studio
 * APIs in parallel. Falls back to name-based detection when none returns real
 * data. Works regardless of the port the server runs on.
 *
 * Priority: llama.cpp /props first — it is authoritative (reads the loaded
 * model's real modalities/template, not a name guess), which is why the Off
 * Grid AI Gateway's vision/thinking/tools now resolve correctly instead of
 * false-negativing through name-based detection.
 */
export async function fetchModelCapabilities(
  endpoint: string,
  modelId: string,
  nameBasedDetect: { vision: (id: string) => boolean; toolCalling: (id: string) => boolean },
): Promise<RemoteModelInfo> {
  const [propsInfo, ollamaInfo, lmInfo] = await Promise.all([
    // Deduped per endpoint — /props is server-wide, so all models on one server
    // share a single request instead of firing one each.
    fetchLlamaCppPropsCached(endpoint),
    fetchRemoteModelInfo(endpoint, modelId),
    fetchLmStudioModelInfo(endpoint, modelId),
  ]);

  return resolveRemoteCapabilityEvidence({
    llamaCpp: propsInfo,
    ollama: ollamaInfo,
    lmStudio: lmInfo,
    fallbackVision: nameBasedDetect.vision(modelId),
    fallbackToolCalling: nameBasedDetect.toolCalling(modelId),
  });
}

/** Returns true for models that generate text/images — filters out embedding, reranker, etc. */
export function isGenerativeModel(modelId: string): boolean {
  return isGenerativeRemoteModel(modelId);
}
