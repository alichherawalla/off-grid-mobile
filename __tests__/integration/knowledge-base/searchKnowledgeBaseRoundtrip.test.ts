/**
 * GUARD (integration, REAL sqlite) — the search_knowledge_base tool round-trips against a real DB:
 * a user indexes a document, the model calls search_knowledge_base, and the tool returns the real
 * indexed content. Everything we own runs (indexDocument, chunking, ragDatabase SQL + BLOB storage,
 * retrieval cosine, the shared generation boundary, and the tool handler). Only the filesystem and
 * native embedding engine are device-boundary fakes. The DB is a REAL node:sqlite :memory: engine.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import { doMockRealSqlite } from '../../harness/sqliteFake';

describe('search_knowledge_base — real RAG round-trip (guard)', () => {
  it('returns the indexed document content when the model searches the knowledge base', async () => {
    const boundary = installNativeBoundary({ fs: true, llama: true });
    doMockRealSqlite();
     
    const { ragService } = require('../../../src/services/modelServices/bootstrap/ragBootstrap');
    const { executeToolCall } = require('../../../src/services/tools/handlers');
    const RNFS = require('react-native-fs');

    await RNFS.writeFile(
      `${boundary.fs!.DocumentDirectoryPath}/all-MiniLM-L6-v2-Q8_0.gguf`,
      'GGUF',
    );
    await RNFS.writeFile(
      '/docs/zenland.txt',
      'The capital of Zenland is Quixotic City. Bananas are a yellow fruit. Weather is mild.',
    );

    // User indexes the document into the project's knowledge base (real SQL + BLOB round-trip).
    await ragService.indexDocument({
      projectId: 'p1',
      filePath: '/docs/zenland.txt',
      fileName: 'zenland.txt',
      fileSize: 512,
    });

    // The model calls the tool during a project chat.
    const result = await executeToolCall({
      id: 'tc1', name: 'search_knowledge_base', arguments: { query: 'what is the capital of Zenland?' },
      context: { projectId: 'p1' },
    });

    // The tool returns the real indexed content the retrieval ranked highest — the KB actually works.
    expect(result.error).toBeFalsy();
    expect(result.content).toMatch(/Quixotic City/);
  });
});
