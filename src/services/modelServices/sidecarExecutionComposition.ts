import type {
  GenerationMessage,
  GenerationService,
  GenerationToolDefinition,
} from '@offgrid/models';
import { EMBEDDING_MODEL_FILENAME } from '../adapters/native/embeddingRuntimeAdapter';
import {
  registerMobileSidecarExecutionPort,
} from '../mobileSidecarGeneration';
import type { RoutableTool } from '../toolEmbeddingRouter';
import { mobileRouteId } from './mobileRoute';

function embeddingRoute(modality: 'embedding' | 'tool_selection'): string {
  return mobileRouteId({
    source: 'local',
    hostId: 'llama.rn-sidecar',
    modality,
    modelId: EMBEDDING_MODEL_FILENAME,
  });
}

export function composeMobileSidecarExecution(
  service: GenerationService,
  refresh: () => Promise<unknown>,
): () => void {
  return registerMobileSidecarExecutionPort({
    async text(messages: GenerationMessage[], options) {
      await refresh();
      const result = await service.generate({
        operation: { type: 'text' }, messages,
        reasoning: { enabled: false }, maxTokens: options.maxTokens,
        allowFallback: false,
      }, { chunk: chunk => { if (chunk.content) options.onText?.(chunk.content); } });
      return result.content;
    },
    async embedding(inputs) {
      await refresh();
      const result = await service.generate({
        operation: { type: 'embedding', inputs },
        routeId: embeddingRoute('embedding'), allowFallback: false,
      });
      if (result.output.type !== 'embedding') throw new TypeError('Embedding returned an invalid result');
      return result.output.vectors;
    },
    async classification(input, routeId) {
      await refresh();
      const result = await service.generate({
        operation: { type: 'classifier', input, labels: ['image', 'text'] },
        routeId, allowFallback: false,
      });
      if (result.output.type !== 'classification') throw new TypeError('Classification returned an invalid result');
      return result.output.labels.reduce((best, candidate) =>
        candidate.score > best.score ? candidate : best).label === 'image' ? 'image' : 'text';
    },
    async toolSelection(input, tools: RoutableTool[], limit) {
      await refresh();
      const definitions: GenerationToolDefinition[] = tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        inputSchema: {},
      }));
      const result = await service.generate({
        operation: { type: 'tool_selection', input, limit },
        routeId: embeddingRoute('tool_selection'), tools: definitions,
        toolChoice: 'none', allowFallback: false,
      });
      if (result.output.type !== 'tool_selection') throw new TypeError('Tool selection returned an invalid result');
      return result.output.toolCalls.map(call => call.name);
    },
  });
}
