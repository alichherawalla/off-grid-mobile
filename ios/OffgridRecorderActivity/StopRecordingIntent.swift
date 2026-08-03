import AppIntents
import Foundation

extension Notification.Name {
  /// Posted in the app process when the Live Activity's Stop button is pressed.
  /// The recorder module observes it and runs its normal stop path.
  static let offgridStopRecordingRequested = Notification.Name("OffgridStopRecordingRequested")
}

/**
 * The Live Activity's Stop button.
 *
 * A `LiveActivityIntent` performs in the APP's process, which is why stopping from the
 * widget works without opening the app: while recording, the app is already alive holding
 * the audio session. (This is also why Start cannot be a button - iOS will not bring a
 * fresh audio session up inside an intent's background window, so Start stays
 * tap-to-open through the existing reminder path.)
 *
 * The intent is deliberately thin: it posts one notification and lets the recorder own
 * what stopping means, so the widget and JS both end up on the same stop path.
 *
 * Member of BOTH targets: the extension references it in `Button(intent:)`, the app
 * performs it.
 */
struct StopRecordingIntent: LiveActivityIntent {

  static var title: LocalizedStringResource = "Stop recording"
  static var description = IntentDescription("Stops the Off Grid recorder.")

  /// Stopping must not yank the user into the app.
  static var openAppWhenRun: Bool = false

  init() {}

  func perform() async throws -> some IntentResult {
    await MainActor.run {
      NotificationCenter.default.post(name: .offgridStopRecordingRequested, object: nil)
    }
    return .result()
  }
}
