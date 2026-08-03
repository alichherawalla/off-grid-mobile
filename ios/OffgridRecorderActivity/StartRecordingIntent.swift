import AppIntents
import Foundation

extension Notification.Name {
  /// Posted in the app process when the Home Screen / Lock Screen widget is tapped.
  /// The recorder module observes it and starts a session through the normal JS path.
  static let offgridStartRecordingRequested = Notification.Name("OffgridStartRecordingRequested")
}

/**
 * The widget's tap action: open Off Grid and start recording.
 *
 * `openAppWhenRun` is true on purpose, and it is the whole reason this is not a silent
 * background start. iOS will not reliably bring a fresh AVAudioSession up inside an intent's
 * brief background window, so a widget cannot open the mic on its own. Stop can act in the
 * background (the app is already alive holding the session); Start cannot. Rather than pretend
 * otherwise, this intent brings the app forward and lets the recorder start where it works.
 *
 * Thin by design, exactly like StopRecordingIntent: it posts one notification and the recorder
 * owns what starting means - including which settings to use, which only JS knows.
 *
 * Member of BOTH targets: the widget references it, the app performs it.
 */
struct StartRecordingIntent: AppIntent {

  static var title: LocalizedStringResource = "Start recording"
  static var description = IntentDescription("Opens Off Grid and starts the recorder.")

  // Tested on device 2026-07-31 with `false`, and it does nothing at all: no start, no error, no
  // log line. A plain AppIntent with openAppWhenRun = false runs in the WIDGET extension's
  // process, so the notification below is posted where the app cannot hear it. (StopRecordingIntent
  // works precisely because LiveActivityIntent is documented to run in the app's process - that
  // guarantee does not extend to this.) Hence true: bring the app forward, post the notification in
  // its process, and let the recorder start where the audio session can actually be activated.
  //
  // If a silent start is ever wanted, the route to try is iOS 18's audio-starting intent protocol,
  // which exists to grant exactly this - not this flag.
  static var openAppWhenRun: Bool = true

  init() {}

  func perform() async throws -> some IntentResult {
    await MainActor.run {
      NotificationCenter.default.post(name: .offgridStartRecordingRequested, object: nil)
    }
    return .result()
  }
}
