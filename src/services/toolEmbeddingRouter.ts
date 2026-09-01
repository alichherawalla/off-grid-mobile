/**
 * Semantic tool routing via the on-device embedding model (the same ~25MB
 * all-MiniLM-L6-v2 we already ship for RAG — see adapters/native/embeddingRuntimeAdapter.ts).
 *
 * Why: with several MCP servers connected, dozens of large tool schemas would
 * otherwise all land in the prompt, and the model must prefill every one before it
 * can answer — which dominates time-to-first-token on-device. The main-model routing
 * pass (litertToolSelector) can't help on Android llama (it double-prefills the big
 * model, so it's disabled there). An embedding pass runs on the tiny MiniLM context
 * instead: embed the query + each tool's name/description, keep the top-K by cosine
 * similarity, and hand the main model only those. No extra big-model prefill, no new
 * model download.
 *
 * Tool-description embeddings are cached by content — a tool's schema is static, so
 * it's embedded once and reused across turns. The cache is persisted to disk so the
 * cold burst (~60 sequential CPU embeddings the first time MCP is used in a session)
 * happens once ever, not on the first message of every session — a real
 * time-to-first-token win for Pro/MCP users.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { embeddingService } from './adapters/native/embeddingRuntimeAdapter';
import logger from '../utils/logger';
import { rankToolVectorCandidates } from '@offgrid/models';

export interface RoutableTool {
  function: { name: string; description?: string };
}

const CACHE_STORAGE_KEY = 'tool-embedding-cache-v1';
interface CacheEntry { h: string; v: number[] }
/** name -> { hash of embed text, embedding }. Static per tool content. */
const toolEmbeddingCache = new Map<string, CacheEntry>();
let hydrated = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Stable, cheap content hash (djb2) so a changed description re-embeds. */
function hashText(text: string): string {
  /* eslint-disable no-bitwise -- djb2 hash is defined in terms of bit ops */
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
  /* eslint-enable no-bitwise */
}

/** Load the persisted cache once. Corrupt/missing storage just starts empty. */
async function hydrateCache(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    for (const [name, entry] of Object.entries(parsed)) {
      // Validate the vector CONTENTS, not just that it's an array: a corrupt/stale
      // entry with a non-numeric or NaN element would silently poison cosine similarity
      // (NaN scores) and destabilize tool routing. Drop anything that isn't a non-empty
      // vector of finite numbers.
      const validVector = Array.isArray(entry?.v) && entry.v.length > 0
        && entry.v.every(n => typeof n === 'number' && Number.isFinite(n));
      if (entry && typeof entry.h === 'string' && validVector) toolEmbeddingCache.set(name, entry);
    }
    logger.log(`[ToolRouter] hydrated ${toolEmbeddingCache.size} cached tool embeddings`);
  } catch (e) {
    logger.warn(`[ToolRouter] failed to hydrate embedding cache: ${String(e)}`);
  }
}

/** Persist the cache (debounced) so freshly-embedded tools survive a relaunch. */
function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const obj = Object.fromEntries(toolEmbeddingCache);
    AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(obj)).catch(e =>
      logger.warn(`[ToolRouter] failed to persist embedding cache: ${String(e)}`),
    );
  }, 1000);
}

function firstLine(desc: string | undefined, max = 200): string {
  const line = (desc ?? '').split('\n')[0].trim();
  return line.length > max ? line.slice(0, max) : line;
}

async function embedTool(tool: RoutableTool, expectedDim?: number): Promise<number[]> {
  const text = `${tool.function.name}: ${firstLine(tool.function.description)}`;
  const hash = hashText(text);
  const cached = toolEmbeddingCache.get(tool.function.name);
  // A cache hit needs BOTH the text hash AND the current embedding dimension to match.
  // After an embedding-model swap the dimension changes while the text is identical, so
  // the dimension check stops a stale-dim vector from poisoning cosineSimilarity with NaN.
  if (cached && cached.h === hash && (expectedDim == null || cached.v.length === expectedDim)) {
    return cached.v;
  }
  const vec = await embeddingService.embed(text);
  toolEmbeddingCache.set(tool.function.name, { h: hash, v: vec });
  schedulePersist();
  return vec;
}

/**
 * Return the names of the `topK` tools most semantically relevant to `query`.
 * Throws if embedding is unavailable so the caller can fall back to its own policy
 * (e.g. keep all tools) rather than silently dropping tools on a transient failure.
 */
export async function selectToolsByEmbeddingRaw(
  query: string,
  tools: RoutableTool[],
  topK: number,
): Promise<string[]> {
  if (tools.length <= topK || !query.trim()) {
    return tools.map(t => t.function.name);
  }
  await hydrateCache();
  await embeddingService.load();
  const queryVec = await embeddingService.embed(query);
  const candidates = await Promise.all(tools.map(async (tool, index) => ({
    name: tool.function.name,
    description: tool.function.description,
    vector: await embedTool(tool, queryVec.length),
    index,
  })));
  const selected = rankToolVectorCandidates(query, queryVec, candidates, topK);
  logger.log(`[ToolRouter] hybrid-routed ${tools.length} → ${selected.length}: [${selected.join(', ')}]`);
  return selected;
}

export async function selectToolsByEmbedding(
  query: string,
  tools: RoutableTool[],
  topK: number,
): Promise<string[]> {
  return selectToolsByEmbeddingRaw(query, tools, topK);
}

/** Test helper: clear the in-memory cache and re-arm hydration. */
export function _resetToolEmbeddingCache(): void {
  toolEmbeddingCache.clear();
  hydrated = false;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
}
