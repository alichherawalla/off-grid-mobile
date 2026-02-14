import Foundation
import PDFKit

@objc(PDFExtractorModule)
class PDFExtractorModule: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc
  func extractText(_ filePath: String, maxChars: Double, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard let url = URL(string: filePath) ?? URL(fileURLWithPath: filePath) as URL?,
            let document = PDFDocument(url: url) else {
        reject("PDF_ERROR", "Could not open PDF file", nil)
        return
      }

      let limit = Int(maxChars)
      var fullText = ""
      for i in 0..<document.pageCount {
        if let page = document.page(at: i), let pageText = page.string {
          fullText += pageText
          if i < document.pageCount - 1 {
            fullText += "\n\n"
          }
        }

        if fullText.count >= limit {
          fullText = String(fullText.prefix(limit))
          fullText += "\n\n... [Extracted \(i + 1) of \(document.pageCount) pages]"
          break
        }
      }

      resolve(fullText)
    }
  }
}
