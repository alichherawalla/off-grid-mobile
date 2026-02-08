/**
 * DocumentService Unit Tests
 *
 * Tests for document reading, parsing, and formatting.
 * Priority: P1 - Document attachment support.
 */

import { documentService } from '../../../src/services/documentService';
import RNFS from 'react-native-fs';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;

describe('DocumentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================================================
  // isSupported
  // ========================================================================
  describe('isSupported', () => {
    it('returns true for .txt files', () => {
      expect(documentService.isSupported('readme.txt')).toBe(true);
    });

    it('returns true for .md files', () => {
      expect(documentService.isSupported('notes.md')).toBe(true);
    });

    it('returns true for .py files', () => {
      expect(documentService.isSupported('script.py')).toBe(true);
    });

    it('returns true for .ts files', () => {
      expect(documentService.isSupported('index.ts')).toBe(true);
    });

    it('returns true for .json files', () => {
      expect(documentService.isSupported('data.json')).toBe(true);
    });

    it('returns false for .pdf files', () => {
      expect(documentService.isSupported('document.pdf')).toBe(false);
    });

    it('returns false for .docx files', () => {
      expect(documentService.isSupported('document.docx')).toBe(false);
    });

    it('returns false for .png files', () => {
      expect(documentService.isSupported('image.png')).toBe(false);
    });

    it('returns false for files with no extension', () => {
      expect(documentService.isSupported('Makefile')).toBe(false);
    });

    it('handles case-insensitive extensions', () => {
      expect(documentService.isSupported('README.TXT')).toBe(true);
      expect(documentService.isSupported('script.PY')).toBe(true);
    });
  });

  // ========================================================================
  // processDocumentFromPath
  // ========================================================================
  describe('processDocumentFromPath', () => {
    it('reads file and returns MediaAttachment', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 500, isFile: () => true } as any);
      mockedRNFS.readFile.mockResolvedValue('Hello world');

      const result = await documentService.processDocumentFromPath('/path/to/file.txt');

      expect(result).not.toBeNull();
      expect(result!.type).toBe('document');
      expect(result!.textContent).toBe('Hello world');
      expect(result!.fileName).toBe('file.txt');
      expect(result!.fileSize).toBe(500);
      expect(RNFS.readFile).toHaveBeenCalledWith('/path/to/file.txt', 'utf8');
    });

    it('throws when file does not exist', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      await expect(
        documentService.processDocumentFromPath('/missing/file.txt')
      ).rejects.toThrow('File not found');
    });

    it('throws when file exceeds max size (5MB)', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 6 * 1024 * 1024, isFile: () => true } as any);

      await expect(
        documentService.processDocumentFromPath('/path/to/large.txt')
      ).rejects.toThrow('File is too large');
    });

    it('throws when file type is unsupported', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 500, isFile: () => true } as any);

      await expect(
        documentService.processDocumentFromPath('/path/to/file.pdf')
      ).rejects.toThrow('Unsupported file type');
    });

    it('truncates content exceeding 50K characters', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 500, isFile: () => true } as any);
      const longContent = 'a'.repeat(60000);
      mockedRNFS.readFile.mockResolvedValue(longContent);

      const result = await documentService.processDocumentFromPath('/path/to/file.txt');

      expect(result!.textContent!.length).toBeLessThan(60000);
      expect(result!.textContent).toContain('... [Content truncated due to length]');
    });

    it('uses basename from path when fileName not provided', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 100, isFile: () => true } as any);
      mockedRNFS.readFile.mockResolvedValue('content');

      const result = await documentService.processDocumentFromPath('/deep/nested/script.py');

      expect(result!.fileName).toBe('script.py');
    });

    it('uses provided fileName over path basename', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 100, isFile: () => true } as any);
      mockedRNFS.readFile.mockResolvedValue('content');

      const result = await documentService.processDocumentFromPath('/path/to/file.txt', 'custom.txt');

      expect(result!.fileName).toBe('custom.txt');
    });
  });

  // ========================================================================
  // createFromText
  // ========================================================================
  describe('createFromText', () => {
    it('creates document with default filename', () => {
      const result = documentService.createFromText('Some pasted text');

      expect(result.type).toBe('document');
      expect(result.textContent).toBe('Some pasted text');
      expect(result.fileName).toBe('pasted-text.txt');
      expect(result.fileSize).toBe('Some pasted text'.length);
      expect(result.uri).toBe('');
    });

    it('creates document with custom filename', () => {
      const result = documentService.createFromText('Code snippet', 'snippet.py');

      expect(result.fileName).toBe('snippet.py');
    });

    it('truncates text exceeding 50K characters', () => {
      const longText = 'b'.repeat(60000);
      const result = documentService.createFromText(longText);

      expect(result.textContent!.length).toBeLessThan(60000);
      expect(result.textContent).toContain('... [Content truncated due to length]');
    });
  });

  // ========================================================================
  // formatForContext
  // ========================================================================
  describe('formatForContext', () => {
    it('formats document as code block with filename', () => {
      const attachment = {
        id: '1',
        type: 'document' as const,
        uri: '/path/to/file.py',
        fileName: 'script.py',
        textContent: 'print("hello")',
      };

      const result = documentService.formatForContext(attachment);

      expect(result).toContain('**Attached Document: script.py**');
      expect(result).toContain('```');
      expect(result).toContain('print("hello")');
    });

    it('returns empty string for non-document attachments', () => {
      const attachment = {
        id: '1',
        type: 'image' as const,
        uri: 'file:///image.jpg',
      };

      expect(documentService.formatForContext(attachment)).toBe('');
    });

    it('returns empty string when textContent is missing', () => {
      const attachment = {
        id: '1',
        type: 'document' as const,
        uri: '/path/to/file.txt',
        fileName: 'file.txt',
      };

      expect(documentService.formatForContext(attachment)).toBe('');
    });
  });

  // ========================================================================
  // getPreview
  // ========================================================================
  describe('getPreview', () => {
    it('truncates long content and adds ellipsis', () => {
      const attachment = {
        id: '1',
        type: 'document' as const,
        uri: '',
        textContent: 'a'.repeat(200),
      };

      const preview = documentService.getPreview(attachment);

      expect(preview.length).toBeLessThanOrEqual(104); // 100 + '...'
      expect(preview.endsWith('...')).toBe(true);
    });

    it('returns full content when shorter than maxLength', () => {
      const attachment = {
        id: '1',
        type: 'document' as const,
        uri: '',
        textContent: 'Short content',
      };

      const preview = documentService.getPreview(attachment);

      expect(preview).toBe('Short content');
      expect(preview).not.toContain('...');
    });

    it('replaces newlines with spaces', () => {
      const attachment = {
        id: '1',
        type: 'document' as const,
        uri: '',
        textContent: 'line1\nline2\nline3',
      };

      const preview = documentService.getPreview(attachment);

      expect(preview).toBe('line1 line2 line3');
    });

    it('respects custom maxLength', () => {
      const attachment = {
        id: '1',
        type: 'document' as const,
        uri: '',
        textContent: 'a'.repeat(50),
      };

      const preview = documentService.getPreview(attachment, 20);

      expect(preview.length).toBeLessThanOrEqual(24); // 20 + '...'
    });

    it('returns fileName for non-document attachments', () => {
      const attachment = {
        id: '1',
        type: 'image' as const,
        uri: 'file:///img.jpg',
        fileName: 'photo.jpg',
      };

      expect(documentService.getPreview(attachment)).toBe('photo.jpg');
    });

    it('returns "Document" fallback for non-document without fileName', () => {
      const attachment = {
        id: '1',
        type: 'image' as const,
        uri: 'file:///img.jpg',
      };

      expect(documentService.getPreview(attachment)).toBe('Document');
    });
  });

  // ========================================================================
  // getSupportedExtensions
  // ========================================================================
  describe('getSupportedExtensions', () => {
    it('returns an array of supported extensions', () => {
      const extensions = documentService.getSupportedExtensions();

      expect(Array.isArray(extensions)).toBe(true);
      expect(extensions).toContain('.txt');
      expect(extensions).toContain('.md');
      expect(extensions).toContain('.py');
      expect(extensions).toContain('.ts');
    });
  });
});
