import Foundation
import UIKit

final class SyncClipboardObserver: NSObject {
  private let pasteboard: UIPasteboard
  private let notificationCenter: NotificationCenter
  private let now: () -> TimeInterval
  private let onText: (String, Double) -> Void
  private var enabled = false
  private var lastChangeCount = 0

  init(
    pasteboard: UIPasteboard = .general,
    notificationCenter: NotificationCenter = .default,
    now: @escaping () -> TimeInterval = { Date().timeIntervalSince1970 },
    onText: @escaping (String, Double) -> Void
  ) {
    self.pasteboard = pasteboard
    self.notificationCenter = notificationCenter
    self.now = now
    self.onText = onText
    super.init()
  }

  func setEnabled(_ next: Bool) {
    guard enabled != next else { return }
    enabled = next
    if next {
      lastChangeCount = pasteboard.changeCount
      notificationCenter.addObserver(
        self,
        selector: #selector(clipboardChanged),
        name: UIPasteboard.changedNotification,
        object: pasteboard
      )
      notificationCenter.addObserver(
        self,
        selector: #selector(clipboardChanged),
        name: UIApplication.didBecomeActiveNotification,
        object: nil
      )
    } else {
      notificationCenter.removeObserver(self)
    }
  }

  func writeText(_ text: String) {
    pasteboard.string = text
    // A Sync write updates the system pasteboard but is not a new local copy.
    // Seed the observed generation so a delayed pasteboard/application
    // notification cannot publish it back to the sender.
    lastChangeCount = pasteboard.changeCount
  }

  @objc private func clipboardChanged() {
    guard enabled, pasteboard.changeCount != lastChangeCount else { return }
    lastChangeCount = pasteboard.changeCount
    guard let text = pasteboard.string else { return }
    let timestamp = (now() * 1_000).rounded(.down)
    guard timestamp.isFinite, timestamp >= 0 else { return }
    onText(text, timestamp)
  }

  deinit {
    notificationCenter.removeObserver(self)
  }
}

@objc(SyncClipboardModule)
final class SyncClipboardModule: RCTEventEmitter {
  private var hasEventListeners = false
  private var observer: SyncClipboardObserver?

  @objc
  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func supportedEvents() -> [String] {
    ["SyncClipboardChanged"]
  }

  override func startObserving() {
    hasEventListeners = true
  }

  override func stopObserving() {
    hasEventListeners = false
  }

  @objc
  func setEnabled(_ enabled: Bool) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if observer == nil {
        observer = SyncClipboardObserver { [weak self] text, timestamp in
          guard self?.hasEventListeners == true else { return }
          self?.sendEvent(
            withName: "SyncClipboardChanged",
            body: ["text": text, "ts": timestamp]
          )
        }
      }
      observer?.setEnabled(enabled)
    }
  }

  @objc
  func writeText(_ text: String) {
    DispatchQueue.main.async { [weak self] in
      if self?.observer == nil {
        self?.observer = SyncClipboardObserver { [weak self] text, timestamp in
          guard self?.hasEventListeners == true else { return }
          self?.sendEvent(
            withName: "SyncClipboardChanged",
            body: ["text": text, "ts": timestamp]
          )
        }
      }
      self?.observer?.writeText(text)
    }
  }

  deinit {
    observer?.setEnabled(false)
  }
}
