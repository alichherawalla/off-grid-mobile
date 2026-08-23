import Foundation
import Network

/// Network.framework read sizes for the two HTTP phases.
///
/// The body is authenticated one complete frame at a time. Returning smaller pieces only adds
/// callbacks and copies because no piece can be opened or written before the rest of its frame.
enum BlobReceiveWindow {
  static let header = (minimum: 1, maximum: 1 << 16)

  static func body(sealedBytesRemaining: Int) -> (minimum: Int, maximum: Int) {
    let exact = max(1, sealedBytesRemaining)
    return (minimum: exact, maximum: exact)
  }
}

/// Where this iPhone accepts the bytes of one transfer.
///
/// The receiving device hosts, so the sender only has to make an outbound connection - the shape that
/// works between two phones on a home network with no port forwarding and nothing configured. It
/// speaks one PUT with one token, and answers every way of being wrong with the same 404.
///
/// It listens only while a transfer is pending and stops as soon as none is. An open port with no
/// purpose is only exposure.
final class BlobChannelServer {
  struct Pending {
    let token: String
    let destinationPath: String
    let fileSize: Int
    let key: Data
    let nonce: Data
    /// The frame size, passed down rather than restated, so one place decides it for all platforms.
    let frameBytes: Int
    /// Payload bytes already on disk; the arriving stream continues from here.
    let offset: Int
    let expiresAt: Date
  }

  /// State lives on one queue; the network lives on another.
  ///
  /// They must be different. A listener started on the same serial queue that a caller is blocking
  /// inside cannot report that it is ready - the report is queued behind the block waiting for it -
  /// and the port is not knowable until it does. That deadlock is silent: no error, no endpoint, a
  /// transfer that simply never begins.
  private let queue = DispatchQueue(label: "ai.offgridmobile.blob-channel")
  private let network = DispatchQueue(label: "ai.offgridmobile.blob-channel.network")
  private let onProgress: (String, Int) -> Void
  private let onOutcome: (String, Bool) -> Void
  private var listener: NWListener?
  private var pending: [String: Pending] = [:]
  /// Live connections, held for as long as they are reading.
  ///
  /// Without this the session is deallocated the moment `accept` returns, its receive callback finds
  /// nothing to call back into, and the socket simply sits open until the sender gives up. That failure
  /// looks exactly like a network problem and is not one.
  private var sessions: [ObjectIdentifier: Session] = [:]

  /// `onOutcome` matters as much as progress: a payload that fails to verify has to SAY so, or the
  /// receiving side sits waiting for a transfer that is never going to arrive.
  init(
    onProgress: @escaping (String, Int) -> Void,
    onOutcome: @escaping (String, Bool) -> Void
  ) {
    self.onProgress = onProgress
    self.onOutcome = onOutcome
  }

  func offer(requestId: String, transfer: Pending) {
    queue.sync { pending[requestId] = transfer }
  }

  func release(requestId: String) {
    queue.sync {
      pending.removeValue(forKey: requestId)
      if pending.isEmpty { stopLocked() }
    }
  }

  /// The port this device is listening on, starting to listen if it is not already.
  func ensureListening() throws -> UInt16 {
    if let port = queue.sync(execute: { listener?.port?.rawValue }) { return port }
    let started = try NWListener(using: .tcp)
    started.newConnectionHandler = { [weak self] connection in
      self?.accept(connection)
    }
    let ready = DispatchSemaphore(value: 0)
    started.stateUpdateHandler = { state in
      switch state {
      case .ready, .failed, .cancelled: ready.signal()
      default: break
      }
    }
    started.start(queue: network)
    // The port is not knowable until the listener is ready, and the url needs it now.
    _ = ready.wait(timeout: .now() + 5)
    guard let port = started.port?.rawValue else {
      started.cancel()
      throw BlobFrameCipher.Failure.malformed
    }
    queue.sync { listener = started }
    return port
  }

  private func stopLocked() {
    listener?.cancel()
    listener = nil
  }

  private func accept(_ connection: NWConnection) {
    trace("accepted a connection")
    let session = Session(connection: connection, server: self)
    queue.sync { sessions[ObjectIdentifier(session)] = session }
    connection.start(queue: network)
    session.read()
  }

  fileprivate func forget(_ session: Session) {
    queue.sync { _ = sessions.removeValue(forKey: ObjectIdentifier(session)) }
  }

  /// Claim a transfer for this connection. A token is spent on use: a payload arrives once.
  fileprivate func claim(_ head: BlobChannelSupport.Head) -> Pending? {
    queue.sync {
      guard let transfer = pending[head.requestId], transfer.expiresAt > Date() else { return nil }
      guard BlobChannelSupport.matches(head.token, transfer.token) else { return nil }
      pending.removeValue(forKey: head.requestId)
      return transfer
    }
  }

  fileprivate func report(_ requestId: String, _ bytes: Int) {
    onProgress(requestId, bytes)
  }

  fileprivate func settle(_ requestId: String, _ landed: Bool) {
    onOutcome(requestId, landed)
  }

  fileprivate func finishedAll() -> Bool {
    queue.sync {
      if pending.isEmpty {
        stopLocked()
        return true
      }
      return false
    }
  }

  /// One connection: read the head, then decipher the body straight to disk.
  fileprivate final class Session {
    private let connection: NWConnection
    private weak var server: BlobChannelServer?
    private var buffer = Data()
    private var head: BlobChannelSupport.Head?
    private var transfer: Pending?
    private var cipher: BlobFrameCipher?
    private var file: FileHandle?
    private var written = 0
    private var frame = 0
    private var held = Data()

    init(connection: NWConnection, server: BlobChannelServer) {
      self.connection = connection
      self.server = server
    }

    func read() {
      let window = nextReceiveWindow()
      connection.receive(
        minimumIncompleteLength: window.minimum,
        maximumLength: window.maximum
      ) {
        [weak self] data, _, complete, error in
        guard let self else { return }
        trace("received \(data?.count ?? 0) bytes complete=\(complete) error=\(String(describing: error))")
        if let data, !data.isEmpty { self.consume(data) }
        if error != nil { return self.fail() }
        if complete { return self.finish() }
        if self.connection.state == .ready || self.transfer != nil { self.read() }
      }
    }

    private func nextReceiveWindow() -> (minimum: Int, maximum: Int) {
      guard let cipher, frame < cipher.frameCount else { return BlobReceiveWindow.header }
      return BlobReceiveWindow.body(
        sealedBytesRemaining: cipher.sealedLength(frame) - held.count)
    }

    private func consume(_ data: Data) {
      if head == nil {
        buffer.append(data)
        guard let boundary = buffer.range(of: Data("\r\n\r\n".utf8)) else { return }
        let headText = String(decoding: buffer[buffer.startIndex..<boundary.lowerBound])
        let body = buffer[boundary.upperBound...]
        buffer = Data()
        let parsed = BlobChannelSupport.parseHead(headText)
        trace("head: \(headText.prefix(120)) parsed=\(parsed != nil)")
        guard let parsed, let claimed = server?.claim(parsed) else {
          trace("refusing: parsed=\(parsed != nil)")
          return refuse()
        }
        head = parsed
        transfer = claimed
        guard claimed.frameBytes > 0, claimed.offset >= 0, claimed.offset <= claimed.fileSize,
          claimed.offset == claimed.fileSize || claimed.offset % claimed.frameBytes == 0,
          let frames = try? BlobFrameCipher(
            key: claimed.key, nonce: claimed.nonce, fileSize: claimed.fileSize,
            frameBytes: claimed.frameBytes),
          parsed.contentLength == frames.sealedRemainder(from: claimed.offset)
        else {
          server?.settle(parsed.requestId, false)
          return refuse()
        }
        if !start(claimed, frames: frames) { return fail() }
        if parsed.expectsContinue { send("HTTP/1.1 100 Continue\r\n\r\n", close: false) }
        if !body.isEmpty { write(Data(body)) }
        return
      }
      write(data)
    }

    private func start(_ transfer: Pending, frames: BlobFrameCipher) -> Bool {
      let path = transfer.destinationPath
      try? FileManager.default.createDirectory(
        at: URL(fileURLWithPath: path).deletingLastPathComponent(),
        withIntermediateDirectories: true)
      if transfer.offset == 0 || !FileManager.default.fileExists(atPath: path) {
        FileManager.default.createFile(atPath: path, contents: nil)
      }
      guard let handle = FileHandle(forWritingAtPath: path) else { return false }
      // Resuming appends: what is already here was verified when it arrived, so it stays and the
      // count continues from it. Whatever lay past the resume point was part of a frame that never
      // finished arriving, so it goes - the side that writes the payload owns what is in it.
      if transfer.offset > 0 {
        try? handle.truncate(atOffset: UInt64(transfer.offset))
        handle.seek(toFileOffset: UInt64(transfer.offset))
        written = transfer.offset
        frame = frames.frame(at: transfer.offset)
      }
      file = handle
      cipher = frames
      held.reserveCapacity(transfer.frameBytes + BlobFrameCipher.tagBytes)
      return true
    }

    /// Nothing reaches the file until the frame it belongs to has verified, so a payload that was
    /// tampered with or cut short fails instead of landing as a plausible-looking file.
    private func write(_ data: Data) {
      guard let head, let transfer, let cipher, let file else { return }
      var cursor = data.startIndex
      while cursor < data.endIndex, frame < cipher.frameCount {
        let needed = cipher.sealedLength(frame) - held.count
        let available = data.distance(from: cursor, to: data.endIndex)
        let count = min(needed, available)
        let end = data.index(cursor, offsetBy: count)
        held.append(contentsOf: data[cursor..<end])
        cursor = end

        if held.count == cipher.sealedLength(frame) {
          guard let plain = try? cipher.open(held, index: frame) else { return fail() }
          file.write(plain)
          written += plain.count
          frame += 1
          held.removeAll(keepingCapacity: true)
          server?.report(head.requestId, min(written, transfer.fileSize))
        }
      }
      if frame >= cipher.frameCount { finish() }
    }

    private func finish() {
      guard let transfer, let cipher, let file else { return refuse() }
      defer { self.file = nil }
      file.closeFile()
      do {
        // Every frame verified as it arrived; what is left is that the payload is whole.
        guard frame == cipher.frameCount, held.isEmpty else {
          throw BlobFrameCipher.Failure.tagMismatch
        }
        let landed = (try? FileManager.default.attributesOfItem(atPath: transfer.destinationPath))?[
          .size] as? Int
        guard landed == transfer.fileSize else { throw BlobFrameCipher.Failure.tagMismatch }
        send("HTTP/1.1 200 OK\r\ncontent-length: 0\r\nconnection: close\r\n\r\n", close: true)
        server?.settle(head?.requestId ?? "", true)
      } catch {
        // Never leave something that looks like the file.
        try? FileManager.default.removeItem(atPath: transfer.destinationPath)
        send(
          "HTTP/1.1 500 Internal Server Error\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
          close: true)
        server?.settle(head?.requestId ?? "", false)
      }
      _ = server?.finishedAll()
    }

    private func refuse() {
      send("HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n", close: true)
    }

    private func fail() {
      if let path = transfer?.destinationPath { try? FileManager.default.removeItem(atPath: path) }
      server?.settle(head?.requestId ?? "", false)
      send(
        "HTTP/1.1 500 Internal Server Error\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
        close: true)
    }

    private func send(_ text: String, close: Bool) {
      connection.send(
        content: Data(text.utf8),
        completion: .contentProcessed { [weak self] _ in
          guard close, let self else { return }
          self.connection.cancel()
          self.server?.forget(self)
        })
    }
  }
}

/// Only for the command-line harness: the app never sets this.
func trace(_ message: String) {
  guard ProcessInfo.processInfo.environment["BLOB_TRACE"] != nil else { return }
  FileHandle.standardError.write(Data("[blob] \(message)\n".utf8))
}

extension String {
  fileprivate init(decoding slice: Data.SubSequence) {
    self = String(data: Data(slice), encoding: .utf8) ?? ""
  }
}
