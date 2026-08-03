import Foundation
import WidgetKit

/**
 * Publishes the recorder snapshot for the widget, and asks WidgetKit to redraw the tile.
 *
 * Separate from RecorderLiveActivity on purpose: that owns a live activity's lifecycle, this owns
 * a file the widget reads. Same reason they are separate on the JS side.
 *
 * Reloads are app-initiated and only happen on real transitions (start, stop, and a correcting
 * write at launch), which is what keeps this inside WidgetKit's refresh budget. A snapshot written
 * on every store change would get the tile throttled and left stale - the opposite of the goal.
 *
 * Fire-and-forget, like the Live Activity bridge: a tile that fails to update must never affect
 * recording.
 */
@objc(RecorderWidgetSnapshot)
class RecorderWidgetSnapshot: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { return false }

  @objc(publish:)
  func publish(_ payload: NSDictionary) {
    let recording = payload["recording"] as? Bool ?? false
    let ok = RecorderSnapshot.write(
      RecorderSnapshot(recording: recording, updatedAt: Date())
    )
    guard ok else {
      NSLog("[RecorderWidgetSnapshot] App Group unavailable - tile cannot be updated")
      return
    }
    WidgetCenter.shared.reloadTimelines(ofKind: RecorderSnapshot.widgetKind)
    NSLog("[RecorderWidgetSnapshot] published recording=\(recording)")
  }
}
