import Foundation
import PDFKit

@objc(PDFExtractorModule)
class PDFExtractorModule: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc
  func extractText(_ filePath: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard let url = URL(string: filePath) ?? URL(fileURLWithPath: filePath) as URL?,
            let document = PDFDocument(url: url) else {
        reject("PDF_ERROR", "Could not open PDF file", nil)
        return
      }

      var fullText = ""
      for i in 0..<document.pageCount {
        if let page = document.page(at: i), let pageText = page.string {
          fullText += pageText
          if i < document.pageCount - 1 {
            fullText += "\n\n"
          }
        }
      }

      resolve(fullText)
    }
  }
}
