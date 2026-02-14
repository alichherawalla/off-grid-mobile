/**
 * PDFExtractor - TypeScript wrapper for native PDF text extraction modules.
 * Uses PDFKit on iOS (built-in) and PDFium on Android (native C++ via JNI).
 */

import { NativeModules } from 'react-native';

const { PDFExtractorModule } = NativeModules;

class PDFExtractor {
  /**
   * Check if the native PDF extraction module is available
   */
  isAvailable(): boolean {
    return PDFExtractorModule != null;
  }

  /**
   * Extract text from a PDF file at the given path.
   * Returns up to maxChars characters of text content.
   */
  async extractText(filePath: string, maxChars: number = 50000): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('PDF extraction is not available on this platform');
    }

    return await PDFExtractorModule.extractText(filePath, maxChars);
  }
}

export const pdfExtractor = new PDFExtractor();
