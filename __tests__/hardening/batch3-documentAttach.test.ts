/**
 * BATCH 3 — Chat Attachments & Vision (hardening)
 * File 1: Document attachment validation & multi-attachment queueing.
 *
 * Drives the REAL documentService (the attach seam). The only mocked boundary is
 * react-native-fs (a native module) and pdfExtractor (a native module). All
 * validation / extension / size / decode logic runs for real — deleting the
 * implementation would fail these tests.
 *
 * On-device test-plan cases covered here (see the on-device test plan, Batch 3):
 *  - #2  supported .txt accepted            (COVERED-REAL in existing suite; asserted end-to-end here for the accept-set)
 *  - #12 unsupported binary (.docx) rejected with a visible error
 *  - #13 file > 5MB rejected with a visible error
 *  - #14 .md accepted
 *  - #15 .json accepted
 *  - #17 URL-encoded filename display-name decode  → BUG-FOUND (service returns it un-decoded)
 *  - #34/#35 multiple document attachments queue as distinct attachments
 *
 * The accepted-extension set explicitly includes .csv and code files (.py/.ts),
 * which the on-device plan's "supported types" line enumerates but the existing unit suite
 * does not exhaustively assert.
 */

import { defaultNativeFileSystemBoundary } from '../harness/nativeFileSystem';

jest.mock('react-native-fs', () => {
  const { defaultNativeFileSystemBoundary: boundary } = require('../harness/nativeFileSystem');
  return { __esModule: true, default: boundary.module, ...boundary.module };
});

jest.mock('../../src/services/pdfExtractor', () => ({
  pdfExtractor: { isAvailable: jest.fn(() => false), extractText: jest.fn() },
}));

import { documentService } from '../../src/services/documentService';

/** Put one readable file on the fake device, with independent stored bytes and reported metadata. */
function seedReadableFile(
  path: string,
  content: string,
  size = content.length,
): void {
  defaultNativeFileSystemBoundary.seedTextFile(path, content, size);
}

describe('Batch3 · document attach validation (real documentService)', () => {
  beforeEach(() => {
    defaultNativeFileSystemBoundary.reset();
  });

  // ── #14/#15/#2 + csv/code: the full supported accept-set ───────────────────
  describe('supported document types are accepted (#2, #14, #15)', () => {
    const acceptedNames = [
      'notes.txt',
      'readme.md',
      'data.json',
      'table.csv',
      'script.py',
      'index.ts',
    ];

    it.each(acceptedNames)('isSupported() accepts %s', (name) => {
      expect(documentService.isSupported(name)).toBe(true);
    });

    it.each(acceptedNames)('processDocumentFromPath() builds a document attachment for %s', async (name) => {
      seedReadableFile(`/docs/${name}`, 'sample body', 11);
      const att = await documentService.processDocumentFromPath(`/docs/${name}`, name);
      expect(att).not.toBeNull();
      expect(att!.type).toBe('document');
      expect(att!.fileName).toBe(name);
      expect(att!.textContent).toBe('sample body');
      expect(att!.fileSize).toBe(11);
    });
  });

  // ── #12: unsupported binary format rejected with a visible error ────────────
  describe('unsupported binary formats are rejected (#12)', () => {
    it('isSupported() is false for a .docx binary', () => {
      expect(documentService.isSupported('report.docx')).toBe(false);
    });

    it('isSupported() is false for .xlsx and image binaries', () => {
      expect(documentService.isSupported('sheet.xlsx')).toBe(false);
      expect(documentService.isSupported('photo.png')).toBe(false);
    });

    it('processDocumentFromPath() throws an "Unsupported file type" error for .docx (no chip is added)', async () => {
      await expect(
        documentService.processDocumentFromPath('/docs/report.docx', 'report.docx'),
      ).rejects.toThrow(/Unsupported file type/);
    });
  });

  // ── #13: oversized (>5MB) file rejected with a visible error ────────────────
  describe('oversized files are rejected (#13)', () => {
    it('rejects a file at 5MB + 1 byte with a "too large" error', async () => {
      seedReadableFile('/docs/huge.txt', 'x', 5 * 1024 * 1024 + 1);
      await expect(
        documentService.processDocumentFromPath('/docs/huge.txt', 'huge.txt'),
      ).rejects.toThrow(/too large/i);
    });

    it('accepts a file exactly at the 5MB boundary', async () => {
      seedReadableFile('/docs/limit.txt', 'ok', 5 * 1024 * 1024);
      const att = await documentService.processDocumentFromPath('/docs/limit.txt', 'limit.txt');
      expect(att).not.toBeNull();
    });
  });

  // ── #17: URL-encoded filename should display decoded ────────────────────────
  //
  // BUG-FOUND: documentService.processDocumentFromPath returns `fileName` VERBATIM
  // for display (src/services/documentService.ts:156,190). It decodeURIComponent()s
  // only the file PATH inside resolveContentUri, never the display name. So a name
  // like 'my%20notes.txt' is surfaced to the attachment chip un-decoded, contrary
  // to device case #17 ("shows the human-readable decoded filename, not the raw
  // encoded string"). On device the picker usually hands back an already-decoded
  // name, which is why the E2E may still pass — but the service seam does not
  // guarantee it. Fixing this belongs in src (decode the display name once in the
  // service); per hardening rules we do NOT edit src, so the correct-behavior
  // assertion is skipped and the actual (buggy) behavior is pinned below.
  describe('URL-encoded filename display decode (#17)', () => {
    it.skip('BUG-FOUND: display fileName should be decoded (my%20notes.txt -> "my notes.txt")', async () => {
      seedReadableFile('/docs/my%20notes.txt', 'body');
      const att = await documentService.processDocumentFromPath(
        '/docs/my%20notes.txt',
        'my%20notes.txt',
      );
      // Desired behavior per device case #17: the chip shows the decoded, human-readable name.
      expect(att!.fileName).toBe('my notes.txt');
    });

    it.skip('pins ACTUAL behavior: the display fileName is returned un-decoded (documents the bug) — SKIP: do not enshrine the bug as passing; see the desired-behavior skip above', async () => {
      seedReadableFile('/docs/my%20notes.txt', 'body');
      const att = await documentService.processDocumentFromPath(
        '/docs/my%20notes.txt',
        'my%20notes.txt',
      );
      // NOT decoded today — this is the current, incorrect behavior we are pinning.
      expect(att!.fileName).toBe('my%20notes.txt');
    });

    it('resolves the file even when the PATH is URL-encoded (path decode works)', async () => {
      // The path decode DOES happen (resolveContentUri), so a file whose path
      // carries %20 still reads without error — the attach itself succeeds.
      seedReadableFile(
        '/mock/documents/my notes.txt',
        'decoded path body',
      );
      const att = await documentService.processDocumentFromPath(
        '/mock/documents/my%20notes.txt',
        'my%20notes.txt',
      );
      expect(att).not.toBeNull();
      expect(att!.textContent).toBe('decoded path body');
    });
  });

  // ── #34/#35: multiple document attachments queue as distinct attachments ────
  describe('multiple document attachments queue (#34, #35)', () => {
    it('produces two distinct attachments with unique ids for two files', async () => {
      seedReadableFile('/docs/a.py', 'py body');
      const first = await documentService.processDocumentFromPath('/docs/a.py', 'a.py');

      // Advance the clock so the second attachment gets a different id (id is Date.now()).
      const nowSpy = jest.spyOn(Date, 'now');
      const base = Date.now();
      nowSpy.mockReturnValue(base + 5);
      seedReadableFile('/docs/b.ts', 'ts body');
      const second = await documentService.processDocumentFromPath('/docs/b.ts', 'b.ts');
      nowSpy.mockRestore();

      expect(first!.fileName).toBe('a.py');
      expect(second!.fileName).toBe('b.ts');
      expect(first!.id).not.toBe(second!.id);
      // Both are documents that would render as side-by-side chips (#34) and send
      // together in one message (#35).
      expect(first!.type).toBe('document');
      expect(second!.type).toBe('document');
    });

    it('formatForContext() renders each queued document independently for the LLM (#35)', () => {
      const ctxA = documentService.formatForContext({
        id: '1', type: 'document', uri: '/x/a.py', fileName: 'a.py', textContent: 'print(1)',
      });
      const ctxB = documentService.formatForContext({
        id: '2', type: 'document', uri: '/x/b.ts', fileName: 'b.ts', textContent: 'const x = 1',
      });
      expect(ctxA).toContain('a.py');
      expect(ctxA).toContain('print(1)');
      expect(ctxB).toContain('b.ts');
      expect(ctxB).toContain('const x = 1');
    });
  });
});
