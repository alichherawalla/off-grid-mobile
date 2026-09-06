import Foundation
import Network

/// Sending a payload to the endpoint the other device offered.
///
/// The file is read a block at a time, sealed, and handed to the socket, so nothing is staged and
/// nothing is copied: a model larger than this phone's memory moves without ever being held in it.
/// The length is declared up front, which is what lets the receiver authorise before a byte arrives.
final class BlobChannelUploader {
  /// Uploads still in flight, so cancel can reach the bytes rather than only stop watching them.
  private static let live = LiveUploads()

  /// Stop an upload that is still going. Cancelling the connection makes the next send fail, which
  /// unwinds the loop: without it a cancelled transfer keeps sending a model nobody is waiting for.
  static func abort(_ requestId: String) {
    live.take(requestId)?.cancel()
  }

  private final class LiveUploads {
    private let queue = DispatchQueue(label: "ai.offgridmobile.blob-uploads")
    private var connections: [String: NWConnection] = [:]

    func hold(_ requestId: String, _ connection: NWConnection) {
      queue.sync { connections[requestId] = connection }
    }

    func take(_ requestId: String) -> NWConnection? {
      queue.sync { connections.removeValue(forKey: requestId) }
    }
  }

  struct Request {
    let requestId: String
    let sourcePath: String
    let url: URL
    let token: String
    let key: Data
    let nonce: Data
    /// The frame size, passed down rather than restated, so one place decides it for all platforms.
    let frameBytes: Int
    /// Payload bytes the receiver already holds. Nothing before this is read or sent again.
    let offset: Int
  }

  /// Move the file. Answers the number of payload bytes sent, or throws.
  static func upload(
    _ request: Request,
    onProgress: @escaping (Int) -> Void
  ) throws -> Int {
    guard let host = request.url.host, let port = request.url.port else {
      throw failure("the endpoint url has no host and port")
    }
    guard let file = FileHandle(forReadingAtPath: request.sourcePath) else {
      throw failure("there is nothing readable at \(request.sourcePath)")
    }
    guard
      let size = (try? FileManager.default.attributesOfItem(atPath: request.sourcePath))?[.size]
        as? Int, size > 0
    else { throw failure("the file at \(request.sourcePath) has no size") }
    defer { file.closeFile() }

    let cipher = try BlobFrameCipher(
      key: request.key, nonce: request.nonce, fileSize: size, frameBytes: request.frameBytes)
    let connection = NWConnection(
      host: NWEndpoint.Host(host),
      port: NWEndpoint.Port(integerLiteral: UInt16(port)),
      using: .tcp)
    let queue = DispatchQueue(label: "ai.offgridmobile.blob-upload")
    let ready = DispatchSemaphore(value: 0)
    var problem: Error?
    connection.stateUpdateHandler = { state in
      switch state {
      case .ready: ready.signal()
      case .failed(let error):
        problem = error
        ready.signal()
      case .cancelled:
        ready.signal()
      default: break
      }
    }
    connection.start(queue: queue)
    try waitForSignal(
      ready,
      timeout: .seconds(15),
      message: "the endpoint did not become reachable"
    )
    if let problem { throw problem }
    guard connection.state == .ready else {
      throw failure("the endpoint did not become ready")
    }
    live.hold(request.requestId, connection)
    defer {
      _ = live.take(request.requestId)
      connection.cancel()
    }

    try send(
      head(request, bodyLength: cipher.sealedRemainder(from: request.offset)),
      over: connection)
    var sent = request.offset
    // Skip what the receiver already has rather than re-reading it from disk.
    if request.offset > 0 { file.seek(toFileOffset: UInt64(request.offset)) }
    // One frame at a time: read it, seal it, hand it to the socket. Memory holds a frame, never a file.
    for index in cipher.frame(at: request.offset)..<cipher.frameCount {
      // Read until the frame is full: a single read is allowed to return less than it was asked for,
      // and treating a short read as the end of the file would seal the wrong bytes.
      var plain = Data()
      while plain.count < cipher.frameLength(index) {
        let block = file.readData(ofLength: cipher.frameLength(index) - plain.count)
        if block.isEmpty { break }
        plain.append(block)
      }
      guard plain.count == cipher.frameLength(index) else {
        throw failure("frame \(index) read short: \(plain.count) of \(cipher.frameLength(index))")
      }
      try send(try cipher.seal(plain, index: index), over: connection)
      sent += plain.count
      onProgress(sent)
    }
    try expectSuccess(from: connection)
    return sent
  }

  private static func failure(_ message: String) -> NSError {
    NSError(
      domain: "ai.offgridmobile.blob", code: 2,
      userInfo: [NSLocalizedDescriptionKey: message])
  }

  private static func head(_ request: Request, bodyLength: Int) -> Data {
    let path = request.url.path
    let lines = [
      "PUT \(path) HTTP/1.1",
      "host: \(request.url.host ?? ""):\(request.url.port ?? 0)",
      "authorization: Bearer \(request.token)",
      "content-type: application/octet-stream",
      "content-length: \(bodyLength)",
      "", "",
    ]
    return Data(lines.joined(separator: "\r\n").utf8)
  }

  /// One block, sent and confirmed before the next is read - so memory holds one block, not a file.
  private static func send(_ data: Data, over connection: NWConnection) throws {
    if data.isEmpty { return }
    let done = DispatchSemaphore(value: 0)
    var problem: Error?
    connection.send(
      content: data,
      completion: .contentProcessed { error in
        problem = error
        done.signal()
      })
    try waitForSignal(
      done,
      timeout: .seconds(60),
      message: "the endpoint stopped accepting the payload"
    )
    if let problem { throw problem }
  }

  private static func expectSuccess(from connection: NWConnection) throws {
    let done = DispatchSemaphore(value: 0)
    var answer = ""
    connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 12) { data, _, _, _ in
      answer = String(data: data ?? Data(), encoding: .utf8) ?? ""
      done.signal()
    }
    try waitForSignal(
      done,
      timeout: .seconds(60),
      message: "the endpoint did not confirm the payload"
    )
    guard answer.hasPrefix("HTTP/1.1 200") else {
      throw NSError(
        domain: "ai.offgridmobile.blob", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "the endpoint answered \(answer.prefix(32))"])
    }
  }

  /// A network deadline is a failure, not a successful empty response.
  ///
  /// `DispatchSemaphore.wait` reports a timeout as a return value. Ignoring that value made an
  /// unreachable endpoint look ready, so a transfer stayed at zero bytes until its manager deadline.
  /// Throwing here lets the shared transfer manager use its slower fallback route while the peer is
  /// still connected.
  static func waitForSignal(
    _ semaphore: DispatchSemaphore,
    timeout: DispatchTimeInterval,
    message: String
  ) throws {
    guard semaphore.wait(timeout: .now() + timeout) == .success else {
      throw failure(message)
    }
  }
}
