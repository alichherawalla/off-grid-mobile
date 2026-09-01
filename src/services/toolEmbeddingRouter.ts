import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PersistentToolEmbeddingCache,
  rankToolVectorCandidates,
  toolEmbeddingText,
  type PersistedToolEmbedding,
} from '@offgrid/models';
import { embeddingService } from './adapters/native/embeddingRuntimeAdapter';
import logger from '../utils/logger';

export interface RoutableTool {
  function: { name: string; description?: string };
}

const CACHE_STORAGE_KEY = 'tool-embedding-cache-v1';

const cache = new PersistentToolEmbeddingCache({
  async read() {
    try {
      const raw = await AsyncStorage.getItem(CACHE_STORAGE_KEY);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as Record<
        string,
        PersistedToolEmbedding | { h?: string; v?: number[] }
      >;
      return Object.fromEntries(Object.entries(parsed).map(([name, entry]) => [
        name,
        'hash' in entry
          ? entry
          : { hash: entry.h ?? '', vector: entry.v ?? [] },
      ]));
    } catch (error) {
      logger.warn(`[ToolRouter] failed to hydrate embedding cache: ${String(error)}`);
      return undefined;
    }
  },
  async write(entries) {
    try {
      const legacy = Object.fromEntries(Object.entries(entries).map(([name, entry]) => [
        name,
        { h: entry.hash, v: entry.vector },
      ]));
      await AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(legacy));
    } catch (error) {
      logger.warn(`[ToolRouter] failed to persist embedding cache: ${String(error)}`);
    }
  },
});

/** Native embedding I/O only. Shared owns cache, ranking, validation, and migration policy. */
export async function selectToolsByEmbeddingRaw(
  query: string,
  tools: RoutableTool[],
  topK: number,
): Promise<string[]> {
  if (tools.length <= topK || !query.trim()) return tools.map(tool => tool.function.name);
  await embeddingService.load();
  const queryVector = await embeddingService.embed(query);
  const candidates = await Promise.all(tools.map(async (tool, index) => ({
    name: tool.function.name,
    description: tool.function.description,
    vector: await cache.get({
      name: tool.function.name,
      content: toolEmbeddingText({
        name: tool.function.name,
        description: tool.function.description,
      }),
      expectedDimension: queryVector.length,
      generate: text => embeddingService.embed(text),
    }),
    index,
  })));
  const selected = rankToolVectorCandidates(query, queryVector, candidates, topK);
  logger.log(`[ToolRouter] hybrid-routed ${tools.length} → ${selected.length}: [${selected.join(', ')}]`);
  return selected;
}

export const selectToolsByEmbedding = selectToolsByEmbeddingRaw;

export function _resetToolEmbeddingCache(): void {
  cache.clear();
}
