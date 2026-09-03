import { DEFAULT_RAG_RETRIEVAL_LIMIT, estimateCharBudget, type IndexStage } from '@offgrid/rag';
import type { RagDocument, SearchResult } from '@offgrid/rag';
import { sharedRag as composedRag } from '../../composition/rag';
import { startMobileApplication } from '../../composition/application';
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

function stored(document: RagDocument | undefined): StoredDocument | undefined {
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

function snapshot(document: RagDocument): KnowledgeDocumentSnapshot {
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
  ensureReady = async (): Promise<void> => {
    await startMobileApplication();
  };

  async indexDocument(params: IndexDocumentParams): Promise<number> {
    const result = await composedRag().addDocument({
      projectId: params.projectId,
      path: params.filePath,
      fileName: params.fileName,
      size: params.fileSize,
      syncId: params.syncId,
      createdAt: params.createdAt,
      enabled: params.enabled,
    }, stage => params.onProgress?.({ stage, message: progressMessage[stage] }));
    const document = await composedRag().document(result.docId);
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
    await composedRag().setDocumentEnabled(docId, enabled);
    const document = await composedRag().document(docId);
    if (document) emitKnowledgeDocumentMutation({ kind: 'enabled', syncId: document.syncId, enabled });
  }

  async deleteDocument(docId: number): Promise<void> {
    await this.ensureReady();
    const document = await composedRag().document(docId);
    await composedRag().removeDocument(docId);
    if (document) emitKnowledgeDocumentMutation({ kind: 'deleted', syncId: document.syncId });
  }

  async searchProject(projectId: string, query: string, contextLength?: number) {
    await this.ensureReady();
    return legacySearch(await composedRag().search(projectId, query, { contextLength }));
  }

  async deleteProjectDocuments(projectId: string): Promise<void> {
    await this.ensureReady();
    const documents = await composedRag().removeProjectDocuments(projectId);
    for (const document of documents) {
      emitKnowledgeDocumentMutation({ kind: 'deleted', syncId: document.syncId });
    }
  }

  async getAllDocumentsForSync(): Promise<KnowledgeDocumentSnapshot[]> {
    await this.ensureReady();
    return composedRag().documentsForSync();
  }

  async indexSyncedDocument(document: KnowledgeDocumentSnapshot): Promise<number> {
    await this.ensureReady();
    return composedRag().indexSyncedDocument(document);
  }

  async setSyncedDocumentEnabled(syncId: string, enabled: boolean): Promise<void> {
    await this.ensureReady();
    await composedRag().setSyncedDocumentEnabled(syncId, enabled);
  }

  async deleteSyncedDocument(syncId: string): Promise<void> {
    await this.ensureReady();
    await composedRag().removeSyncedDocument(syncId);
  }
}

function legacySearch(result: SearchResult) {
  return {
    chunks: result.chunks.map(({ docId, ...chunk }) => ({ doc_id: docId, ...chunk })),
    truncated: result.truncated ?? false,
  };
}

export const ragService = new MobileRagService();

export const retrievalService = {
  search: async (projectId: string, query: string, topK = DEFAULT_RAG_RETRIEVAL_LIMIT) =>
    legacySearch(await composedRag().search(projectId, query, { topK })),
  searchWithBudget: async (params: { projectId: string; query: string; contextLength: number; topK?: number }) =>
    legacySearch(await composedRag().search(params.projectId, params.query, {
      topK: params.topK,
      contextLength: params.contextLength,
    })),
  formatForPrompt: (result: { chunks: RagSearchResult[]; truncated?: boolean }) => composedRag().formatSearchResult({
    query: '',
    chunks: result.chunks.map(({ doc_id, ...chunk }) => ({ docId: doc_id, ...chunk })),
  }),
  estimateCharBudget,
};

export type { StoredDocument as RagDocument, RagSearchResult };
