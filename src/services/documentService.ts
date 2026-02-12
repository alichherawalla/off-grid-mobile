/**
 * DocumentService - Handles reading and parsing document files
 * Supports: text files, code files, CSV, JSON, PDF, and other text-based formats
 */

import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { MediaAttachment } from '../types';
import { pdfExtractor } from './pdfExtractor';

// File extensions we can read as text
const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.xml', '.html', '.log', '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.c', '.cpp', '.h', '.swift', '.kt', '.go', '.rs', '.rb', '.php', '.sql', '.sh', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf'];

// PDF extension handled separately via native module
const PDF_EXTENSION = '.pdf';

// Max file size we'll read (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Persistent directory for attached documents
const ATTACHMENTS_DIR = `${RNFS.DocumentDirectoryPath}/attachments`;

class DocumentService {
  /**
   * Ensure the persistent attachments directory exists
   */
  private async ensureAttachmentsDir(): Promise<void> {
    const exists = await RNFS.exists(ATTACHMENTS_DIR);
    if (!exists) {
      await RNFS.mkdir(ATTACHMENTS_DIR);
    }
  }
  /**
   * Check if a file extension is supported
   */
  isSupported(fileName: string): boolean {
    const extension = '.' + fileName.split('.').pop()?.toLowerCase();
    if (extension === PDF_EXTENSION && pdfExtractor.isAvailable()) {
      return true;
    }
    return TEXT_EXTENSIONS.includes(extension);
  }

  /**
   * Resolve a content:// URI to a local file path by copying to temp cache.
   * Android document picker returns content:// URIs that RNFS can't read directly.
   */
  private async resolveContentUri(uri: string, fileName: string): Promise<string> {
    if (Platform.OS !== 'android' || !uri.startsWith('content://')) {
      return uri;
    }

    const tempPath = `${RNFS.CachesDirectoryPath}/${Date.now()}_${fileName}`;
    await RNFS.copyFile(uri, tempPath);
    return tempPath;
  }

  /**
   * Process a document from a file path
   */
  async processDocumentFromPath(filePath: string, fileName?: string): Promise<MediaAttachment | null> {
    try {
      const name = fileName || filePath.split('/').pop() || 'document';
      const extension = '.' + name.split('.').pop()?.toLowerCase();

      // Check if we can handle this file type
      const isPdf = extension === PDF_EXTENSION;
      if (!isPdf && !TEXT_EXTENSIONS.includes(extension)) {
        throw new Error(`Unsupported file type: ${extension}. Supported: txt, md, csv, json, pdf, code files`);
      }

      if (isPdf && !pdfExtractor.isAvailable()) {
        throw new Error('PDF extraction is not available on this device');
      }

      // Resolve content:// URIs on Android
      const resolvedPath = await this.resolveContentUri(filePath, name);

      // Check if file exists
      const exists = await RNFS.exists(resolvedPath);
      if (!exists) {
        throw new Error('File not found');
      }

      // Get file info
      const stat = await RNFS.stat(resolvedPath);

      // Check file size
      if (stat.size > MAX_FILE_SIZE) {
        throw new Error(`File is too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
      }

      // Read file content
      let textContent: string;
      if (isPdf) {
        textContent = await pdfExtractor.extractText(resolvedPath);
      } else {
        textContent = await RNFS.readFile(resolvedPath, 'utf8');
      }

      // Save a persistent copy so the file can be opened later from chat
      await this.ensureAttachmentsDir();
      const attachmentId = Date.now().toString();
      const persistentPath = `${ATTACHMENTS_DIR}/${attachmentId}_${name}`;
      let persistentCopyOk = false;
      try {
        await RNFS.copyFile(resolvedPath, persistentPath);
        persistentCopyOk = await RNFS.exists(persistentPath);
      } catch {
        // Copy failed — will fall back to original path
      }

      // Only clean up temp file AFTER verifying persistent copy succeeded
      if (resolvedPath !== filePath) {
        if (persistentCopyOk) {
          RNFS.unlink(resolvedPath).catch(() => {});
        }
        // If persistent copy failed, keep the temp file as fallback
      }

      // Truncate if too long (keep first 50k chars for context limits)
      const maxChars = 50000;
      if (textContent.length > maxChars) {
        textContent = textContent.substring(0, maxChars) + '\n\n... [Content truncated due to length]';
      }

      const storedUri = persistentCopyOk ? persistentPath : resolvedPath;

      return {
        id: attachmentId,
        type: 'document',
        uri: storedUri,
        fileName: name,
        textContent,
        fileSize: stat.size,
      };
    } catch (error: any) {
      console.error('[DocumentService] Error processing document:', error);
      throw error;
    }
  }

  /**
   * Create a document attachment from pasted text.
   * Saves to a persistent file so it can be opened later from chat.
   */
  async createFromText(text: string, fileName: string = 'pasted-text.txt'): Promise<MediaAttachment> {
    // Truncate if too long
    const maxChars = 50000;
    let textContent = text;
    if (textContent.length > maxChars) {
      textContent = textContent.substring(0, maxChars) + '\n\n... [Content truncated due to length]';
    }

    const id = Date.now().toString();

    // Write to persistent file so it can be opened from chat
    let uri = '';
    try {
      await this.ensureAttachmentsDir();
      const persistentPath = `${ATTACHMENTS_DIR}/${id}_${fileName}`;
      await RNFS.writeFile(persistentPath, text, 'utf8');
      uri = persistentPath;
    } catch {
      // Failed to write — uri stays empty, tap will be a no-op
    }

    return {
      id,
      type: 'document',
      uri,
      fileName,
      textContent,
      fileSize: text.length,
    };
  }

  /**
   * Format document content for including in LLM context
   */
  formatForContext(attachment: MediaAttachment): string {
    if (attachment.type !== 'document' || !attachment.textContent) {
      return '';
    }

    const fileName = attachment.fileName || 'document';
    return `\n\n---\n📄 **Attached Document: ${fileName}**\n\`\`\`\n${attachment.textContent}\n\`\`\`\n---\n`;
  }

  /**
   * Get a short preview of document content
   */
  getPreview(attachment: MediaAttachment, maxLength: number = 100): string {
    if (attachment.type !== 'document' || !attachment.textContent) {
      return attachment.fileName || 'Document';
    }

    const preview = attachment.textContent.substring(0, maxLength).replace(/\n/g, ' ');
    return preview.length < attachment.textContent.length ? preview + '...' : preview;
  }

  /**
   * Get list of supported file extensions
   */
  getSupportedExtensions(): string[] {
    const exts = [...TEXT_EXTENSIONS];
    if (pdfExtractor.isAvailable()) {
      exts.push(PDF_EXTENSION);
    }
    return exts;
  }
}

export const documentService = new DocumentService();
