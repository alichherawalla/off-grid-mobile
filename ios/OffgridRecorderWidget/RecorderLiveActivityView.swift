import ActivityKit
import SwiftUI
import WidgetKit

/**
 * The recorder Live Activity's UI: the Lock Screen card and the three Dynamic Island
 * presentations.
 *
 * Two rows and one button, nothing else. Row one is identity plus the elapsed clock, row
 * two is what the mic is hearing plus Stop. Emerald means one thing only - the mic is open -
 * so Stop is a neutral capsule and the wind-down state drops all colour.
 *
 * Note on motion: a Live Activity cannot run a repeating animation, so the recording dot is
 * not a pulse. It changes appearance between two states - filled on speech, hollow on
 * silence - each time the native VAD checkpoint reports (about every 60s).
 */

/// Mirrors the app's design tokens. Copied rather than imported: a widget extension cannot
/// reach @offgrid/design, and pulling the app's Swift in would drag React into the extension.
private enum Tokens {
  /// #C75050 - recording red. The activity only exists while the mic is open, so red is the only
  /// state colour it needs. It matches the Home Screen tile and the app's own convention, where red
  /// is reserved for the live-recording state.
  static let accent = Color(red: 199 / 255, green: 80 / 255, blue: 80 / 255)
  /// #FFFFFF
  static let ink = Color.white
  /// #B0B0B0
  static let inkSecondary = Color(red: 176 / 255, green: 176 / 255, blue: 176 / 255)
  /// #6E6E73
  static let inkMuted = Color(red: 110 / 255, green: 110 / 255, blue: 115 / 255)

  /// Menlo, the app's mono face, which ships with iOS. Weights stay regular.
  static func mono(_ size: CGFloat) -> Font { .custom("Menlo", size: size) }
}

// MARK: - Pieces

/// The live signal. Filled red while the mic hears speech, a hollow red ring while it is
/// listening to a quiet room, grey once capture has stopped.
private struct RecordingDot: View {
  let recording: Bool
  let speaking: Bool
  var size: CGFloat = 8

  var body: some View {
    Group {
      if !recording {
        Circle().fill(Tokens.inkMuted)
      } else if speaking {
        Circle().fill(Tokens.accent)
      } else {
        Circle().strokeBorder(Tokens.accent, lineWidth: 1.5)
      }
    }
    .frame(width: size, height: size)
  }
}

/// Elapsed time since the session started. The system ticks this, so the activity does not
/// need a per-second update from the app. The 12h range is the ceiling ActivityKit allows an
/// activity to live for, so the clock can never outrun its own window.
private struct ElapsedTime: View {
  let startedAt: Date
  let size: CGFloat

  var body: some View {
    Text(
      timerInterval: startedAt...startedAt.addingTimeInterval(12 * 60 * 60),
      countsDown: false
    )
    .font(Tokens.mono(size))
    .monospacedDigit()
    .foregroundStyle(Tokens.ink)
  }
}

/// The one action. Runs in the app process, so it stops the recorder without opening the app.
private struct StopButton: View {
  var body: some View {
    Button(intent: StopRecordingIntent()) {
      Text("STOP")
        .font(Tokens.mono(11))
        .tracking(1.4)
        .foregroundStyle(Tokens.ink)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
    .buttonStyle(.plain)
    .background(Color.white.opacity(0.16), in: Capsule())
  }
}

private struct Wordmark: View {
  var body: some View {
    Text("OFFGRID")
      .font(Tokens.mono(11))
      .tracking(1.6)
      .foregroundStyle(Tokens.inkSecondary)
  }
}

// MARK: - Lock Screen

/// Built first on purpose: a notch device shows this and has no Dynamic Island, so for most
/// test devices this layout is the whole feature.
private struct LockScreenCard: View {
  let state: RecorderActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 10) {
        RecordingDot(recording: state.recording, speaking: state.speaking)
        Wordmark()
        Spacer(minLength: 12)
        ElapsedTime(startedAt: state.startedAt, size: 20)
      }
      HStack(spacing: 12) {
        Text(state.statusLine)
          .font(Tokens.mono(14))
          .foregroundStyle(Tokens.ink)
          .lineLimit(1)
        Spacer(minLength: 12)
        StopButton()
      }
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 16)
  }
}

// MARK: - Widget

struct RecorderLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RecorderActivityAttributes.self) { context in
      LockScreenCard(state: context.state)
        .activityBackgroundTint(Color.black.opacity(0.55))
        .activitySystemActionForegroundColor(Tokens.ink)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 8) {
            RecordingDot(recording: context.state.recording, speaking: context.state.speaking)
            Wordmark()
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          ElapsedTime(startedAt: context.state.startedAt, size: 16)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack(spacing: 12) {
            Text(context.state.statusLine)
              .font(Tokens.mono(13))
              .foregroundStyle(Tokens.ink)
              .lineLimit(1)
            Spacer(minLength: 12)
            StopButton()
          }
          .padding(.top, 4)
        }
      } compactLeading: {
        RecordingDot(
          recording: context.state.recording,
          speaking: context.state.speaking,
          size: 9
        )
      } compactTrailing: {
        ElapsedTime(startedAt: context.state.startedAt, size: 13)
      } minimal: {
        RecordingDot(
          recording: context.state.recording,
          speaking: context.state.speaking,
          size: 9
        )
      }
      .keylineTint(Tokens.accent)
    }
  }
}
