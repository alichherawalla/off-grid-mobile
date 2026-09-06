import Foundation

/// The small shared pieces of the fast transfer path on this device.
enum BlobChannelSupport {
  struct InterfaceCandidate: Equatable {
    let interfaceName: String
    let host: String
    let isUp: Bool
    let isLoopback: Bool
    let isLinkLocal: Bool
    let isAnyLocal: Bool
    let isMulticast: Bool
  }

  /// One transfer's request head: the line and the three headers that decide anything.
  struct Head {
    let requestId: String
    let token: String
    let contentLength: Int
    let expectsContinue: Bool
  }

  static let pathPrefix = "/blob/"

  /// Parse a PUT head, or nothing. Anything unexpected is nothing: this speaks one request shape.
  static func parseHead(_ text: String) -> Head? {
    let lines = text.components(separatedBy: "\r\n")
    let requestLine = lines.first?.components(separatedBy: " ") ?? []
    guard requestLine.count >= 2, requestLine[0] == "PUT" else { return nil }
    let path = requestLine[1]
    guard path.hasPrefix(pathPrefix) else { return nil }
    var headers: [String: String] = [:]
    for line in lines.dropFirst() {
      guard let separator = line.firstIndex(of: ":") else { continue }
      let name = line[line.startIndex..<separator].lowercased().trimmingCharacters(
        in: .whitespaces)
      let value = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
      headers[name] = value
    }
    guard let length = Int(headers["content-length"] ?? "") else { return nil }
    let encodedId = String(path.dropFirst(pathPrefix.count))
    return Head(
      requestId: encodedId.removingPercentEncoding ?? encodedId,
      token: (headers["authorization"] ?? "").replacingOccurrences(of: "Bearer ", with: "")
        .trimmingCharacters(in: .whitespaces),
      contentLength: length,
      expectsContinue: (headers["expect"] ?? "").contains("100-continue")
    )
  }

  /// Constant time, so a wrong token says nothing about how wrong it was.
  static func matches(_ presented: String, _ expected: String) -> Bool {
    let left = Array(presented.utf8)
    let right = Array(expected.utf8)
    guard left.count == right.count else { return false }
    var difference: UInt8 = 0
    for index in left.indices { difference |= left[index] ^ right[index] }
    return difference == 0
  }

  /// This device's address on the network it shares with the user's other devices.
  static func lanAddress() -> String? {
    var first: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&first) == 0, let start = first else { return nil }
    defer { freeifaddrs(first) }
    var candidate: String?
    for pointer in sequence(first: start, next: { $0.pointee.ifa_next }) {
      let flags = Int32(pointer.pointee.ifa_flags)
      guard flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 else { continue }
      guard pointer.pointee.ifa_addr.pointee.sa_family == UInt8(AF_INET) else { continue }
      var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      guard
        getnameinfo(
          pointer.pointee.ifa_addr, socklen_t(pointer.pointee.ifa_addr.pointee.sa_len), &host,
          socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0
      else { continue }
      let address = String(cString: host)
      // Only an address the user's other devices can dial, which is what the shared rules admit.
      if address.hasPrefix("10.") || address.hasPrefix("192.168.")
        || address.range(of: "^172\\.(1[6-9]|2[0-9]|3[01])\\.", options: .regularExpression) != nil
      {
        candidate = candidate ?? address
        // Wi-Fi first when there is a choice: the peer is on the same network, not on cellular.
        if String(cString: pointer.pointee.ifa_name) == "en0" { return address }
      }
    }
    return candidate
  }

  /// Current numeric IPv4 interfaces. Shared sync code owns route safety and classification.
  static func interfaceCandidates() -> [InterfaceCandidate] {
    var first: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&first) == 0, let start = first else { return [] }
    defer { freeifaddrs(first) }
    var records: [InterfaceCandidate] = []
    for pointer in sequence(first: start, next: { $0.pointee.ifa_next }) {
      let entry = pointer.pointee
      guard let address = entry.ifa_addr, address.pointee.sa_family == UInt8(AF_INET) else {
        continue
      }
      var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      guard
        getnameinfo(
          address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0,
          NI_NUMERICHOST) == 0
      else { continue }
      let text = String(cString: host)
      let flags = Int32(entry.ifa_flags)
      records.append(
        InterfaceCandidate(
          interfaceName: String(cString: entry.ifa_name),
          host: text,
          isUp: flags & IFF_UP != 0,
          isLoopback: flags & IFF_LOOPBACK != 0 || text.hasPrefix("127."),
          isLinkLocal: text.hasPrefix("169.254."),
          isAnyLocal: text == "0.0.0.0",
          isMulticast: isIPv4Multicast(text)))
    }
    return usableInterfaceCandidates(records)
  }

  static func usableInterfaceCandidates(
    _ records: [InterfaceCandidate]
  ) -> [InterfaceCandidate] {
    var seen = Set<String>()
    return records
      .filter { record in
        record.isUp &&
          !record.isLoopback &&
          !record.isLinkLocal &&
          !record.isAnyLocal &&
          !record.isMulticast
      }
      .filter { record in seen.insert("\(record.interfaceName)\u{0}\(record.host)").inserted }
      .sorted { ($0.interfaceName, $0.host) < ($1.interfaceName, $1.host) }
  }

  private static func isIPv4Multicast(_ host: String) -> Bool {
    guard let firstOctet = Int(host.split(separator: ".", maxSplits: 1)[0]) else { return true }
    return (224...239).contains(firstOctet)
  }
}
