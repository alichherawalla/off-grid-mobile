#if DEBUG
import ActivityKit
import SwiftUI
import WidgetKit

/**
 * Xcode previews for the recorder Live Activity.
 *
 * The fastest way to SEE this feature: open this file in Xcode, hit the preview canvas, and
 * every presentation renders without building the app, running the recorder, or owning a
 * device with a Dynamic Island. Use the state picker in the canvas to step through the four
 * content states.
 *
 * DEBUG-only, so none of it ships.
 */

extension RecorderActivityAttributes {
  fileprivate static var preview: RecorderActivityAttributes {
    RecorderActivityAttributes(sessionId: "preview")
  }
}

extension RecorderActivityAttributes.ContentState {
  /// 1h 42m in, so the clock renders in its widest form (H:MM:SS) rather than the
  /// narrow MM:SS that a fresh session would show.
  private static var startedAt: Date { Date(timeIntervalSinceNow: -6127) }

  fileprivate static var listening: Self {
    .init(recording: true, speaking: false, startedAt: startedAt, statusLine: "Listening")
  }

  fileprivate static var speech: Self {
    .init(recording: true, speaking: true, startedAt: startedAt, statusLine: "Speech")
  }

  fileprivate static var muted: Self {
    .init(
      recording: true,
      speaking: false,
      startedAt: startedAt,
      statusLine: "Muted while the app speaks"
    )
  }

  /// The wind-down: capture has stopped, the file is still being written. All emerald drops out.
  fileprivate static var saving: Self {
    .init(recording: false, speaking: false, startedAt: startedAt, statusLine: "Saving recording")
  }
}

// The layout to build against first: a notch device shows this and nothing else.
#Preview("Lock Screen", as: .content, using: RecorderActivityAttributes.preview) {
  RecorderLiveActivityWidget()
} contentStates: {
  RecorderActivityAttributes.ContentState.listening
  RecorderActivityAttributes.ContentState.speech
  RecorderActivityAttributes.ContentState.muted
  RecorderActivityAttributes.ContentState.saving
}

#Preview("Island expanded", as: .dynamicIsland(.expanded), using: RecorderActivityAttributes.preview) {
  RecorderLiveActivityWidget()
} contentStates: {
  RecorderActivityAttributes.ContentState.listening
  RecorderActivityAttributes.ContentState.speech
  RecorderActivityAttributes.ContentState.saving
}

#Preview("Island compact", as: .dynamicIsland(.compact), using: RecorderActivityAttributes.preview) {
  RecorderLiveActivityWidget()
} contentStates: {
  RecorderActivityAttributes.ContentState.listening
  RecorderActivityAttributes.ContentState.speech
}

#Preview("Island minimal", as: .dynamicIsland(.minimal), using: RecorderActivityAttributes.preview) {
  RecorderLiveActivityWidget()
} contentStates: {
  RecorderActivityAttributes.ContentState.listening
  RecorderActivityAttributes.ContentState.speech
}
#endif
