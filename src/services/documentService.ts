/**
 * DocumentService - Handles reading and parsing document files
 * Supports: text files, code files, CSV, JSON, PDF, and other text-based formats
 */

import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { statFile } from '../utils/fileStat';
import { MediaAttachment } from '../types';
import { pdfExtractor } from './pdfExtractor';
import { useAppStore } from '../stores/appStore';
import { APP_CONFIG } from '../constants';
import { generateId } from '../utils/generateId';
import {
  admitDocument,
  documentAttachmentCharBudget,
  documentPreview,
  formatDocumentForContext,
  isPdfDocument,
  isSupportedDocument,
  supportedDocumentExtensions,
  truncateDocumentText,
  type DocumentCapabilities,
} from '@offgrid/rag';

// The attachment rules (which files, how large, how much of one the model sees, the truncation
// marker, the context block, the preview) are @offgrid/rag's `document-attachment`; this service
// keeps only the file system and the PDF extractor.
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
  /** What this device can open: PDFs only when the native extractor is present. */
  private capabilities(): DocumentCapabilities {
    return { pdf: pdfExtractor.isAvailable() };
  }

  /** The chat's context window as the model sees it, in tokens. */
  private contextLength(): number {
    return (
      useAppStore.getState().settings.contextLength || APP_CONFIG.maxContextLength
    );
  }

  /**
   * Check if a file extension is supported
   */
  isSupported(fileName: string): boolean {
    return isSupportedDocument(fileName, this.capabilities());
  }

  /**
   * Resolve a document picker URI to a local file path by copying to temp cache.
   * - Android: content:// URIs need to be copied to a readable location
   * - iOS: file:// URIs from document picker are security-scoped and need to be copied
   * - Note: Files from keepLocalCopy are already in app's Documents directory
   */
  private async resolveContentUri(
    uri: string,
    fileName: string,
  ): Promise<string> {
    console.log(`[DocumentService] resolveContentUri input: ${uri}`);

    // Check if this is a file from keepLocalCopy - it would be in our app's Documents directory
    // keepLocalCopy returns paths like: file:///Users/.../App/Documents/filename
    // RNFS.DocumentDirectoryPath is the app's Documents directory (without file://)
    const documentsPath = RNFS.DocumentDirectoryPath;

    // Decode URL-encoded characters (like %20 for spaces) and strip file:// prefix
    // This is critical because RNFS.exists() needs decoded paths, not URL-encoded
    const decodedUri = decodeURIComponent(uri);
    const cleanUri = decodedUri.replace(/^file:\/\//, '');
    console.log(`[DocumentService] Decoded and cleaned path: ${cleanUri}`);
    console.log(`[DocumentService] Documents path: ${documentsPath}`);

    // Only skip copying if the file is exactly in our app's Documents directory
    // This must be a precise match to avoid security-scoped URLs from document picker
    if (cleanUri.startsWith(documentsPath)) {
      console.log(
        `[DocumentService] File is in app Documents directory, using directly`,
      );
      return cleanUri;
    }

    // Android: content:// URIs
    if (Platform.OS === 'android' && uri.startsWith('content://')) {
      const tempPath = `${RNFS.CachesDirectoryPath}/${Date.now()}_${fileName}`;
      await RNFS.copyFile(uri, tempPath);
      console.log(
        `[DocumentService] Copied Android content:// URI to: ${tempPath}`,
      );
      return tempPath;
    }

    // iOS: file:// URIs from document picker are security-scoped
    // Copy to a temp location that we can access directly
    if (Platform.OS === 'ios' && uri.startsWith('file://')) {
      const tempPath = `${RNFS.CachesDirectoryPath}/${Date.now()}_${fileName}`;
      try {
        // RNFS.copyFile can handle file:// URIs by copying the underlying file
        await RNFS.copyFile(uri, tempPath);
        console.log(`[DocumentService] Copied iOS file:// URI to: ${tempPath}`);
        return tempPath;
      } catch (_copyError) {
        // If direct copy fails, try stripping the file:// prefix
        const pathWithoutScheme = decodedUri.replace(/^file:\/\//, '');
        try {
          await RNFS.copyFile(pathWithoutScheme, tempPath);
          console.log(`[DocumentService] Copied (fallback) to: ${tempPath}`);
          return tempPath;
        } catch {
          console.error(`[DocumentService] Both copy attempts failed`);
          throw new Error(
            `Could not access file. Please try selecting the file again.`,
          );
        }
      }
    }

    console.log(`[DocumentService] Returning URI as-is: ${uri}`);
    return uri;
  }

  private async readContent(
    resolvedPath: string,
    isPdf: boolean,
    maxChars: number,
  ): Promise<string> {
    console.log(
      `[DocumentService] readContent called - path: ${resolvedPath}, isPdf: ${isPdf}, maxChars: ${maxChars}`,
    );
    try {
      const raw = isPdf
        ? await pdfExtractor.extractText(resolvedPath, maxChars)
        : await RNFS.readFile(resolvedPath, 'utf8');
      console.log(
        `[DocumentService] Successfully read ${raw.length} characters`,
      );
      return truncateDocumentText(raw, maxChars);
    } catch (error: any) {
      console.error(
        `[DocumentService] Error reading content:`,
        error?.message || error,
      );
      throw error;
    }
  }

  private async savePersistentCopy(
    resolvedPath: string,
    originalPath: string,
    name: string,
  ): Promise<{ id: string; uri: string }> {
    await this.ensureAttachmentsDir();
    const id = generateId();
    const persistentPath = `${ATTACHMENTS_DIR}/${id}_${name}`;
    let ok = false;
    try {
      await RNFS.copyFile(resolvedPath, persistentPath);
      ok = await RNFS.exists(persistentPath);
    } catch {
      /* fall back to original path */
    }
    if (resolvedPath !== originalPath && ok) {
      RNFS.unlink(resolvedPath).catch(() => {});
    }
    return { id, uri: ok ? persistentPath : resolvedPath };
  }

  /**
   * Process a document from a file path
   */
  async processDocumentFromPath(
    filePath: string,
    fileName?: string,
    maxCharsOverride?: number,
  ): Promise<MediaAttachment | null> {
    try {
      console.log(
        `[DocumentService] Processing document - filePath: ${filePath}, fileName: ${fileName}`,
      );
      const name = fileName || filePath.split('/').pop() || 'document';
      const isPdf = isPdfDocument(name);
      console.log(`[DocumentService] isPdf: ${isPdf}`);
      const typeAdmission = admitDocument(name, undefined, this.capabilities());
      if (!typeAdmission.admitted) {
        throw new Error(typeAdmission.reason);
      }

      const resolvedPath = await this.resolveContentUri(filePath, name);
      console.log(`[DocumentService] Resolved path: ${resolvedPath}`);

      // Verify the file exists and is accessible
      let fileExists = false;
      try {
        fileExists = await RNFS.exists(resolvedPath);
        console.log(`[DocumentService] File exists check: ${fileExists}`);
      } catch (existsError) {
        // RNFS.exists can fail on security-scoped URLs
        console.error(`[DocumentService] exists() threw error:`, existsError);
        throw new Error(
          'Could not access file. Please try selecting the file again.',
        );
      }

      if (!fileExists) {
        throw new Error(`File not found: ${name}`);
      }

      const facts = await statFile(resolvedPath);
      if (!facts) {
        throw new Error(
          'Could not determine file size. Please try selecting the file again.',
        );
      }
      const fileSize = facts.size;
      console.log(`[DocumentService] File size: ${fileSize} bytes`);
      const admission = admitDocument(name, fileSize, this.capabilities());
      if (!admission.admitted) {
        throw new Error(admission.reason);
      }

      const maxChars =
        maxCharsOverride ?? documentAttachmentCharBudget(this.contextLength());
      const textContent = await this.readContent(resolvedPath, isPdf, maxChars);
      const { id, uri } = await this.savePersistentCopy(
        resolvedPath,
        filePath,
        name,
      );

      return {
        id,
        type: 'document',
        uri,
        fileName: name,
        textContent,
        fileSize,
      };
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Create a document attachment from pasted text.
   * Saves to a persistent file so it can be opened later from chat.
   */
  async createFromText(
    text: string,
    fileName: string = 'pasted-text.txt',
  ): Promise<MediaAttachment> {
    const textContent = truncateDocumentText(
      text,
      documentAttachmentCharBudget(this.contextLength()),
    );

    const id = generateId();

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
    return attachment.type === 'document' ? formatDocumentForContext(attachment) : '';
  }

  /**
   * Get a short preview of document content
   */
  getPreview(attachment: MediaAttachment, maxLength?: number): string {
    return attachment.type === 'document'
      ? documentPreview(attachment, maxLength)
      : attachment.fileName || 'Document';
  }

  /**
   * Get list of supported file extensions
   */
  getSupportedExtensions(): string[] {
    return supportedDocumentExtensions(this.capabilities());
  }
}

export const documentService = new DocumentService();
