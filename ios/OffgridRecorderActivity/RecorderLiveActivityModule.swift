import ActivityKit
import Foundation

/**
 * The JS bridge for the recorder Live Activity: start / update / end.
 *
 * Lives in the app target rather than the `pro/` pod because it has to construct
 * `Activity<RecorderActivityAttributes>`, and that type must be shared with the widget
 * extension - a CocoaPods module cannot be a member of an app extension target without
 * dragging React into the extension. Everything product-specific (when to start, what the
 * status line says) is still decided in `pro/locket/services/liveActivityService.ts`; this
 * class only moves a dictionary into ActivityKit.
 *
 * Every method is fire-and-forget on purpose. A Live Activity failure must never break
 * recording, so nothing here returns a promise JS could await or reject on.
 */
@objc(RecorderLiveActivity)
class RecorderLiveActivity: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { return false }

  /// The activity this process started. Nil after a relaunch even when an activity is
  /// still on screen, which is why `start` adopts and `end` sweeps (below).
  private static var current: Activity<RecorderActivityAttributes>?

  @objc(start:)
  func start(_ payload: NSDictionary) {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
      NSLog("[RecorderLiveActivity] Live Activities are off in Settings - skipping")
      return
    }
    // One activity per session. Two cases land here with something already on screen:
    // a duplicate start, and a relaunch mid-session (the app was killed, the activity
    // survived, `current` did not). Both want the existing card updated, not a second one.
    if let existing = Self.current ?? Activity<RecorderActivityAttributes>.activities.first {
      Self.current = existing
      update(payload)
      return
    }
    do {
      Self.current = try Activity.request(
        attributes: RecorderActivityAttributes(
          sessionId: payload["sessionId"] as? String ?? UUID().uuidString
        ),
        content: ActivityContent(state: Self.contentState(from: payload), staleDate: nil),
        pushType: nil
      )
      NSLog("[RecorderLiveActivity] started")
    } catch {
      NSLog("[RecorderLiveActivity] start failed: \(error.localizedDescription)")
    }
  }

  @objc(update:)
  func update(_ payload: NSDictionary) {
    guard let activity = Self.current else { return }
    let state = Self.contentState(from: payload)
    Task {
      await activity.update(ActivityContent(state: state, staleDate: nil))
    }
  }

  @objc
  func end() {
    Self.current = nil
    // Sweep every activity of this type, not just the one this process started. After an
    // app kill and relaunch, `current` is nil while the card is still on the Lock Screen -
    // ending only `current` would leave it there claiming a recording that has stopped.
    Task {
      for activity in Activity<RecorderActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      NSLog("[RecorderLiveActivity] ended")
    }
  }

  private static func contentState(
    from payload: NSDictionary
  ) -> RecorderActivityAttributes.ContentState {
    let startedAtMs = payload["startedAtMs"] as? Double ?? Date().timeIntervalSince1970 * 1000
    return .init(
      recording: payload["recording"] as? Bool ?? true,
      speaking: payload["speaking"] as? Bool ?? false,
      startedAt: Date(timeIntervalSince1970: startedAtMs / 1000),
      statusLine: payload["statusLine"] as? String ?? "Recording"
    )
  }
}
