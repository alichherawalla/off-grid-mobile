import SwiftUI
import WidgetKit

/// The widget extension's entry point.
///
/// Two widgets that split the recorder's states between them: the Live Activity owns "a session
/// is happening right now" (Lock Screen card + Dynamic Island, live clock, working Stop), and the
/// static tile owns "nothing is happening" (Home Screen / Lock Screen, tap to start).
@main
struct OffgridRecorderWidgetBundle: WidgetBundle {
  var body: some Widget {
    RecorderLiveActivityWidget()
    RecorderHomeWidget()
  }
}
