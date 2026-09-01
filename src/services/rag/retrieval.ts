import { ragDatabase, RagSearchResult } from './database';
import { embeddingService } from './embedding';
import { executeMobileEmbedding } from '../mobileSidecarGeneration';
import {
  estimateCharBudget,
  formatForPrompt,
  rankBySimilarity,
  selectWithinBudget,
} from '@offgrid/rag';
import logger from '../../utils/logger';

interface SearchResult {
  chunks: RagSearchResult[];
  truncated: boolean;
}

class RetrievalService {
  async search(
    projectId: string,
    query: string,
    topK: number = 5,
  ): Promise<SearchResult> {
    const chunks = await this.searchSemantic(projectId, query, topK);
    return { chunks, truncated: false };
  }

  private async searchSemantic(
    projectId: string,
    query: string,
    topK: number,
  ): Promise<RagSearchResult[]> {
    if (!query.trim()) return [];

    const stored = ragDatabase.getEmbeddingsByProject(projectId);
    if (stored.length === 0) {
      // Fallback: return first chunks if no embeddings exist yet
      logger.log(
        '[Retrieval] No embeddings found, returning first chunks as fallback',
      );
      return ragDatabase.getChunksByProject(projectId, topK);
    }

    if (!embeddingService.isLoaded()) {
      try {
        await embeddingService.load();
      } catch (err) {
        logger.error(
          '[Retrieval] Failed to load embedding model, falling back',
          err,
        );
        return ragDatabase.getChunksByProject(projectId, topK);
      }
    }

    let queryVec: number[];
    try {
      queryVec = (await executeMobileEmbedding([query]))[0];
    } catch (err) {
      logger.error('[Retrieval] Failed to embed query, falling back', err);
      return ragDatabase.getChunksByProject(projectId, topK);
    }

    const ranked = rankBySimilarity(
      queryVec,
      stored.map(entry => ({
        docId: entry.doc_id,
        name: entry.name,
        content: entry.content,
        position: entry.position,
        embedding: entry.embedding,
      })),
      topK,
    );
    return ranked.map(({ docId, ...chunk }) => ({ doc_id: docId, ...chunk }));
  }

  formatForPrompt(result: SearchResult): string {
    return formatForPrompt({
      chunks: result.chunks.map(({ doc_id, ...chunk }) => ({
        docId: doc_id,
        ...chunk,
      })),
    });
  }

  estimateCharBudget(contextLengthTokens: number): number {
    return estimateCharBudget(contextLengthTokens);
  }

  async searchWithBudget(params: {
    projectId: string;
    query: string;
    contextLength: number;
    topK?: number;
  }): Promise<SearchResult> {
    const result = await this.search(
      params.projectId,
      params.query,
      params.topK ?? 5,
    );
    const budget = this.estimateCharBudget(params.contextLength);

    const fittingChunks = selectWithinBudget(
      result.chunks.map(({ doc_id, ...chunk }) => ({
        docId: doc_id,
        ...chunk,
      })),
      budget,
    ).map(({ docId, ...chunk }) => ({ doc_id: docId, ...chunk }));

    return {
      chunks: fittingChunks,
      truncated: fittingChunks.length < result.chunks.length,
    };
  }
}

export const retrievalService = new RetrievalService();
