import Foundation
import MultipeerConnectivity
import React

private let proximityServiceType = "offgrid-sync"
private let proximityConnectTimeout: TimeInterval = 12

/// Owns the advertiser's active state independently from browsing and sessions.
/// The closures keep MultipeerConnectivity at the native boundary while making
/// stop, restart, and advertiser replacement deterministic in native tests.
final class ProximityAdvertisingController {
  private var startPeer: (() -> Void)?
  private var stopPeer: (() -> Void)?
  private(set) var isAdvertising = false

  func install(start: @escaping () -> Void, stop: @escaping () -> Void) {
    let shouldRestart = isAdvertising
    if shouldRestart { stopPeer?() }
    startPeer = start
    stopPeer = stop
    if shouldRestart { startPeer?() }
  }

  @discardableResult
  func start() -> Bool {
    guard let startPeer else { return false }
    if !isAdvertising {
      startPeer()
      isAdvertising = true
    }
    return true
  }

  func stop() {
    guard isAdvertising else { return }
    stopPeer?()
    isAdvertising = false
  }

  func clear() {
    stop()
    startPeer = nil
    stopPeer = nil
  }
}

private struct ProximityDevice {
  let id: String
  let name: String
  let platform: String
  let version: String

  var dictionary: [String: Any] {
    [
      "id": id,
      "name": name,
      "platform": platform,
      "version": version,
      "host": "",
      "port": 0,
    ]
  }

  var discoveryInfo: [String: String] {
    [
      "id": id,
      "name": name,
      "platform": platform,
      "version": version,
    ]
  }

  static func parse(_ value: [String: Any]) -> ProximityDevice? {
    guard
      let id = value["id"] as? String,
      !id.isEmpty,
      let name = value["name"] as? String,
      !name.isEmpty,
      let platform = value["platform"] as? String,
      !platform.isEmpty
    else {
      return nil
    }
    return ProximityDevice(
      id: id,
      name: name,
      platform: platform,
      version: value["version"] as? String ?? "1"
    )
  }

  static func parseDiscovery(_ value: [String: String]?) -> ProximityDevice? {
    guard let value else { return nil }
    return parse(value)
  }
}

private final class ProximitySession {
  let id = UUID().uuidString
  let remote: ProximityDevice
  let peer: MCPeerID
  let session: MCSession
  let outbound: Bool
  var resolve: RCTPromiseResolveBlock?
  var reject: RCTPromiseRejectBlock?
  var timeout: DispatchWorkItem?

  init(
    remote: ProximityDevice,
    peer: MCPeerID,
    localPeer: MCPeerID,
    outbound: Bool,
    resolve: RCTPromiseResolveBlock? = nil,
    reject: RCTPromiseRejectBlock? = nil
  ) {
    self.remote = remote
    self.peer = peer
    self.outbound = outbound
    self.resolve = resolve
    self.reject = reject
    session = MCSession(
      peer: localPeer,
      securityIdentity: nil,
      encryptionPreference: .required
    )
  }
}

@objc(SyncProximityModule)
final class SyncProximityModule: RCTEventEmitter {
  private let stateQueue = DispatchQueue(label: "ai.offgrid.sync.proximity")
  private var localDevice: ProximityDevice?
  private var localPeer: MCPeerID?
  private var advertiser: MCNearbyServiceAdvertiser?
  private let advertising = ProximityAdvertisingController()
  private var browser: MCNearbyServiceBrowser?
  private var peersByDeviceId: [String: MCPeerID] = [:]
  private var devicesByPeerName: [String: ProximityDevice] = [:]
  private var sessionsById: [String: ProximitySession] = [:]
  private var sessionsByObject: [ObjectIdentifier: ProximitySession] = [:]

  @objc
  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String] {
    [
      "SyncProximityPeerFound",
      "SyncProximityPeerLost",
      "SyncProximityConnectionOpened",
      "SyncProximityData",
      "SyncProximityConnectionClosed",
    ]
  }

  @objc
  func start(
    _ device: [String: Any],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    stateQueue.async { [weak self] in
      guard let self else { return }
      guard let parsed = ProximityDevice.parse(device) else {
        reject("invalid_device", "Sync proximity needs a valid local device.", nil)
        return
      }
      stopInternal(notifyConnections: true)

      let displayName = String(parsed.id.prefix(60))
      let peer = MCPeerID(displayName: displayName)
      let advertiser = MCNearbyServiceAdvertiser(
        peer: peer,
        discoveryInfo: parsed.discoveryInfo,
        serviceType: proximityServiceType
      )
      let browser = MCNearbyServiceBrowser(
        peer: peer,
        serviceType: proximityServiceType
      )
      localDevice = parsed
      localPeer = peer
      self.advertiser = advertiser
      self.browser = browser
      advertiser.delegate = self
      browser.delegate = self
      advertising.install(
        start: { advertiser.startAdvertisingPeer() },
        stop: { advertiser.stopAdvertisingPeer() }
      )
      browser.startBrowsingForPeers()
      resolve(nil)
    }
  }

  @objc
  func stop(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    stateQueue.async { [weak self] in
      self?.stopInternal(notifyConnections: true)
      resolve(nil)
    }
  }

  @objc
  func rescan(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    stateQueue.async { [weak self] in
      guard let self, let peer = localPeer else {
        reject(
          "proximity_not_started",
          "Sync proximity is not running.",
          nil
        )
        return
      }
      browser?.stopBrowsingForPeers()
      browser?.delegate = nil
      let replacement = MCNearbyServiceBrowser(
        peer: peer,
        serviceType: proximityServiceType
      )
      browser = replacement
      replacement.delegate = self
      replacement.startBrowsingForPeers()
      resolve(nil)
    }
  }

  @objc
  func stopBrowsing(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    stateQueue.async { [weak self] in
      self?.browser?.stopBrowsingForPeers()
      resolve(nil)
    }
  }

  @objc
  func startAdvertising(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    stateQueue.async { [weak self] in
      guard let self, advertising.start() else {
        reject(
          "proximity_not_started",
          "Sync proximity is not running.",
          nil
        )
        return
      }
      resolve(nil)
    }
  }

  @objc
  func stopAdvertising(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    stateQueue.async { [weak self] in
      self?.advertising.stop()
      resolve(nil)
    }
  }

  @objc
  func updateDevice(
    _ device: [String: Any],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    stateQueue.async { [weak self] in
      guard let self, let parsed = ProximityDevice.parse(device) else {
        reject("invalid_device", "Sync proximity needs a valid local device.", nil)
        return
      }
      guard let peer = localPeer else {
        reject(
          "proximity_not_started",
          "Sync proximity is not running.",
          nil
        )
        return
      }
      advertiser?.delegate = nil
      let replacement = MCNearbyServiceAdvertiser(
        peer: peer,
        discoveryInfo: parsed.discoveryInfo,
        serviceType: proximityServiceType
      )
      localDevice = parsed
      advertiser = replacement
      replacement.delegate = self
      advertising.install(
        start: { replacement.startAdvertisingPeer() },
        stop: { replacement.stopAdvertisingPeer() }
      )
      resolve(nil)
    }
  }

  @objc
  func connect(
    _ deviceId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    stateQueue.async { [weak self] in
      guard let self, let browser, let localPeer, let localDevice else {
        reject(
          "proximity_not_started",
          "Sync proximity is not running.",
          nil
        )
        return
      }
      if let existing = sessionsById.values.first(
        where: {
          $0.remote.id == deviceId
            && $0.session.connectedPeers.contains($0.peer)
        }
      ) {
        resolve(existing.id)
        return
      }
      if sessionsById.values.contains(where: { $0.remote.id == deviceId }) {
        reject(
          "proximity_connection_in_progress",
          "A nearby connection is already in progress.",
          nil
        )
        return
      }
      guard
        let peer = peersByDeviceId[deviceId],
        let remote = devicesByPeerName[peer.displayName]
      else {
        reject(
          "proximity_peer_unavailable",
          "The nearby device is no longer available.",
          nil
        )
        return
      }

      let record = ProximitySession(
        remote: remote,
        peer: peer,
        localPeer: localPeer,
        outbound: true,
        resolve: resolve,
        reject: reject
      )
      register(record)
      let timeout = DispatchWorkItem { [weak self, weak record] in
        guard let self, let record, record.resolve != nil else { return }
        reject(
          "proximity_connect_timeout",
          "The nearby device did not accept the connection.",
          nil
        )
        record.resolve = nil
        record.reject = nil
        close(record, notify: true)
      }
      record.timeout = timeout
      stateQueue.asyncAfter(
        deadline: .now() + proximityConnectTimeout,
        execute: timeout
      )
      browser.invitePeer(
        peer,
        to: record.session,
        withContext: encode(localDevice),
        timeout: proximityConnectTimeout
      )
    }
  }

  @objc
  func send(_ connectionId: String, data encoded: String) {
    stateQueue.async { [weak self] in
      guard
        let self,
        let record = sessionsById[connectionId],
        let data = Data(base64Encoded: encoded),
        record.session.connectedPeers.contains(record.peer)
      else {
        return
      }
      do {
        try record.session.send(data, toPeers: [record.peer], with: .reliable)
      } catch {
        close(record, notify: true)
      }
    }
  }

  @objc
  func close(_ connectionId: String) {
    stateQueue.async { [weak self] in
      guard let self, let record = sessionsById[connectionId] else { return }
      close(record, notify: true)
    }
  }

  private func register(_ record: ProximitySession) {
    record.session.delegate = self
    sessionsById[record.id] = record
    sessionsByObject[ObjectIdentifier(record.session)] = record
  }

  private func close(_ record: ProximitySession, notify: Bool) {
    record.timeout?.cancel()
    record.timeout = nil
    record.resolve = nil
    record.reject = nil
    record.session.delegate = nil
    sessionsById.removeValue(forKey: record.id)
    sessionsByObject.removeValue(forKey: ObjectIdentifier(record.session))
    record.session.disconnect()
    if notify {
      emit(
        "SyncProximityConnectionClosed",
        ["connectionId": record.id, "deviceId": record.remote.id]
      )
    }
  }

  private func stopInternal(notifyConnections: Bool) {
    advertising.clear()
    browser?.stopBrowsingForPeers()
    advertiser?.delegate = nil
    browser?.delegate = nil
    advertiser = nil
    browser = nil
    for record in Array(sessionsById.values) {
      record.reject?(
        "proximity_stopped",
        "Sync proximity stopped before connecting.",
        nil
      )
      close(record, notify: notifyConnections)
    }
    peersByDeviceId.removeAll()
    devicesByPeerName.removeAll()
    localPeer = nil
    localDevice = nil
  }

  private func encode(_ device: ProximityDevice) -> Data? {
    try? JSONSerialization.data(withJSONObject: device.dictionary)
  }

  private func decode(_ data: Data?) -> ProximityDevice? {
    guard
      let data,
      let value = try? JSONSerialization.jsonObject(with: data)
        as? [String: Any]
    else {
      return nil
    }
    return ProximityDevice.parse(value)
  }

  private func emit(_ name: String, _ body: [String: Any]) {
    DispatchQueue.main.async { [weak self] in
      self?.sendEvent(withName: name, body: body)
    }
  }
}

extension SyncProximityModule: MCNearbyServiceBrowserDelegate {
  func browser(
    _ source: MCNearbyServiceBrowser,
    foundPeer peerID: MCPeerID,
    withDiscoveryInfo info: [String: String]?
  ) {
    stateQueue.async { [weak self] in
      guard
        let self,
        source === browser,
        let device = ProximityDevice.parseDiscovery(info),
        device.id != localDevice?.id
      else {
        return
      }
      peersByDeviceId[device.id] = peerID
      devicesByPeerName[peerID.displayName] = device
      emit("SyncProximityPeerFound", ["device": device.dictionary])
    }
  }

  func browser(
    _ source: MCNearbyServiceBrowser,
    lostPeer peerID: MCPeerID
  ) {
    stateQueue.async { [weak self] in
      guard
        let self,
        source === browser,
        let device = devicesByPeerName.removeValue(
          forKey: peerID.displayName
        )
      else {
        return
      }
      if peersByDeviceId[device.id] == peerID {
        peersByDeviceId.removeValue(forKey: device.id)
      }
      emit("SyncProximityPeerLost", ["deviceId": device.id])
    }
  }

  func browser(
    _ source: MCNearbyServiceBrowser,
    didNotStartBrowsingForPeers error: Error
  ) {
    stateQueue.async { [weak self] in
      guard let self, source === browser else { return }
      NSLog(
        "[SYNC] proximity browsing failed: %@",
        error.localizedDescription
      )
    }
  }
}

extension SyncProximityModule: MCNearbyServiceAdvertiserDelegate {
  func advertiser(
    _: MCNearbyServiceAdvertiser,
    didReceiveInvitationFromPeer peerID: MCPeerID,
    withContext context: Data?,
    invitationHandler: @escaping (Bool, MCSession?) -> Void
  ) {
    stateQueue.async { [weak self] in
      guard
        let self,
        let localPeer,
        let remote = decode(context),
        remote.id != localDevice?.id
      else {
        invitationHandler(false, nil)
        return
      }
      peersByDeviceId[remote.id] = peerID
      devicesByPeerName[peerID.displayName] = remote
      emit("SyncProximityPeerFound", ["device": remote.dictionary])
      if let existing = sessionsById.values.first(
        where: { $0.remote.id == remote.id }
      ) {
        if existing.session.connectedPeers.contains(existing.peer)
          || (localDevice?.id ?? "") < remote.id
        {
          invitationHandler(false, nil)
          return
        }
        existing.reject?(
          "proximity_connection_replaced",
          "The peer opened the nearby connection first.",
          nil
        )
        close(existing, notify: true)
      }
      let record = ProximitySession(
        remote: remote,
        peer: peerID,
        localPeer: localPeer,
        outbound: false
      )
      register(record)
      invitationHandler(true, record.session)
    }
  }

  func advertiser(
    _: MCNearbyServiceAdvertiser,
    didNotStartAdvertisingPeer error: Error
  ) {
    NSLog(
      "[SYNC] proximity advertising failed: %@",
      error.localizedDescription
    )
  }
}

extension SyncProximityModule: MCSessionDelegate {
  func session(
    _ session: MCSession,
    peer peerID: MCPeerID,
    didChange state: MCSessionState
  ) {
    let sessionIdentifier = ObjectIdentifier(session)
    let peerDisplayName = peerID.displayName
    stateQueue.async { [weak self] in
      guard
        let self,
        let record = sessionsByObject[sessionIdentifier],
        record.peer.displayName == peerDisplayName
      else {
        return
      }
      switch state {
      case .connected:
        record.timeout?.cancel()
        record.timeout = nil
        if let resolve = record.resolve {
          record.resolve = nil
          record.reject = nil
          resolve(record.id)
        } else if !record.outbound {
          emit(
            "SyncProximityConnectionOpened",
            [
              "connectionId": record.id,
              "deviceId": record.remote.id,
            ]
          )
        }
      case .notConnected:
        record.reject?(
          "proximity_connection_closed",
          "The nearby connection closed.",
          nil
        )
        close(record, notify: true)
      case .connecting:
        break
      @unknown default:
        close(record, notify: true)
      }
    }
  }

  func session(
    _ session: MCSession,
    didReceive data: Data,
    fromPeer peerID: MCPeerID
  ) {
    let sessionIdentifier = ObjectIdentifier(session)
    let peerDisplayName = peerID.displayName
    let receivedData = Data(data)
    stateQueue.async { [weak self] in
      guard
        let self,
        let record = sessionsByObject[sessionIdentifier],
        record.peer.displayName == peerDisplayName
      else {
        return
      }
      emit(
        "SyncProximityData",
        [
          "connectionId": record.id,
          "deviceId": record.remote.id,
          "data": receivedData.base64EncodedString(),
        ]
      )
    }
  }

  func session(
    _: MCSession,
    didReceive _: InputStream,
    withName _: String,
    fromPeer _: MCPeerID
  ) {}

  func session(
    _: MCSession,
    didStartReceivingResourceWithName _: String,
    fromPeer _: MCPeerID,
    with _: Progress
  ) {}

  func session(
    _: MCSession,
    didFinishReceivingResourceWithName _: String,
    fromPeer _: MCPeerID,
    at _: URL?,
    withError _: Error?
  ) {}

  func session(
    _: MCSession,
    didReceiveCertificate _: [Any]?,
    fromPeer _: MCPeerID,
    certificateHandler: @escaping (Bool) -> Void
  ) {
    certificateHandler(true)
  }
}
