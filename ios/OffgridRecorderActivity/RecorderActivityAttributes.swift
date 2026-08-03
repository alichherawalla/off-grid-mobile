import ActivityKit
import Foundation

/**
 * The Live Activity's data model.
 *
 * Deliberately generic. It carries a status STRING rather than recorder concepts, so every
 * product decision - what counts as speech, what the line reads, when the activity starts
 * and ends - stays in JS where the recorder's state machine already lives. Nothing in this
 * file knows what a clip, a VAD checkpoint or a transcription queue is.
 *
 * IMPORTANT: this file must be a member of BOTH the app target and the widget-extension
 * target. The two run in different processes and each compiles its own copy; ActivityKit
 * matches the attributes by type name, which is why sharing the source file (rather than a
 * framework) is the supported approach.
 */
struct RecorderActivityAttributes: ActivityAttributes {

  public struct ContentState: Codable, Hashable {
    /// True while the mic is open. False during the wind-down, when the file is still
    /// being written but capture has stopped.
    var recording: Bool

    /// The last verdict from the native VAD checkpoint, which fires about every 60s.
    /// Drives the recording dot's appearance and nothing else.
    var speaking: Bool

    /// Anchors the elapsed timer. The system ticks the clock from this date, so the
    /// activity needs no per-second updates from us.
    var startedAt: Date

    /// The single line of text, built in JS: "Listening", "Speech", "Saving recording".
    var statusLine: String
  }

  /// Which recording session this activity belongs to, so an activity left over from a
  /// killed session is identifiable rather than silently adopted as the current one.
  var sessionId: String
}
