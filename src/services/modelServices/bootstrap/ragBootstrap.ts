import { DEFAULT_RAG_RETRIEVAL_LIMIT, estimateCharBudget, type IndexStage } from '@offgrid/rag';
import type { RagService as SharedRagService } from '@offgrid/rag';
import { sharedRag as composedRag } from '../../composition/rag';
import { writePastedNote } from '../../adapters/rag/pastedNoteFileAdapter';
import type {
  RagDocument as StoredDocument,
  RagSearchResult,
} from '../../adapters/rag/ragDatabaseAdapter';
import {
  emitKnowledgeDocumentMutation,
  type KnowledgeDocumentSnapshot,
} from '../../sync/knowledgeDocument';

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

const progressMessage: Record<IndexStage, string> = {
  extracting: 'Extracting text...',
  chunking: 'Splitting into chunks...',
  embedding: 'Generating embeddings...',
  indexing: 'Indexing chunks...',
  done: 'Done',
};

function stored(document: Awaited<ReturnType<SharedRagService['getDocument']>>): StoredDocument | undefined {
  if (!document) return undefined;
  return {
    id: document.id,
    sync_id: document.syncId,
    project_id: document.projectId,
    name: document.name,
    path: document.path,
    size: document.size,
    created_at: document.createdAt,
    enabled: document.enabled ? 1 : 0,
  };
}

function snapshot(document: NonNullable<Awaited<ReturnType<SharedRagService['getDocument']>>>): KnowledgeDocumentSnapshot {
  return {
    syncId: document.syncId,
    projectId: document.projectId,
    name: document.name,
    filePath: document.path,
    fileSize: document.size,
    createdAt: document.createdAt,
    enabled: document.enabled,
  };
}


class MobileRagService {
  ensureReady = () => composedRag().ensureReady();

  async indexDocument(params: IndexDocumentParams): Promise<number> {
    const result = await composedRag().indexDocument({
      projectId: params.projectId,
      path: params.filePath,
      fileName: params.fileName,
      size: params.fileSize,
      syncId: params.syncId,
      createdAt: params.createdAt,
      enabled: params.enabled,
    }, stage => params.onProgress?.({ stage, message: progressMessage[stage] }));
    const document = await composedRag().getDocument(result.docId);
    if (document && params.origin !== 'sync') {
      emitKnowledgeDocumentMutation({ kind: 'indexed', document: snapshot(document) });
    }
    return result.docId;
  }

  async indexPastedText(params: {
    projectId: string;
    title: string;
    text: string;
    onProgress?: (progress: IndexProgress) => void;
  }): Promise<number> {
    const text = params.text.trim();
    if (!text) throw new Error('There is no text to save.');
    const note = await writePastedNote(params.title, text);
    return this.indexDocument({
      projectId: params.projectId,
      filePath: note.filePath,
      fileName: note.fileName,
      fileSize: note.fileSize,
      onProgress: params.onProgress,
    });
  }

  backfillEmbeddings = (projectId: string) => composedRag().backfillEmbeddings(projectId);

  async getDocumentsByProject(projectId: string): Promise<StoredDocument[]> {
    await this.ensureReady();
    return (await composedRag().listDocuments(projectId)).map(document => stored(document)!);
  }

  async toggleDocument(docId: number, enabled: boolean): Promise<void> {
    await this.ensureReady();
    await composedRag().toggleDocument(docId, enabled);
    const document = await composedRag().getDocument(docId);
    if (document) emitKnowledgeDocumentMutation({ kind: 'enabled', syncId: document.syncId, enabled });
  }

  async deleteDocument(docId: number): Promise<void> {
    await this.ensureReady();
    const document = await composedRag().getDocument(docId);
    await composedRag().deleteDocument(docId);
    if (document) emitKnowledgeDocumentMutation({ kind: 'deleted', syncId: document.syncId });
  }

  async searchProject(projectId: string, query: string, contextLength?: number) {
    await this.ensureReady();
    return legacySearch(await composedRag().searchProject(projectId, query, { contextLength }));
  }

  async deleteProjectDocuments(projectId: string): Promise<void> {
    await this.ensureReady();
    const documents = await composedRag().listDocuments(projectId);
    await composedRag().deleteProjectDocuments(projectId);
    for (const document of documents) {
      emitKnowledgeDocumentMutation({ kind: 'deleted', syncId: document.syncId });
    }
  }

  async getAllDocumentsForSync(): Promise<KnowledgeDocumentSnapshot[]> {
    await this.ensureReady();
    return (await composedRag().listAllDocuments()).map(snapshot);
  }

  async indexSyncedDocument(document: KnowledgeDocumentSnapshot): Promise<number> {
    await this.ensureReady();
    const existing = await composedRag().getDocumentBySyncId(document.syncId);
    if (existing) {
      if (existing.enabled !== document.enabled) await composedRag().toggleDocument(existing.id, document.enabled);
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

  async setSyncedDocumentEnabled(syncId: string, enabled: boolean): Promise<void> {
    await this.ensureReady();
    const document = await composedRag().getDocumentBySyncId(syncId);
    if (document) await composedRag().toggleDocument(document.id, enabled);
  }

  async deleteSyncedDocument(syncId: string): Promise<void> {
    await this.ensureReady();
    const document = await composedRag().getDocumentBySyncId(syncId);
    if (document) await composedRag().deleteDocument(document.id);
  }
}

function legacySearch(result: Awaited<ReturnType<SharedRagService['searchProject']>>) {
  return {
    chunks: result.chunks.map(({ docId, ...chunk }) => ({ doc_id: docId, ...chunk })),
    truncated: result.truncated ?? false,
  };
}

export const ragService = new MobileRagService();

export const retrievalService = {
  search: async (projectId: string, query: string, topK = DEFAULT_RAG_RETRIEVAL_LIMIT) =>
    legacySearch(await composedRag().searchProject(projectId, query, { topK })),
  searchWithBudget: async (params: { projectId: string; query: string; contextLength: number; topK?: number }) =>
    legacySearch(await composedRag().searchProject(params.projectId, params.query, {
      topK: params.topK,
      contextLength: params.contextLength,
    })),
  formatForPrompt: (result: { chunks: RagSearchResult[]; truncated?: boolean }) => composedRag().formatForPrompt({
    query: '',
    chunks: result.chunks.map(({ doc_id, ...chunk }) => ({ docId: doc_id, ...chunk })),
  }),
  estimateCharBudget,
};

export type { StoredDocument as RagDocument, RagSearchResult };
