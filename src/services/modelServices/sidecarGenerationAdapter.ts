import type {
  GenerationAdapter,
  GenerationChunk,
  GenerationRequest,
  LLMService,
} from '@offgrid/models';
import { nativeModelLifecycle } from '../adapters/native/modelLifecycle';
import { llmService } from '../llm';
import { embeddingService } from '../adapters/native/embeddingRuntimeAdapter';
import {
  selectToolsByEmbeddingRaw,
  type RoutableTool,
} from '../toolEmbeddingRouter';

function operation(request: GenerationRequest) {
  if (!request.operation) throw new TypeError('A sidecar operation is required');
  return request.operation;
}

async function* embeddingChunks(request: GenerationRequest): AsyncIterable<GenerationChunk> {
  const input = operation(request);
  if (input.type !== 'embedding') throw new TypeError('An embedding operation is required');
  yield {
    output: { type: 'embedding', vectors: await embeddingService.embedBatch(input.inputs) },
    finishReason: 'stop',
  };
}

async function* classifierChunks(request: GenerationRequest): AsyncIterable<GenerationChunk> {
  const input = operation(request);
  if (input.type !== 'classifier') throw new TypeError('A classifier operation is required');
  const prompt = `Is this message asking to create, generate, or draw an image? Reply only YES or NO.\n\nMessage: "${input.input.slice(0, 200)}"\n\nAnswer:`;
  let response = '';
  const abort = () => llmService.stopGeneration().catch(() => undefined);
  request.signal?.addEventListener('abort', abort, { once: true });
  try {
    await llmService.runNativeCompletion([
      { id: 'classify', role: 'user', content: prompt, timestamp: Date.now() },
    ], {
      disableThinking: true,
      onStream: data => { response += data.content ?? ''; },
    });
  } finally {
    request.signal?.removeEventListener('abort', abort);
  }
  const isImage = response.trim().toLowerCase().includes('yes');
  const labels = input.labels?.length ? input.labels : ['image', 'text'];
  yield {
    output: {
      type: 'classification',
      labels: labels.map(label => ({
        label,
        score: label === (isImage ? 'image' : 'text') ? 1 : 0,
      })),
    },
    finishReason: 'stop',
  };
}

async function* toolSelectionChunks(request: GenerationRequest): AsyncIterable<GenerationChunk> {
  const input = operation(request);
  if (input.type !== 'tool_selection') throw new TypeError('A tool-selection operation is required');
  const tools: RoutableTool[] = (request.tools ?? []).map(tool => ({
    function: { name: tool.name, description: tool.description },
  }));
  const names = await selectToolsByEmbeddingRaw(input.input, tools, input.limit);
  yield {
    output: {
      type: 'tool_selection',
      toolCalls: names.map((name, index) => ({
        id: `selected-tool-${index}`,
        name,
        arguments: '',
      })),
    },
    finishReason: 'stop',
  };
}

function adapter(id: string): GenerationAdapter {
  return {
    id,
    async load(model) {
      if (model.modality === 'embedding' || model.modality === 'tool_selection') {
        await embeddingService.load();
      } else if (model.modality === 'classifier') {
        await nativeModelLifecycle.loadTextModel(model.id, 120_000, false);
      }
    },
    async unload(model) {
      if (model.modality === 'embedding' || model.modality === 'tool_selection') {
        await embeddingService.unload();
      } else if (model.modality === 'classifier') {
        await nativeModelLifecycle.unloadTextModel(true);
      }
    },
    generate(model, request) {
      if (model.modality === 'embedding') return embeddingChunks(request);
      if (model.modality === 'classifier') return classifierChunks(request);
      if (model.modality === 'tool_selection') return toolSelectionChunks(request);
      throw new Error(`Unsupported Mobile sidecar modality: ${model.modality}`);
    },
  };
}

export function reconcileMobileSidecarAdapters(
  service: { registerAdapter(adapter: GenerationAdapter): () => void },
  models: LLMService,
  registrations: Map<string, () => void>,
): void {
  const modalities = new Set(['embedding', 'classifier', 'tool_selection']);
  const supported = new Set(models.list()
    .filter(model => modalities.has(model.modality))
    .map(model => model.adapterId));
  for (const [id, unregister] of registrations) {
    if (supported.has(id)) continue;
    unregister();
    registrations.delete(id);
  }
  for (const id of supported) {
    if (!registrations.has(id)) registrations.set(id, service.registerAdapter(adapter(id)));
  }
}
