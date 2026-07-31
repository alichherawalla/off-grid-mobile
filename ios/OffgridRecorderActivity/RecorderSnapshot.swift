import Foundation

/**
 * The one piece of state the app shares with the widget, and the only channel it travels through.
 *
 * The widget runs in its own process with its own sandbox, so it cannot read Zustand, AsyncStorage
 * or anything else the app holds in memory. An App Group container is the shared ground: the app
 * writes this file on a recorder transition, the widget reads it when the system renders the tile.
 *
 * Kept deliberately tiny. The tile only has to answer "is it recording?", and every field added
 * here is another thing that can go stale on a process kill.
 *
 * Member of BOTH targets, so the path, the group id and the JSON shape are defined once. Two
 * copies of a file path is how the writer silently starts writing somewhere the reader never looks.
 */
struct RecorderSnapshot: Codable {

  /// True while the mic is open.
  var recording: Bool

  /// When the app last wrote this, so a reader can tell a fresh snapshot from an abandoned one.
  var updatedAt: Date

  // MARK: - Shared constants

  /// Must match both targets' entitlements.
  static let appGroupId = "group.ai.offgridmobile"

  /// The widget kind, used by the app to reload exactly this widget rather than all of them.
  static let widgetKind = "OffgridRecorderTile"

  private static let fileName = "recorder-snapshot.json"

  private static var fileURL: URL? {
    FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: appGroupId)?
      .appendingPathComponent(fileName)
  }

  // MARK: - Read / write

  /// Write the snapshot. Returns false when the App Group is unavailable, which means the
  /// entitlement is missing or misspelled - the one failure worth telling the caller about.
  static func write(_ snapshot: RecorderSnapshot) -> Bool {
    guard let url = fileURL else { return false }
    do {
      let encoder = JSONEncoder()
      encoder.dateEncodingStrategy = .iso8601
      try encoder.encode(snapshot).write(to: url, options: .atomic)
      return true
    } catch {
      NSLog("[RecorderSnapshot] write failed: \(error.localizedDescription)")
      return false
    }
  }

  /// Read the snapshot. Returns a not-recording default when the file is missing or unreadable,
  /// because the tile must render something and "idle" is the safe thing to claim: it invites a
  /// tap rather than implying a session that may not exist.
  static func read() -> RecorderSnapshot {
    let idle = RecorderSnapshot(recording: false, updatedAt: Date(timeIntervalSince1970: 0))
    guard let url = fileURL, let data = try? Data(contentsOf: url) else { return idle }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return (try? decoder.decode(RecorderSnapshot.self, from: data)) ?? idle
  }
}
