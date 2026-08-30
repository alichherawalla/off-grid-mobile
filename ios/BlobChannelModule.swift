import Foundation
import React

/// The fast transfer path, as this iPhone implements it.
///
/// JavaScript decides whether to use it and mints the key material; this module moves the bytes. Both
/// halves stream with the cipher inline, so a model larger than the phone's memory transfers without
/// ever being held in it, and the thread that draws the screen never sees a byte.
///
/// Progress arrives as an event rather than in the promise, because the point of progress is to be
/// visible while the work is still running.
@objc(BlobChannelModule)
final class BlobChannelModule: RCTEventEmitter {
  private static let progressEvent = "SyncBlobProgress"
  private static let outcomeEvent = "SyncBlobOutcome"

  private lazy var server = BlobChannelServer(
    onProgress: { [weak self] requestId, bytes in
      self?.report(requestId: requestId, bytes: bytes)
    },
    onOutcome: { [weak self] requestId, landed in
      guard let self, self.bridge != nil else { return }
      self.sendEvent(
        withName: Self.outcomeEvent, body: ["requestId": requestId, "landed": landed])
    })
  private let work = DispatchQueue(label: "ai.offgridmobile.blob-channel-module", attributes: .concurrent)

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String] { [Self.progressEvent, Self.outcomeEvent] }

  /// The address every native sync listener on this phone can accept connections on.
  @objc(lanAddress:withRejecter:)
  func lanAddress(
    resolve: @escaping RCTPromiseResolveBlock,
    reject _: @escaping RCTPromiseRejectBlock
  ) {
    work.async { resolve(BlobChannelSupport.lanAddress()) }
  }

  /// All current IPv4 interfaces; the shared QR projector decides which routes are safe.
  @objc(interfaceCandidates:withRejecter:)
  func interfaceCandidates(
    resolve: @escaping RCTPromiseResolveBlock,
    reject _: @escaping RCTPromiseRejectBlock
  ) {
    work.async {
      resolve(BlobChannelSupport.interfaceCandidates().map { candidate in
        ["host": candidate.host, "interfaceName": candidate.interfaceName]
      })
    }
  }

  /// Offer an endpoint for one transfer, and answer the url a peer should stream to.
  ///
  /// Resolves with nothing when this device has no address on a shared network: there is no endpoint
  /// to offer, and the caller falls back to the path that always works.
  @objc(serve:resolve:withRejecter:)
  func serve(
    _ options: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    work.async {
      guard let requestId = options["requestId"] as? String,
        let token = options["token"] as? String,
        let destination = options["destinationPath"] as? String,
        let key = Self.decode(options["keyBase64"]),
        let nonce = Self.decode(options["nonceBase64"])
      else { return reject("blob_channel_failed", "the transfer is missing its material", nil) }
      guard let address = BlobChannelSupport.lanAddress() else { return resolve(nil) }
      do {
        let port = try self.server.ensureListening()
        self.server.offer(
          requestId: requestId,
          transfer: .init(
            token: token,
            destinationPath: destination,
            fileSize: (options["fileSize"] as? NSNumber)?.intValue ?? 0,
            key: key,
            nonce: nonce,
            frameBytes: (options["frameBytes"] as? NSNumber)?.intValue ?? 0,
            offset: (options["offset"] as? NSNumber)?.intValue ?? 0,
            expiresAt: Date().addingTimeInterval(
              ((options["ttlMs"] as? NSNumber)?.doubleValue ?? 0) / 1000)))
        let encoded =
          requestId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? requestId
        resolve(["url": "http://\(address):\(port)/blob/\(encoded)"])
      } catch {
        reject("blob_channel_failed", error.localizedDescription, error)
      }
    }
  }

  /// Stop serving an endpoint, whether its transfer completed or not.
  @objc(release:)
  func release(_ requestId: String) {
    server.release(requestId: requestId)
  }

  /// Stop sending a payload that is still going out.
  @objc(abort:)
  func abort(_ requestId: String) {
    BlobChannelUploader.abort(requestId)
  }

  /// Send a local file through the endpoint a peer offered, sealing it on the way out.
  @objc(stream:resolve:withRejecter:)
  func stream(
    _ options: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    work.async {
      guard let requestId = options["requestId"] as? String,
        let source = options["sourcePath"] as? String,
        let text = options["url"] as? String, let url = URL(string: text),
        let token = options["token"] as? String,
        let key = Self.decode(options["keyBase64"]),
        let nonce = Self.decode(options["nonceBase64"])
      else { return reject("blob_channel_failed", "the transfer is missing its material", nil) }
      do {
        let sent = try BlobChannelUploader.upload(
          .init(
            requestId: requestId, sourcePath: source, url: url, token: token, key: key,
            nonce: nonce, frameBytes: (options["frameBytes"] as? NSNumber)?.intValue ?? 0,
            offset: (options["offset"] as? NSNumber)?.intValue ?? 0)
        ) { [weak self] bytes in
          self?.report(requestId: requestId, bytes: bytes)
        }
        resolve(["bytes": sent])
      } catch {
        reject("blob_channel_failed", error.localizedDescription, error)
      }
    }
  }

  private func report(requestId: String, bytes: Int) {
    guard bridge != nil else { return }
    sendEvent(withName: Self.progressEvent, body: ["requestId": requestId, "bytes": bytes])
  }

  private static func decode(_ value: Any?) -> Data? {
    guard let text = value as? String else { return nil }
    return Data(base64Encoded: text)
  }
}
