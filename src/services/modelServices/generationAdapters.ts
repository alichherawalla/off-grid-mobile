import type {
  GenerationAdapter,
  GenerationChunk,
  GenerationContentPart,
  GenerationMessage,
  GenerationRequest,
  LiveGenerationContext,
  LLMService,
  ModelResidencyPort,
  RuntimeModel,
} from '@offgrid/models';
import type { MediaAttachment, Message } from '../../types';
import { activeModelService } from '../activeModelService';
import { modelResidencyManager } from '../modelResidency';
import { providerRegistry } from '../providers';
import type { GenerationOptions, LLMProvider } from '../providers/types';
import { liteRTService } from '../litert';
import { mobileExecutionAdapterId } from './mobileRoute';

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
    };
  });
}

function providerOptions(request: GenerationRequest): GenerationOptions {
  return {
    temperature: request.sampling?.temperature,
    topP: request.sampling?.topP,
    topK: request.sampling?.topK,
    repeatPenalty: request.sampling?.repetitionPenalty,
    seed: request.sampling?.seed,
    stopSequences: request.sampling?.stop,
    maxTokens: request.maxTokens,
    enableThinking: request.requiredCapabilities?.thinking,
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

/** Convert the callback provider bridge into the shared async chunk boundary. */
async function* providerChunks(
  provider: LLMProvider,
  request: GenerationRequest,
): AsyncIterable<GenerationChunk> {
  const pending: PendingChunk[] = [];
  let wake: (() => void) | null = null;
  const push = (item: PendingChunk) => {
    pending.push(item);
    wake?.();
    wake = null;
  };
  const abort = () => provider.stopGeneration().catch(() => undefined);
  request.signal?.addEventListener('abort', abort, { once: true });
  const operation = provider.generate(
    mobileMessages(request.messages ?? []),
    providerOptions(request),
    {
      onToken: content => push({ value: { content } }),
      onReasoning: reasoning => push({ value: { reasoning } }),
      onComplete: result => {
        result.toolCalls?.forEach((call, index) => push({
          value: {
            toolCallDeltas: [{
              index,
              id: call.id,
              name: call.name,
              argumentsDelta: call.arguments,
            }],
          },
        }));
        push({ value: { finishReason: result.toolCalls?.length ? 'tool_calls' : 'stop' } });
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
  const tools = providerOptions(request).tools ?? [];
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
      imageUris: current?.attachments?.filter(item => item.type === 'image').map(item => item.uri),
      audioUris: current?.attachments?.filter(item => item.type === 'audio').map(item => item.uri),
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

function providerFor(model: RuntimeModel): LLMProvider {
  const providerId = model.source === 'remote' ? model.serverId : 'local';
  const provider = providerId ? providerRegistry.getProvider(providerId) : null;
  if (!provider) throw new Error(`Generation provider is unavailable: ${providerId ?? model.id}`);
  return provider;
}

function adapter(id: string): GenerationAdapter {
  return {
    id,
    async load(model) {
      if (model.source !== 'local') return;
      await activeModelService.loadTextModel(model.id);
      await providerFor(model).loadModel(model.id);
    },
    async unload(model) {
      if (model.source === 'local') await activeModelService.unloadTextModel(true);
    },
    async *generate(model, request, context) {
      if (model.source === 'local' && model.providerId === 'litert') {
        yield* liteRTChunks(request, context);
        return;
      }
      const provider = providerFor(model);
      if (model.source === 'remote' && provider.getLoadedModelId() !== model.id) {
        await provider.loadModel(model.id);
      }
      yield* providerChunks(provider, request);
    },
    classifyError(error) {
      const message = error instanceof Error ? error.message : String(error);
      return /memory|unavailable|not ready|timeout|network/i.test(message) ? 'retryable' : 'fatal';
    },
  };
}

/** ActiveModelService is the temporary native admission adapter; its policy is already shared. */
export const mobileGenerationResidency: ModelResidencyPort = {
  async ensureResident(_spec, handlers) {
    await handlers.load();
    return { fits: true, loaded: true };
  },
  markUsed() {
    modelResidencyManager.markUsed('text');
  },
};

export function reconcileMobileGenerationAdapters(
  service: { registerAdapter(adapter: GenerationAdapter): () => void },
  models: LLMService,
  registrations: Map<string, () => void>,
): void {
  const supported = new Set<string>([
    mobileExecutionAdapterId('local', 'llama', 'text'),
    mobileExecutionAdapterId('local', 'litert', 'text'),
    ...models.list('text')
      .filter(model => model.source === 'remote')
      .map(model => model.adapterId),
  ]);
  for (const [id, unregister] of registrations) {
    if (supported.has(id)) continue;
    unregister();
    registrations.delete(id);
  }
  for (const id of supported) {
    if (!registrations.has(id)) registrations.set(id, service.registerAdapter(adapter(id)));
  }
}
