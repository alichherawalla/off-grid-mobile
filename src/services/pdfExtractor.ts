/**
 * PDFExtractor - TypeScript wrapper for native PDF text extraction modules.
 * Uses PDFKit on iOS (built-in) and pdfbox-android on Android.
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
   * Returns the full text content of the PDF.
   */
  async extractText(filePath: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('PDF extraction is not available on this platform');
    }

    return await PDFExtractorModule.extractText(filePath);
  }
}

export const pdfExtractor = new PDFExtractor();
