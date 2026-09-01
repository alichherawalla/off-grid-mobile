/**
 * What retrieval is allowed to put in the prompt: how much, and whose.
 *
 * Two things decide whether a project chat works at all, and neither is about finding text:
 *
 *  - THE BUDGET. Retrieved chunks are prepended to the user's question, so a retrieval that ignores the
 *    context window pushes the question itself out of the window. The user watches the model answer a
 *    different question, or answer nothing, with no error anywhere.
 *  - THE SCOPE. A project's knowledge base must return that project's documents and no others. A leak here
 *    means one client's contract quoted into another client's chat - the worst failure this app can have,
 *    and completely silent.
 *
 * Everything runs for real over a REAL in-memory SQLite (harness/sqliteFake), so the documents are genuinely
 * indexed, chunked, embedded and selected back with the actual SQL - including the WHERE that scopes a search
 * to one project. Only two boundaries are stood in for: native document extraction, and the embedding model
 * (deterministic keyword vectors, so cosine ranking is real rather than canned).
 *
 * REPLACES the budget + project-scope + tool-error cases from `ragFlow.test.ts`, which are deleted. That file
 * mocked the DATABASE by matching SQL strings - `if (sql.includes('rag_chunks')) return { rows: [...] }` - and
 * then wrote `ragDatabase.ready = true` and `ragDatabase.db = mockDb` onto private fields. Retrieval "found"
 * whatever the matcher was told to hand back, so as batch9-kb-roundtrip's header already recorded, deleting
 * insertDocument or insertChunks from the source would not have failed a single one of those tests.
 */
import { installRealSqlite } from '../../harness/sqliteFake';

jest.mock('../../../src/services/mobileSidecarGeneration', () => ({
  executeMobileEmbedding: jest.fn(),
}));

/** A tiny deterministic embedding space, so ranking is the real cosine over real BLOBs. */
const KEYWORDS = ['zenland', 'capital', 'banana', 'ledger', 'quarterly'];
const toVec = (text: string): number[] => {
  const lower = String(text).toLowerCase();
  return KEYWORDS.map(k => (lower.includes(k) ? 1 : 0));
};

type RagModules = {
  ragService: {
    indexDocument: (p: Record<string, unknown>) => Promise<unknown>;
  };
  retrievalService: {
    searchWithBudget: (p: {
      projectId: string;
      query: string;
      contextLength: number;
      topK?: number;
    }) => Promise<{ chunks: Array<{ content: string }>; truncated: boolean }>;
  };
  executeToolCall: (
    call: Record<string, unknown>,
  ) => Promise<{ error?: unknown; content?: string }>;
};

/** Stand up a fresh real DB with the embedding + extraction boundaries faked, and index `docs`. */
async function withIndexedDocs(
  docs: Array<{ projectId: string; fileName: string; text: string }>,
): Promise<RagModules> {
  installRealSqlite();
  const { ragService } = require('../../../src/services/modelServices/bootstrap/ragBootstrap');
  const { retrievalService } = require('../../../src/services/modelServices/bootstrap/ragBootstrap');
  const { embeddingService } = require('../../../src/services/adapters/native/embeddingRuntimeAdapter');
  const {
    executeMobileEmbedding,
  } = require('../../../src/services/mobileSidecarGeneration');
  const { documentService } = require('../../../src/services/documentService');
  const { executeToolCall } = require('../../../src/services/tools/handlers');

  // The embedding MODEL is native; the vectors it returns are made deterministic so ranking is genuine.
  jest.spyOn(embeddingService, 'load').mockResolvedValue(undefined as never);
  (executeMobileEmbedding as jest.Mock).mockImplementation(
    async (inputs: string[]) => inputs.map(toVec),
  );

  const extract = jest.spyOn(documentService, 'processDocumentFromPath');
  for (const doc of docs) {
    extract.mockResolvedValueOnce({
      type: 'document',
      textContent: doc.text,
    } as never);
    await ragService.indexDocument({
      projectId: doc.projectId,
      filePath: `/docs/${doc.fileName}`,
      fileName: doc.fileName,
      fileSize: doc.text.length,
    });
  }

  return { ragService, retrievalService, executeToolCall } as RagModules;
}

describe('what retrieval puts in the prompt', () => {
  it('stops adding chunks once the context budget is spent, and says it truncated', async () => {
    // One document far larger than a small model's whole window, indexed for real.
    const huge = `Zenland ledger. ${'x'.repeat(4000)}`;
    const { retrievalService } = await withIndexedDocs([
      { projectId: 'p1', fileName: 'huge.txt', text: huge },
      { projectId: 'p1', fileName: 'small.txt', text: 'Zenland capital note.' },
    ]);

    const result = await retrievalService.searchWithBudget({
      projectId: 'p1',
      query: 'zenland ledger',
      contextLength: 512, // a small window - the budget is a fraction of this
    });

    // Truncated is the honest signal, and the chunks that DID come back have to fit. Returning everything
    // and letting the prompt builder overflow is how the user's own question gets pushed out of the window.
    expect(result.truncated).toBe(true);
    const returnedChars = result.chunks.reduce(
      (sum, c) => sum + c.content.length,
      0,
    );
    expect(returnedChars).toBeLessThan(huge.length);
  });

  it('returns everything when it all fits, and does not claim truncation', async () => {
    const { retrievalService } = await withIndexedDocs([
      {
        projectId: 'p1',
        fileName: 'a.txt',
        text: 'Zenland capital is Quixotic City.',
      },
      {
        projectId: 'p1',
        fileName: 'b.txt',
        text: 'The quarterly ledger balanced.',
      },
    ]);

    const result = await retrievalService.searchWithBudget({
      projectId: 'p1',
      query: 'zenland capital',
      contextLength: 8192,
    });

    // A false "truncated" is not harmless: the UI tells the user their knowledge base was too big to use,
    // so they go and delete documents that were fitting perfectly well.
    expect(result.truncated).toBe(false);
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it("never returns another project's documents", async () => {
    const { retrievalService } = await withIndexedDocs([
      {
        projectId: 'client-a',
        fileName: 'a.txt',
        text: 'Zenland capital is Quixotic City.',
      },
      {
        projectId: 'client-b',
        fileName: 'b.txt',
        text: 'Zenland capital is A SECRET FROM CLIENT B.',
      },
    ]);

    const result = await retrievalService.searchWithBudget({
      projectId: 'client-a',
      query: 'zenland capital',
      contextLength: 8192,
    });

    // The query matches BOTH documents on content - only the project scope keeps them apart. This is the
    // one failure in this file that is silent AND unrecoverable: the other client's text is already in the
    // prompt by the time anybody could notice.
    const joined = result.chunks.map(c => c.content).join(' ');
    expect(joined).toMatch(/Quixotic City/);
    expect(joined).not.toMatch(/SECRET FROM CLIENT B/);
  });
});

describe('the search_knowledge_base tool when there is nothing to give the model', () => {
  it('says it found nothing rather than failing', async () => {
    const { executeToolCall } = await withIndexedDocs([
      {
        projectId: 'p1',
        fileName: 'a.txt',
        text: 'Zenland capital is Quixotic City.',
      },
    ]);

    const result = await executeToolCall({
      id: 'tc1',
      name: 'search_knowledge_base',
      arguments: { query: 'quarterly banana ledger audit' },
      context: { projectId: 'p1' },
    });

    // An empty knowledge base is not an error. A tool error makes the model apologise for a broken tool
    // instead of simply answering from what it knows.
    expect(result.error).toBeFalsy();
  });

  it('tells the model there is no knowledge base when no project is open', async () => {
    const { executeToolCall } = await withIndexedDocs([
      {
        projectId: 'p1',
        fileName: 'a.txt',
        text: 'Zenland capital is Quixotic City.',
      },
    ]);

    const result = await executeToolCall({
      id: 'tc2',
      name: 'search_knowledge_base',
      arguments: { query: 'zenland capital' },
      context: {},
    });

    // Outside a project there is no KB to search, and the model is TOLD so in prose rather than handed a
    // tool error. That distinction is the right one and worth pinning: an error makes the model apologise
    // for a broken tool, while returning nothing would let it conclude the knowledge base is EMPTY and tell
    // the user their documents are missing. (The deleted mockist version asserted an error here - a shape
    // the real handler has never returned.)
    expect(result.error).toBeFalsy();
    expect(result.content).toMatch(/no project context/i);
  });
});
