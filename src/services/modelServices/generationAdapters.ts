import {
  reasoningWireForGeneration,
  localTextRuntime,
  parseToolCallsFromText,
  type GenerationAdapter,
  type GenerationChunk,
  type GenerationContentPart,
  type GenerationMessage,
  type GenerationRequest,
  type LiveGenerationContext,
  type LLMService,
  type ModelResidencyLifecyclePort,
  type ReasoningWireFragment,
  type RuntimeModel,
} from '@offgrid/models';
import type { GenerationMeta, MediaAttachment, Message } from '../../types';
import { nativeModelLifecycle } from '../adapters/native/modelLifecycle';
import { modelResidencyManager } from './residencyBootstrap';
import { remoteTextTransportRegistry } from '../adapters/providers';
import type { GenerationOptions, TextStreamTransport } from '../adapters/providers/types';
import { liteRTService } from '../litert';
import { llmService } from '../llm';
import { modelInputAudioUris, modelInputImageUris } from '../modelMedia';
import { getToolExtensions } from '../tools/extensions';
import { mobileExecutionAdapterId } from './mobileRoute';
import { mobileImageGenerationAdapter } from './imageGenerationAdapter';

function textAndAttachments(
  content: GenerationMessage['content'],
): { text: string; attachments?: MediaAttachment[] } {
  if (typeof content === 'string') return { text: content };
  const text = content
    .filter((part): part is Extract<GenerationContentPart, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('\n');
  const attachments = content.flatMap((part, index): MediaAttachment[] => {
    if (part.type === 'text' || !part.uri) return [];
    return [{
      id: `shared-part-${index}`,
      type: part.type === 'file' ? 'document' : part.type,
      uri: part.uri,
      mimeType: part.mimeType,
      fileName: part.type === 'file' ? part.name : undefined,
    }];
  });
  return { text, attachments: attachments.length ? attachments : undefined };
}

function mobileMessages(messages: GenerationMessage[]): Message[] {
  return messages.map((message, index) => {
    const content = textAndAttachments(message.content);
    return {
      id: `shared-generation-${index}`,
      role: message.role,
      content: content.text,
      attachments: content.attachments,
      timestamp: 0,
      toolCallId: message.toolCallId,
      toolName: message.name,
      toolCalls: message.toolCalls,
      reasoningContent: message.reasoning,
    };
  });
}

function providerOptions(
  request: GenerationRequest,
  reasoningWire: ReasoningWireFragment,
): GenerationOptions {
  return {
    temperature: request.sampling?.temperature,
    topP: request.sampling?.topP,
    topK: request.sampling?.topK,
    repeatPenalty: request.sampling?.repetitionPenalty,
    seed: request.sampling?.seed,
    stopSequences: request.sampling?.stop,
    maxTokens: request.maxTokens,
    enableThinking: request.reasoning?.enabled,
    reasoningWire,
    tools: request.tools?.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.inputSchema,
      },
    })),
  };
}

type PendingChunk = { value?: GenerationChunk; error?: unknown; done?: boolean };

function resolvedToolCalls(
  content: string,
  nativeCalls: Array<{ id?: string; name: string; arguments: Record<string, unknown> }>,
) {
  const calls = nativeCalls.length
    ? [...nativeCalls]
    : parseToolCallsFromText(content).map((call, index) => ({
        id: `text-tool-${index}`,
        name: call.name,
        arguments: call.arguments,
      }));
  for (const extension of getToolExtensions()) {
    calls.push(...extension.parseToolCalls(content));
  }
  return calls;
}

function providerToolArguments(value: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof value !== 'string') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && !Array.isArray(parsed) && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/** Convert the callback provider bridge into the shared async chunk boundary. */
// The bridge keeps the selected transport, model, canonical request, and wire policy explicit.
// eslint-disable-next-line max-params
async function* providerChunks(
  transport: TextStreamTransport,
  modelId: string,
  request: GenerationRequest,
  reasoningWire: ReasoningWireFragment,
): AsyncIterable<GenerationChunk> {
  const pending: PendingChunk[] = [];
  let wake: (() => void) | null = null;
  const push = (item: PendingChunk) => {
    pending.push(item);
    wake?.();
    wake = null;
  };
  const abort = () => transport.stopGeneration().catch(() => undefined);
  request.signal?.addEventListener('abort', abort, { once: true });
  const operation = transport.generate(
    modelId,
    mobileMessages(request.messages ?? []),
    providerOptions(request, reasoningWire),
    {
      onToken: content => push({ value: { content } }),
      onReasoning: reasoning => push({ value: { reasoning } }),
      onComplete: result => {
        const nativeCalls = result.toolCalls?.map(call => ({
          id: call.id,
          name: call.name,
          arguments: providerToolArguments(call.arguments),
        })) ?? [];
        // Keep Mobile's compatibility parser at the provider boundary. Some local
        // templates emit valid tool markup as text instead of native tool-call deltas.
        const resolved = resolvedToolCalls(result.content, nativeCalls);
        resolved.forEach((call, index) => push({
          value: {
            toolCallDeltas: [{
              index,
              id: call.id ?? `provider-tool-${index}`,
              name: call.name,
              argumentsDelta: JSON.stringify(call.arguments),
            }],
          },
        }));
        push({
          value: {
            finishReason: resolved.length ? 'tool_calls' : 'stop',
          },
        });
        push({ done: true });
      },
      onError: error => push({ error }),
    },
  ).catch(error => push({ error }));

  try {
    for (;;) {
      if (!pending.length) await new Promise<void>(resolve => { wake = resolve; });
      const item = pending.shift();
      if (!item) continue;
      if (item.error) throw item.error;
      if (item.done) break;
      if (item.value) yield item.value;
    }
    await operation;
  } finally {
    request.signal?.removeEventListener('abort', abort);
  }
}

function toolResultText(content: Awaited<ReturnType<LiveGenerationContext['executeTool']>>['content']): string {
  if (typeof content === 'string') return content;
  return content.map(part => part.type === 'text' ? part.text : `[${part.type} result]`).join('\n');
}

async function* liteRTChunks(
  request: GenerationRequest,
  context: LiveGenerationContext,
  reasoningWire: ReasoningWireFragment,
): AsyncIterable<GenerationChunk> {
  const messages = mobileMessages(request.messages ?? []);
  const systemPrompt = messages.find(message => message.role === 'system')?.content ?? '';
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'user') continue;
    lastUserIndex = index;
    break;
  }
  const current = lastUserIndex >= 0 ? messages[lastUserIndex] : null;
  const history = messages
    .slice(0, Math.max(0, lastUserIndex))
    .filter((message): message is Message & { role: 'user' | 'assistant' } =>
      (message.role === 'user' || message.role === 'assistant') && !!message.content.trim())
    .map(message => ({ role: message.role, content: message.content }));
  const tools = providerOptions(request, reasoningWire).tools ?? [];
  await liteRTService.prepareConversation(
    request.identity?.conversationId ?? '__shared_generation__',
    systemPrompt,
    {
      samplerConfig: {
        temperature: request.sampling?.temperature,
        topK: request.sampling?.topK,
        topP: request.sampling?.topP,
      },
      tools,
      history,
    },
  );

  const pending: PendingChunk[] = [];
  let wake: (() => void) | null = null;
  let toolIndex = 0;
  const push = (item: PendingChunk) => {
    pending.push(item);
    const listener = wake;
    wake = null;
    listener?.();
  };
  const abort = () => liteRTService.stopGeneration().catch(() => undefined);
  request.signal?.addEventListener('abort', abort, { once: true });
  const operation = liteRTService.generateRaw(
    current?.content ?? '',
    {
      imageUris: modelInputImageUris(current?.attachments),
      audioUris: modelInputAudioUris(current?.attachments),
    },
    {
      onToken: content => push({ value: { content } }),
      onReasoning: reasoning => push({ value: { reasoning } }),
      onToolCall: async (name, args) => {
        const result = await context.executeTool({
          id: `${request.identity?.turnId ?? 'turn'}-native-${toolIndex++}`,
          name,
          arguments: JSON.stringify(args),
        });
        return toolResultText(result.content);
      },
    },
  ).then(() => {
    push({ value: { finishReason: 'stop' } });
    push({ done: true });
  }).catch(error => push({ error }));

  try {
    for (;;) {
      if (!pending.length) await new Promise<void>(resolve => { wake = resolve; });
      const item = pending.shift();
      if (!item) continue;
      if (item.error) throw item.error;
      if (item.done) break;
      if (item.value) yield item.value;
    }
    await operation;
  } finally {
    request.signal?.removeEventListener('abort', abort);
  }
}

function generationMeta(modelId: string): GenerationMeta {
  const { gpu, gpuBackend, gpuLayers } = llmService.getGpuInfo();
  const perf = llmService.getPerformanceStats();
  return {
    gpu,
    gpuBackend,
    gpuLayers,
    modelName: modelId,
    tokensPerSecond: perf.lastTokensPerSecond,
    decodeTokensPerSecond: perf.lastDecodeTokensPerSecond,
    timeToFirstToken: perf.lastTimeToFirstToken,
    tokenCount: perf.lastTokenCount,
  };
}

const llamaTextTransport: TextStreamTransport = {
  id: 'llama.rn',
  type: 'local',
  // This is the native transport boundary; Shared owns the four values passed to it.
  // eslint-disable-next-line max-params
  async generate(modelId, messages, options, callbacks): Promise<void> {
    if (!llmService.isModelLoaded()) throw new Error('No model loaded');
    if (options.tools?.length) {
      const result = await llmService.runNativeToolCompletion(messages, {
        tools: options.tools,
        reasoningWire: options.reasoningWire,
        onStream: data => {
          if (data.content) callbacks.onToken(data.content);
          if (data.reasoningContent) callbacks.onReasoning?.(data.reasoningContent);
        },
      });
      callbacks.onComplete({
        content: result.fullResponse,
        meta: generationMeta(modelId),
        toolCalls: result.toolCalls.map(call => ({
          id: call.id,
          name: call.name,
          arguments: typeof call.arguments === 'string'
            ? call.arguments
            : JSON.stringify(call.arguments),
        })),
      });
      return;
    }
    let content = '';
    let reasoning = '';
    await llmService.runNativeCompletion(messages, {
      reasoningWire: options.reasoningWire,
      onStream: data => {
        if (data.content) {
          content += data.content;
          callbacks.onToken(data.content);
        }
        if (data.reasoningContent) {
          reasoning += data.reasoningContent;
          callbacks.onReasoning?.(data.reasoningContent);
        }
      },
      onComplete: result => {
        callbacks.onComplete({
          content: result.content || content,
          reasoningContent: result.reasoningContent || reasoning || undefined,
          meta: generationMeta(modelId),
        });
      },
    });
  },
  stopGeneration: () => llmService.stopGeneration(),
  isReady: async () => llmService.isModelLoaded(),
};

function remoteTransportFor(model: RuntimeModel): TextStreamTransport {
  const transport = model.serverId ? remoteTextTransportRegistry.get(model.serverId) : undefined;
  if (!transport) throw new Error(`Generation transport is unavailable: ${model.serverId ?? model.id}`);
  return transport;
}

function adapter(id: string): GenerationAdapter {
  return {
    id,
    async load(model) {
      if (model.source !== 'local') return;
      await nativeModelLifecycle.loadTextModel(model.id);
    },
    async unload(model) {
      if (model.source === 'local') await nativeModelLifecycle.unloadTextModel(true);
    },
    async *generate(model, request, context) {
      // This is the single policy-to-wire translation for every Mobile text route.
      // Read llama.rn metadata after residency has loaded the native template, including on turn one.
      const localRuntime = localTextRuntime(model);
      const reasoningModel = localRuntime === 'llama-rn'
        ? { reasoning: llmService.getReasoningMetadata() }
        : model;
      const reasoningWire = reasoningWireForGeneration(request, reasoningModel);
      if (localRuntime === 'litert') {
        yield* liteRTChunks(request, context, reasoningWire);
        return;
      }
      if (localRuntime === 'llama-rn') {
        if (request.identity?.conversationId) {
          await llmService.prepareConversationBoundary(request.identity.conversationId);
        }
        yield* providerChunks(llamaTextTransport, model.id, request, reasoningWire);
        return;
      }
      yield* providerChunks(remoteTransportFor(model), model.id, request, reasoningWire);
    },
    classifyError(error) {
      const message = error instanceof Error ? error.message : String(error);
      return /memory|unavailable|not ready|timeout|network/i.test(message) ? 'retryable' : 'fatal';
    },
  };
}

/** Remove an ephemeral shared-generation prompt from either native text runtime. */
export async function clearMobileEphemeralTextState(): Promise<void> {
  liteRTService.invalidateConversation();
  await llmService.clearKVCache(true);
}

/** Stop the remote I/O boundary selected by Shared LLMService. */
export async function stopMobileRemoteTextTransport(serverId: string): Promise<void> {
  await remoteTextTransportRegistry.get(serverId)?.stopGeneration();
}

/** Shared generation receives the atomic residency lifecycle directly. */
export const mobileGenerationResidency: ModelResidencyLifecyclePort = modelResidencyManager;

export function reconcileMobileGenerationAdapters(
  service: { registerAdapter(adapter: GenerationAdapter): () => void },
  models: LLMService,
  registrations: Map<string, () => void>,
): void {
  const supported = new Map<string, RuntimeModel['modality']>([
    [mobileExecutionAdapterId('local', 'llama', 'text'), 'text'],
    [mobileExecutionAdapterId('local', 'litert', 'text'), 'text'],
    ...models.list()
      .filter(model =>
        (model.source === 'remote' && model.modality === 'text')
        || model.modality === 'image')
      .map(model => [model.adapterId, model.modality] as const),
  ]);
  for (const [id, unregister] of registrations) {
    if (supported.has(id)) continue;
    unregister();
    registrations.delete(id);
  }
  for (const [id, modality] of supported) {
    if (!registrations.has(id)) {
      registrations.set(
        id,
        service.registerAdapter(
          modality === 'image' ? mobileImageGenerationAdapter(id) : adapter(id),
        ),
      );
    }
  }
}
