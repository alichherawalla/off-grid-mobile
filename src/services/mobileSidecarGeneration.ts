import type { GenerationMessage, GenerationToolDefinition } from '@offgrid/models';
import type { RoutableTool } from './toolEmbeddingRouter';
import { mobileGenerationService, refreshMobileModelServices } from './modelServices';
import { EMBEDDING_MODEL_FILENAME } from './adapters/native/embeddingRuntimeAdapter';
import { mobileRouteId } from './modelServices/mobileRoute';

function embeddingRoute(modality: 'embedding' | 'tool_selection'): string {
  return mobileRouteId({
    source: 'local',
    hostId: 'llama.rn-sidecar',
    modality,
    modelId: EMBEDDING_MODEL_FILENAME,
  });
}

export async function executeMobileText(
  messages: GenerationMessage[],
  options: { maxTokens?: number; onText?: (text: string) => void } = {},
): Promise<string> {
  await refreshMobileModelServices();
  const result = await mobileGenerationService.generate({
    operation: { type: 'text' },
    messages,
    reasoning: { enabled: false },
    maxTokens: options.maxTokens,
    allowFallback: false,
  }, {
    chunk: chunk => { if (chunk.content) options.onText?.(chunk.content); },
  });
  return result.content;
}

export async function executeMobileEmbedding(inputs: string[]): Promise<number[][]> {
  await refreshMobileModelServices();
  const result = await mobileGenerationService.generate({
    operation: { type: 'embedding', inputs },
    routeId: embeddingRoute('embedding'),
    allowFallback: false,
  });
  if (result.output.type !== 'embedding') throw new TypeError('Embedding returned an invalid result');
  return result.output.vectors;
}

export async function executeMobileClassification(input: string): Promise<'image' | 'text'> {
  await refreshMobileModelServices();
  const result = await mobileGenerationService.generate({
    operation: { type: 'classifier', input, labels: ['image', 'text'] },
    allowFallback: false,
  });
  if (result.output.type !== 'classification') {
    throw new TypeError('Classification returned an invalid result');
  }
  return result.output.labels.reduce((best, candidate) =>
    candidate.score > best.score ? candidate : best).label === 'image' ? 'image' : 'text';
}

export async function executeMobileToolSelection(
  input: string,
  tools: RoutableTool[],
  limit: number,
): Promise<string[]> {
  await refreshMobileModelServices();
  const definitions: GenerationToolDefinition[] = tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    inputSchema: {},
  }));
  const result = await mobileGenerationService.generate({
    operation: { type: 'tool_selection', input, limit },
    routeId: embeddingRoute('tool_selection'),
    tools: definitions,
    toolChoice: 'none',
    allowFallback: false,
  });
  if (result.output.type !== 'tool_selection') {
    throw new TypeError('Tool selection returned an invalid result');
  }
  return result.output.toolCalls.map(call => call.name);
}
