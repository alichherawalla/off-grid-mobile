import { ragDatabase } from '../adapters/rag/ragDatabaseAdapter';
import { chunkText } from '@offgrid/rag';
import { retrievalService } from './retrieval';
import { embeddingService } from '../adapters/native/embeddingRuntimeAdapter';
import { executeMobileEmbedding } from '../mobileSidecarGeneration';
import { documentService } from '../documentService';
import { writePastedNote } from '../adapters/rag/pastedNoteFileAdapter';
import {
  emitKnowledgeDocumentMutation,
  type KnowledgeDocumentSnapshot,
} from '../sync/knowledgeDocument';
import logger from '../../utils/logger';

export type { RagDocument, RagSearchResult } from '../adapters/rag/ragDatabaseAdapter';
export { retrievalService } from './retrieval';
interface IndexProgress {
  stage: 'extracting' | 'chunking' | 'indexing' | 'embedding' | 'done';
  message: string;
}

interface IndexDocumentParams {
  projectId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  syncId?: string;
  createdAt?: string;
  enabled?: boolean;
  origin?: 'local' | 'sync';
  onProgress?: (progress: IndexProgress) => void;
}

class RagService {
  async ensureReady(): Promise<void> {
    await ragDatabase.ensureReady();
  }

  async indexDocument(params: IndexDocumentParams): Promise<number> {
    const { projectId, filePath, fileName, fileSize, onProgress } = params;
    await this.ensureReady();

    // Prevent duplicate indexing of the same file
    const existing = ragDatabase.getDocumentsByProject(projectId);
    if (existing.some(d => d.path === filePath || d.name === fileName)) {
      throw new Error(
        `Document "${fileName}" is already in the knowledge base`,
      );
    }

    onProgress?.({
      stage: 'extracting',
      message: `Extracting text from ${fileName}...`,
    });
    // Extract full document text for RAG — don't truncate based on context window
    const RAG_MAX_CHARS = 500_000;
    const attachment = await documentService.processDocumentFromPath(
      filePath,
      fileName,
      RAG_MAX_CHARS,
    );
    if (!attachment?.textContent) {
      // A PDF that extracts to zero text is a scanned / image-only PDF (no text layer);
      // there is no on-device OCR, so name that cause instead of a generic failure (B-KB).
      const isPdf = fileName.toLowerCase().endsWith('.pdf');
      throw new Error(
        isPdf
          ? 'This looks like a scanned PDF with no text layer, so there was no text to extract (OCR is not available).'
          : 'Could not extract text from document',
      );
    }

    onProgress?.({ stage: 'chunking', message: 'Splitting into chunks...' });
    const chunks = chunkText(attachment.textContent);
    if (chunks.length === 0) {
      throw new Error('Document produced no indexable content');
    }

    onProgress?.({ stage: 'indexing', message: 'Indexing chunks...' });
    const docId = ragDatabase.insertDocument({
      projectId,
      name: fileName,
      path: attachment.uri || filePath,
      size: attachment.fileSize ?? fileSize,
      syncId: params.syncId,
      createdAt: params.createdAt,
      enabled: params.enabled,
    });
    const rowIds = ragDatabase.insertChunks(docId, chunks);

    onProgress?.({ stage: 'embedding', message: 'Generating embeddings...' });
    try {
      await embeddingService.load();
      const texts = chunks.map(c => c.content);
      const embeddings = await executeMobileEmbedding(texts);
      const entries = rowIds.map((rowId, i) => ({
        chunkRowid: rowId,
        docId,
        embedding: embeddings[i],
      }));
      ragDatabase.insertEmbeddingsBatch(entries);
      logger.log(
        `[RAG] Generated ${embeddings.length} embeddings for ${fileName}`,
      );
    } catch (err) {
      // A document with zero embeddings is invisible to semantic search and never
      // auto-backfilled — a permanent dead entry. Roll back the just-inserted doc + chunks
      // and surface the failure so the KB screen reports it, rather than swallowing it.
      logger.error(
        '[RAG] Embedding generation failed — rolling back index:',
        err,
      );
      ragDatabase.deleteDocument(docId);
      throw err instanceof Error
        ? err
        : new Error('Embedding generation failed');
    }

    onProgress?.({ stage: 'done', message: 'Done' });
    logger.log(`[RAG] Indexed ${fileName}: ${chunks.length} chunks`);
    const indexed = ragDatabase.getDocument(docId);
    if (indexed && params.origin !== 'sync') {
      emitKnowledgeDocumentMutation({
        kind: 'indexed',
        document: this.snapshot(indexed),
      });
    }
    return docId;
  }

  /**
   * Index text the user pasted in, as a document of its own.
   *
   * Written to a .txt first and then handed to indexDocument, so a note gets the same dedupe,
   * chunking, embedding, rollback-on-failure and sync emission as an imported file. Nothing here
   * knows it was pasted.
   */
  async indexPastedText(params: {
    projectId: string;
    title: string;
    text: string;
    onProgress?: (progress: IndexProgress) => void;
  }): Promise<number> {
    const trimmed = params.text.trim();
    if (!trimmed) throw new Error('There is no text to save.');
    const note = await writePastedNote(params.title, trimmed);
    return this.indexDocument({
      projectId: params.projectId,
      filePath: note.filePath,
      fileName: note.fileName,
      fileSize: note.fileSize,
      onProgress: params.onProgress,
    });
  }

  async backfillEmbeddings(projectId: string): Promise<number> {
    await this.ensureReady();
    const docs = ragDatabase.getDocumentsByProject(projectId);
    let total = 0;

    for (const doc of docs) {
      if (ragDatabase.hasEmbeddingsForDocument(doc.id)) continue;

      const chunks = ragDatabase.getChunksByDocument(doc.id);
      if (chunks.length === 0) continue;

      try {
        await embeddingService.load();
        const texts = chunks.map(c => c.content);
        const embeddings = await executeMobileEmbedding(texts);
        const entries = chunks.map((chunk, i) => ({
          chunkRowid: chunk.id,
          docId: doc.id,
          embedding: embeddings[i],
        }));
        ragDatabase.insertEmbeddingsBatch(entries);
        total += embeddings.length;
        logger.log(
          `[RAG] Backfilled ${embeddings.length} embeddings for ${doc.name}`,
        );
      } catch (err) {
        logger.error(`[RAG] Backfill failed for ${doc.name}:`, err);
      }
    }

    return total;
  }

  async deleteDocument(docId: number): Promise<void> {
    await this.ensureReady();
    const document = ragDatabase.getDocument(docId);
    ragDatabase.deleteDocument(docId);
    if (document) {
      emitKnowledgeDocumentMutation({
        kind: 'deleted',
        syncId: document.sync_id,
      });
    }
  }

  async getDocumentsByProject(projectId: string) {
    await this.ensureReady();
    return ragDatabase.getDocumentsByProject(projectId);
  }

  async toggleDocument(docId: number, enabled: boolean): Promise<void> {
    await this.ensureReady();
    ragDatabase.toggleEnabled(docId, enabled);
    const document = ragDatabase.getDocument(docId);
    if (document) {
      emitKnowledgeDocumentMutation({
        kind: 'enabled',
        syncId: document.sync_id,
        enabled,
      });
    }
  }

  async searchProject(
    projectId: string,
    query: string,
    contextLength?: number,
  ) {
    await this.ensureReady();
    if (contextLength) {
      return retrievalService.searchWithBudget({
        projectId,
        query,
        contextLength,
      });
    }
    return retrievalService.search(projectId, query);
  }

  async deleteProjectDocuments(projectId: string): Promise<void> {
    await this.ensureReady();
    const documents = ragDatabase.getDocumentsByProject(projectId);
    ragDatabase.deleteDocumentsByProject(projectId);
    for (const document of documents) {
      emitKnowledgeDocumentMutation({
        kind: 'deleted',
        syncId: document.sync_id,
      });
    }
  }

  async getAllDocumentsForSync(): Promise<KnowledgeDocumentSnapshot[]> {
    await this.ensureReady();
    return ragDatabase
      .getAllDocuments()
      .map(document => this.snapshot(document));
  }

  async indexSyncedDocument(
    document: KnowledgeDocumentSnapshot,
  ): Promise<number> {
    await this.ensureReady();
    const existing = ragDatabase.getDocumentBySyncId(document.syncId);
    if (existing) {
      if (existing.enabled !== (document.enabled ? 1 : 0)) {
        ragDatabase.toggleEnabled(existing.id, document.enabled);
      }
      return existing.id;
    }

    return this.indexDocument({
      projectId: document.projectId,
      filePath: document.filePath,
      fileName: document.name,
      fileSize: document.fileSize,
      syncId: document.syncId,
      createdAt: document.createdAt,
      enabled: document.enabled,
      origin: 'sync',
    });
  }

  async setSyncedDocumentEnabled(
    syncId: string,
    enabled: boolean,
  ): Promise<void> {
    await this.ensureReady();
    const document = ragDatabase.getDocumentBySyncId(syncId);
    if (document) ragDatabase.toggleEnabled(document.id, enabled);
  }

  async deleteSyncedDocument(syncId: string): Promise<void> {
    await this.ensureReady();
    const document = ragDatabase.getDocumentBySyncId(syncId);
    if (document) ragDatabase.deleteDocument(document.id);
  }

  private snapshot(
    document: import('../adapters/rag/ragDatabaseAdapter').RagDocument,
  ): KnowledgeDocumentSnapshot {
    return {
      syncId: document.sync_id,
      projectId: document.project_id,
      name: document.name,
      filePath: document.path,
      fileSize: document.size,
      createdAt: document.created_at,
      enabled: document.enabled === 1,
    };
  }
}

export const ragService = new RagService();
