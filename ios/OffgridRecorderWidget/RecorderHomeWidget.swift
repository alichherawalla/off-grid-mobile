import AppIntents
import SwiftUI
import WidgetKit

/**
 * The always-there tile: Home Screen (small square) and Lock Screen (circular).
 *
 * Deliberately STATIC. It shows no live recorder state, which is a design decision rather
 * than a limitation to apologise for:
 *
 *  - A widget runs in its own process and cannot read the app's stores. Showing real state
 *    would need an App Group and a snapshot the app writes for it to read.
 *  - The recording case is already covered, better, by the Live Activity: the Lock Screen card
 *    and the Dynamic Island, with a live clock and a working Stop.
 *
 * So this tile owns the one case the Live Activity cannot: getting a session started when
 * nothing is happening. Static content also means one timeline entry with `.never`, so it
 * spends none of the system's refresh budget.
 */

private enum Tokens {
  /// #34D399 - emerald. Means "ready, nothing is happening".
  static let idle = Color(red: 52 / 255, green: 211 / 255, blue: 153 / 255)

  /// Recording red, the app's error/recording hue per theme: #DC2626 light, #C75050 dark.
  /// Two colours with two meanings and no overlap: emerald is ready, red is a live mic.
  static func rec(_ scheme: ColorScheme) -> Color {
    scheme == .dark
      ? Color(red: 199 / 255, green: 80 / 255, blue: 80 / 255)
      : Color(red: 220 / 255, green: 38 / 255, blue: 38 / 255)
  }

  static func mono(_ size: CGFloat) -> Font { .custom("Menlo", size: size) }
}

struct RecorderEntry: TimelineEntry {
  let date: Date
  let recording: Bool
}

struct RecorderProvider: TimelineProvider {
  func placeholder(in _: Context) -> RecorderEntry {
    RecorderEntry(date: Date(), recording: false)
  }

  func getSnapshot(in _: Context, completion: @escaping (RecorderEntry) -> Void) {
    completion(RecorderEntry(date: Date(), recording: RecorderSnapshot.read().recording))
  }

  func getTimeline(in _: Context, completion: @escaping (Timeline<RecorderEntry>) -> Void) {
    // One entry, policy .never. The tile does not poll and does not age out: the app pushes a
    // reload when recording actually starts or stops (RecorderWidgetSnapshot.publish). A timeline
    // that refreshed itself on a schedule would burn WidgetKit's budget and then be throttled into
    // showing something stale, which is exactly the failure this design avoids.
    let entry = RecorderEntry(date: Date(), recording: RecorderSnapshot.read().recording)
    completion(Timeline(entries: [entry], policy: .never))
  }
}

/// A camera shutter: an emerald circle you press, a red square while it runs.
///
/// Both the shape AND the colour change, deliberately. Colour alone fails for colour-blind users,
/// and iOS tints Lock Screen widgets to the wallpaper - so red is not guaranteed to survive there.
/// Circle-to-square carries the state on its own if the colour is lost.
private struct RecordGlyph: View {
  let recording: Bool
  var diameter: CGFloat = 62
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    ZStack {
      Circle()
        .strokeBorder(
          recording ? Tokens.rec(scheme) : Color.primary.opacity(0.18),
          lineWidth: 2
        )
      if recording {
        RoundedRectangle(cornerRadius: diameter * 0.08, style: .continuous)
          .fill(Tokens.rec(scheme))
          .frame(width: diameter * 0.39, height: diameter * 0.39)
      } else {
        Circle()
          .fill(Tokens.idle)
          .frame(width: diameter * 0.65, height: diameter * 0.65)
      }
    }
    .frame(width: diameter, height: diameter)
  }
}

// MARK: - Home Screen (small square)

private struct HomeTile: View {
  let recording: Bool
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    // The whole tile is the button, so there is no dead area to tap by mistake.
    //
    // The intent depends on the state, and the asymmetry is the point: a red square means stop
    // everywhere, so tapping it has to stop. Stop can run without opening the app because the app
    // is already alive holding the audio session; Start cannot, because iOS will not activate a
    // record session from a widget's process. Each side does the most iOS permits.
    Group {
      if recording {
        Button(intent: StopRecordingIntent()) { label }
      } else {
        Button(intent: StartRecordingIntent()) { label }
      }
    }
    .buttonStyle(.plain)
  }

  private var label: some View {
    VStack(spacing: 12) {
      RecordGlyph(recording: recording)
      Text(recording ? "TAP TO STOP" : "TAP TO RECORD")
        .font(Tokens.mono(11))
        .tracking(1.3)
        .foregroundStyle(recording ? Tokens.rec(scheme) : Color.secondary)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

// MARK: - Lock Screen (circular)

private struct LockTile: View {
  let recording: Bool

  var body: some View {
    // Same state-dependent intent as the Home tile: the stop symbol has to stop.
    Group {
      if recording {
        Button(intent: StopRecordingIntent()) { glyph }
      } else {
        Button(intent: StartRecordingIntent()) { glyph }
      }
    }
    .buttonStyle(.plain)
  }

  private var glyph: some View {
    ZStack {
      AccessoryWidgetBackground()
      // Circle-to-square, via symbols that survive the system's wallpaper tinting.
      Image(systemName: recording ? "stop.circle.fill" : "record.circle")
        .font(.system(size: 22, weight: .regular))
    }
  }
}

// MARK: - Widget

struct RecorderHomeWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: RecorderSnapshot.widgetKind, provider: RecorderProvider()) { entry in
      TileForFamily(recording: entry.recording)
    }
    .configurationDisplayName("Record")
    .description("Start an Off Grid recording, and see when one is running.")
    .supportedFamilies([.systemSmall, .accessoryCircular])
  }
}

/// One view that picks its layout from the family it was rendered into, so the Home Screen and
/// Lock Screen tiles stay one component rather than two that drift apart.
private struct TileForFamily: View {
  let recording: Bool
  @Environment(\.widgetFamily) private var family

  var body: some View {
    switch family {
    case .accessoryCircular:
      LockTile(recording: recording)
    default:
      HomeTile(recording: recording)
        .containerBackground(.background, for: .widget)
    }
  }
}
