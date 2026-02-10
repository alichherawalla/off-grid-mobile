import Foundation
import React

@objc(DownloadManagerModule)
class DownloadManagerModule: RCTEventEmitter {

  // MARK: - Types

  private struct FileTask {
    let url: URL
    let relativePath: String
    let destinationDir: String
    var task: URLSessionDownloadTask?
    var bytesDownloaded: Int64
    var totalBytes: Int64
    var completed: Bool
  }

  private struct DownloadInfo {
    let downloadId: Int64
    let fileName: String
    let modelId: String
    var totalBytes: Int64
    var bytesDownloaded: Int64
    var status: String // pending, running, paused, completed, failed
    var startedAt: Double
    // Single-file download
    var task: URLSessionDownloadTask?
    var localUri: String?
    var downloadUrl: String? // stored for reconnecting after app restart
    // Multi-file download
    var fileTasks: [Int: FileTask] // taskIdentifier -> FileTask
    var multiFileDestDir: String?
    var isMultiFile: Bool
  }

  // Codable structs for UserDefaults persistence
  private struct PersistedDownload: Codable {
    let downloadId: Int64
    let fileName: String
    let modelId: String
    var totalBytes: Int64
    var bytesDownloaded: Int64
    var status: String
    var startedAt: Double
    var localUri: String?
    var downloadUrl: String?
    var isMultiFile: Bool
    var multiFileDestDir: String?
    var fileTaskEntries: [PersistedFileTask]?
  }

  private struct PersistedFileTask: Codable {
    let url: String
    let relativePath: String
    let destinationDir: String
    var totalBytes: Int64
    var bytesDownloaded: Int64
    var completed: Bool
  }

  // MARK: - State

  private static let persistenceKey = "com.localllm.activeDownloads"
  private static var sharedSession: URLSession?
  private static var sessionDelegate: DownloadSessionDelegate?

  private var downloads: [Int64: DownloadInfo] = [:]
  private var taskToDownloadId: [Int: Int64] = [:] // URLSessionTask.taskIdentifier -> downloadId
  private var nextDownloadId: Int64 = 1
  private var pollingTimer: Timer?
  private let queue = DispatchQueue(label: "com.localllm.downloadmanager", attributes: .concurrent)
  private var hasListeners = false

  // MARK: - RCTEventEmitter

  override init() {
    super.init()
    NSLog("[DownloadManager] Module initialized")
    restoreDownloads()
    setupSession()
  }

  @objc override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["DownloadProgress", "DownloadComplete", "DownloadError"]
  }

  override func startObserving() {
    hasListeners = true
    NSLog("[DownloadManager] startObserving called — hasListeners = true")
  }

  override func stopObserving() {
    // Do NOT set hasListeners = false.
    // Our JS listeners (from BackgroundDownloadService singleton) are permanent.
    // RN's listener lifecycle sometimes calls stop/start in quick succession,
    // which would cause us to drop events during active downloads.
    NSLog("[DownloadManager] stopObserving called — KEEPING hasListeners=true (listeners are permanent)")
  }

  // MARK: - Persistence (UserDefaults)

  private func persistDownloads() {
    let persisted: [PersistedDownload] = downloads.values.map { info in
      var fileEntries: [PersistedFileTask]?
      if info.isMultiFile {
        fileEntries = info.fileTasks.values.map { ft in
          PersistedFileTask(
            url: ft.url.absoluteString,
            relativePath: ft.relativePath,
            destinationDir: ft.destinationDir,
            totalBytes: ft.totalBytes,
            bytesDownloaded: ft.bytesDownloaded,
            completed: ft.completed
          )
        }
      }
      return PersistedDownload(
        downloadId: info.downloadId,
        fileName: info.fileName,
        modelId: info.modelId,
        totalBytes: info.totalBytes,
        bytesDownloaded: info.bytesDownloaded,
        status: info.status,
        startedAt: info.startedAt,
        localUri: info.localUri,
        downloadUrl: info.downloadUrl,
        isMultiFile: info.isMultiFile,
        multiFileDestDir: info.multiFileDestDir,
        fileTaskEntries: fileEntries
      )
    }

    if let data = try? JSONEncoder().encode(persisted) {
      UserDefaults.standard.set(data, forKey: Self.persistenceKey)
      NSLog("[DownloadManager] Persisted %d downloads to UserDefaults", persisted.count)
    }
  }

  private func restoreDownloads() {
    guard let data = UserDefaults.standard.data(forKey: Self.persistenceKey),
          let persisted = try? JSONDecoder().decode([PersistedDownload].self, from: data) else {
      NSLog("[DownloadManager] No persisted downloads found")
      return
    }

    // Only restore downloads that were still active (running/pending)
    let activeDownloads = persisted.filter { $0.status == "running" || $0.status == "pending" }
    NSLog("[DownloadManager] Restoring %d active downloads from UserDefaults (of %d total persisted)", activeDownloads.count, persisted.count)

    for p in activeDownloads {
      var fileTasks: [Int: FileTask] = [:]
      if p.isMultiFile, let entries = p.fileTaskEntries {
        // Use negative placeholder keys; will be remapped when reconnecting tasks
        for (index, entry) in entries.enumerated() {
          let placeholderKey = -(index + 1)
          fileTasks[placeholderKey] = FileTask(
            url: URL(string: entry.url)!,
            relativePath: entry.relativePath,
            destinationDir: entry.destinationDir,
            task: nil,
            bytesDownloaded: entry.bytesDownloaded,
            totalBytes: entry.totalBytes,
            completed: entry.completed
          )
        }
      }

      let info = DownloadInfo(
        downloadId: p.downloadId,
        fileName: p.fileName,
        modelId: p.modelId,
        totalBytes: p.totalBytes,
        bytesDownloaded: p.bytesDownloaded,
        status: p.status,
        startedAt: p.startedAt,
        task: nil,
        localUri: p.localUri,
        downloadUrl: p.downloadUrl,
        fileTasks: fileTasks,
        multiFileDestDir: p.multiFileDestDir,
        isMultiFile: p.isMultiFile
      )

      downloads[p.downloadId] = info

      // Ensure nextDownloadId is higher than any restored ID
      if p.downloadId >= nextDownloadId {
        nextDownloadId = p.downloadId + 1
      }

      NSLog("[DownloadManager] Restored download #%lld: %@ (%@)", p.downloadId, p.fileName, p.status)
    }

    // Clean out completed/failed entries from persistence
    if activeDownloads.count < persisted.count {
      persistDownloads()
    }
  }

  // MARK: - Session Setup

  private func setupSession() {
    if DownloadManagerModule.sharedSession == nil {
      NSLog("[DownloadManager] Creating NEW background URLSession")
      let config = URLSessionConfiguration.background(
        withIdentifier: "com.localllm.backgrounddownload"
      )
      config.isDiscretionary = false
      config.sessionSendsLaunchEvents = true
      config.allowsCellularAccess = true
      config.httpMaximumConnectionsPerHost = 4

      let delegate = DownloadSessionDelegate(module: self)
      DownloadManagerModule.sessionDelegate = delegate
      DownloadManagerModule.sharedSession = URLSession(
        configuration: config,
        delegate: delegate,
        delegateQueue: nil
      )
      NSLog("[DownloadManager] Background URLSession created successfully")

      // Reconnect orphaned tasks from previous app runs to restored download state
      DownloadManagerModule.sharedSession?.getAllTasks { [weak self] tasks in
        guard let self = self else { return }
        if tasks.isEmpty {
          NSLog("[DownloadManager] No orphaned tasks found — clean session")
          return
        }

        NSLog("[DownloadManager] Found %d tasks from previous session — attempting to reconnect", tasks.count)

        self.queue.async(flags: .barrier) {
          for task in tasks {
            guard let taskUrl = task.originalRequest?.url?.absoluteString else {
              NSLog("[DownloadManager] Orphaned task#%d has no URL — cancelling", task.taskIdentifier)
              task.cancel()
              continue
            }

            var matched = false

            for (downloadId, var info) in self.downloads {
              if info.isMultiFile {
                // Find matching file task by URL
                var updatedFileTasks = info.fileTasks
                for (placeholderKey, ft) in info.fileTasks {
                  if ft.url.absoluteString == taskUrl && !ft.completed && ft.task == nil {
                    // Reconnect: move from placeholder key to real task ID
                    var reconnectedFt = ft
                    reconnectedFt.task = task as? URLSessionDownloadTask
                    updatedFileTasks.removeValue(forKey: placeholderKey)
                    updatedFileTasks[task.taskIdentifier] = reconnectedFt
                    self.taskToDownloadId[task.taskIdentifier] = downloadId
                    matched = true
                    NSLog("[DownloadManager] Reconnected task#%d to download#%lld file %@", task.taskIdentifier, downloadId, ft.relativePath)
                    break
                  }
                }
                if matched {
                  info.fileTasks = updatedFileTasks
                  self.downloads[downloadId] = info
                }
              } else {
                // Single file — match by URL
                if info.downloadUrl == taskUrl && info.task == nil {
                  info.task = task as? URLSessionDownloadTask
                  self.downloads[downloadId] = info
                  self.taskToDownloadId[task.taskIdentifier] = downloadId
                  matched = true
                  NSLog("[DownloadManager] Reconnected task#%d to download#%lld (%@)", task.taskIdentifier, downloadId, info.fileName)
                }
              }
              if matched { break }
            }

            if !matched {
              NSLog("[DownloadManager] No match for orphaned task#%d (url=%@, state=%d) — cancelling", task.taskIdentifier, taskUrl, task.state.rawValue)
              task.cancel()
            }
          }
        }
      }

      // After reconnection loop, mark unmatched downloads as failed
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
        guard let self = self else { return }
        self.queue.async(flags: .barrier) {
          for (downloadId, var info) in self.downloads {
            if info.status == "running" || info.status == "pending" {
              if info.isMultiFile {
                let hasUnmatchedTask = info.fileTasks.values.contains { !$0.completed && $0.task == nil }
                if hasUnmatchedTask {
                  info.status = "failed"
                  self.downloads[downloadId] = info
                  NSLog("[DownloadManager] Marking download#%lld as failed — has unmatched file tasks after reconnection", downloadId)
                }
              } else if info.task == nil {
                info.status = "failed"
                self.downloads[downloadId] = info
                NSLog("[DownloadManager] Marking download#%lld as failed — no URLSession task after reconnection", downloadId)
              }
            }
          }
          self.persistDownloads()
        }
      }
    } else {
      NSLog("[DownloadManager] Reusing existing URLSession, updating delegate.module")
      DownloadManagerModule.sessionDelegate?.module = self
    }
  }

  private var session: URLSession {
    DownloadManagerModule.sharedSession!
  }

  // MARK: - React Methods

  @objc func startDownload(_ params: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    NSLog("[DownloadManager] startDownload called with params: %@", params)

    guard let urlString = params["url"] as? String,
          let url = URL(string: urlString),
          let fileName = params["fileName"] as? String,
          let modelId = params["modelId"] as? String else {
      NSLog("[DownloadManager] startDownload: INVALID_PARAMS — missing url, fileName, or modelId")
      reject("INVALID_PARAMS", "Missing url, fileName, or modelId", nil)
      return
    }

    let totalBytes = (params["totalBytes"] as? NSNumber)?.int64Value ?? 0
    let downloadId = nextDownloadId
    nextDownloadId += 1

    NSLog("[DownloadManager] Starting download #%lld: url=%@, fileName=%@, modelId=%@, totalBytes=%lld", downloadId, urlString, fileName, modelId, totalBytes)

    let task = session.downloadTask(with: url)
    NSLog("[DownloadManager] Created URLSessionDownloadTask #%d for download #%lld", task.taskIdentifier, downloadId)

    let info = DownloadInfo(
      downloadId: downloadId,
      fileName: fileName,
      modelId: modelId,
      totalBytes: totalBytes,
      bytesDownloaded: 0,
      status: "running",
      startedAt: Date().timeIntervalSince1970 * 1000,
      task: task,
      localUri: nil,
      downloadUrl: urlString,
      fileTasks: [:],
      multiFileDestDir: nil,
      isMultiFile: false
    )

    // Store in map SYNCHRONOUSLY before resuming task to avoid race condition
    // where delegate receives progress before the map entry exists
    queue.sync(flags: .barrier) {
      self.downloads[downloadId] = info
      self.taskToDownloadId[task.taskIdentifier] = downloadId
      NSLog("[DownloadManager] Stored download #%lld in state (total downloads: %d, taskMap entries: %d)", downloadId, self.downloads.count, self.taskToDownloadId.count)
    }

    persistDownloads()

    task.resume()
    NSLog("[DownloadManager] task.resume() called for download #%lld", downloadId)

    resolve([
      "downloadId": NSNumber(value: downloadId),
      "fileName": fileName,
      "modelId": modelId,
    ] as [String: Any])
  }

  /// Start a multi-file download (for Core ML models that are directory trees, not zips)
  @objc func startMultiFileDownload(_ params: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    NSLog("[DownloadManager] startMultiFileDownload called with params: %@", params)

    guard let filesArray = params["files"] as? [[String: Any]],
          let fileName = params["fileName"] as? String,
          let modelId = params["modelId"] as? String,
          let destinationDir = params["destinationDir"] as? String else {
      NSLog("[DownloadManager] startMultiFileDownload: INVALID_PARAMS")
      reject("INVALID_PARAMS", "Missing files, fileName, modelId, or destinationDir", nil)
      return
    }

    let totalBytes = (params["totalBytes"] as? NSNumber)?.int64Value ?? 0
    let downloadId = nextDownloadId
    nextDownloadId += 1

    NSLog("[DownloadManager] Starting multi-file download #%lld: %d files, totalBytes=%lld, dest=%@", downloadId, filesArray.count, totalBytes, destinationDir)

    // Create destination directory
    let fileManager = FileManager.default
    try? fileManager.createDirectory(atPath: destinationDir, withIntermediateDirectories: true)

    var fileTasks: [Int: FileTask] = [:]
    var tasks: [URLSessionDownloadTask] = []

    for (index, fileInfo) in filesArray.enumerated() {
      guard let urlString = fileInfo["url"] as? String,
            let url = URL(string: urlString),
            let relativePath = fileInfo["relativePath"] as? String else {
        NSLog("[DownloadManager] Skipping file %d: missing url or relativePath", index)
        continue
      }

      let fileSize = (fileInfo["size"] as? NSNumber)?.int64Value ?? 0
      let task = session.downloadTask(with: url)

      NSLog("[DownloadManager] File %d/%d: task#%d, relativePath=%@, size=%lld, url=%@", index + 1, filesArray.count, task.taskIdentifier, relativePath, fileSize, urlString)

      let ft = FileTask(
        url: url,
        relativePath: relativePath,
        destinationDir: destinationDir,
        task: task,
        bytesDownloaded: 0,
        totalBytes: fileSize,
        completed: false
      )

      fileTasks[task.taskIdentifier] = ft
      tasks.append(task)
    }

    let info = DownloadInfo(
      downloadId: downloadId,
      fileName: fileName,
      modelId: modelId,
      totalBytes: totalBytes,
      bytesDownloaded: 0,
      status: "running",
      startedAt: Date().timeIntervalSince1970 * 1000,
      task: nil,
      localUri: nil,
      downloadUrl: nil,
      fileTasks: fileTasks,
      multiFileDestDir: destinationDir,
      isMultiFile: true
    )

    // Store in map SYNCHRONOUSLY before resuming tasks to avoid race condition
    queue.sync(flags: .barrier) {
      self.downloads[downloadId] = info
      for task in tasks {
        self.taskToDownloadId[task.taskIdentifier] = downloadId
      }
      NSLog("[DownloadManager] Stored multi-file download #%lld in state (taskMap entries: %d)", downloadId, self.taskToDownloadId.count)
    }

    persistDownloads()

    // Start all tasks
    for task in tasks {
      task.resume()
    }
    NSLog("[DownloadManager] Resumed all %d tasks for multi-file download #%lld", tasks.count, downloadId)

    resolve([
      "downloadId": NSNumber(value: downloadId),
      "fileName": fileName,
      "modelId": modelId,
    ] as [String: Any])
  }

  @objc func cancelDownload(_ downloadId: Double, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let id = Int64(downloadId)
    NSLog("[DownloadManager] cancelDownload called for #%lld", id)
    queue.async(flags: .barrier) {
      guard let info = self.downloads[id] else {
        NSLog("[DownloadManager] cancelDownload: download #%lld NOT FOUND", id)
        reject("NOT_FOUND", "Download \(id) not found", nil)
        return
      }
      if info.isMultiFile {
        for (_, ft) in info.fileTasks {
          ft.task?.cancel()
        }
      } else {
        info.task?.cancel()
      }
      self.downloads[id]?.status = "failed"
      self.downloads.removeValue(forKey: id)
      NSLog("[DownloadManager] Download #%lld cancelled and removed", id)
      self.persistDownloads()
      resolve(nil)
    }
  }

  @objc func getActiveDownloads(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    queue.sync {
      NSLog("[DownloadManager] getActiveDownloads: %d downloads in state", downloads.count)
      let result = downloads.values.map { info -> [String: Any] in
        NSLog("[DownloadManager]   -> #%lld: %@ status=%@ bytes=%lld/%lld", info.downloadId, info.fileName, info.status, info.bytesDownloaded, info.totalBytes)
        return [
          "downloadId": NSNumber(value: info.downloadId),
          "fileName": info.fileName,
          "modelId": info.modelId,
          "status": info.status,
          "bytesDownloaded": NSNumber(value: info.bytesDownloaded),
          "totalBytes": NSNumber(value: info.totalBytes),
          "startedAt": NSNumber(value: info.startedAt),
        ]
      }
      resolve(result)
    }
  }

  @objc func getDownloadProgress(_ downloadId: Double, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let id = Int64(downloadId)
    queue.sync {
      guard let info = downloads[id] else {
        NSLog("[DownloadManager] getDownloadProgress: #%lld NOT FOUND", id)
        reject("NOT_FOUND", "Download \(id) not found", nil)
        return
      }
      NSLog("[DownloadManager] getDownloadProgress #%lld: %@ %lld/%lld", id, info.status, info.bytesDownloaded, info.totalBytes)
      resolve([
        "downloadId": NSNumber(value: info.downloadId),
        "fileName": info.fileName,
        "modelId": info.modelId,
        "status": info.status,
        "bytesDownloaded": NSNumber(value: info.bytesDownloaded),
        "totalBytes": NSNumber(value: info.totalBytes),
      ] as [String: Any])
    }
  }

  @objc func moveCompletedDownload(_ downloadId: Double, targetPath: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let id = Int64(downloadId)
    NSLog("[DownloadManager] moveCompletedDownload #%lld -> %@", id, targetPath)
    queue.sync {
      guard let info = downloads[id] else {
        NSLog("[DownloadManager] moveCompletedDownload: #%lld NOT FOUND", id)
        reject("NOT_FOUND", "Download \(id) not found or not completed", nil)
        return
      }

      // Multi-file downloads are already in their final location
      if info.isMultiFile {
        NSLog("[DownloadManager] Multi-file download already at: %@", info.multiFileDestDir ?? "nil")
        resolve(info.multiFileDestDir ?? targetPath)
        return
      }

      guard let localUri = info.localUri else {
        NSLog("[DownloadManager] moveCompletedDownload: #%lld localUri is nil (not completed yet)", id)
        reject("NOT_COMPLETED", "Download \(id) not completed yet", nil)
        return
      }

      NSLog("[DownloadManager] Moving from %@ to %@", localUri, targetPath)

      let fileManager = FileManager.default
      let sourceURL = URL(fileURLWithPath: localUri)
      let targetURL = URL(fileURLWithPath: targetPath)

      // Create parent directory if needed
      let parentDir = targetURL.deletingLastPathComponent()
      try? fileManager.createDirectory(at: parentDir, withIntermediateDirectories: true)
      try? fileManager.removeItem(at: targetURL)

      do {
        try fileManager.moveItem(at: sourceURL, to: targetURL)
        NSLog("[DownloadManager] File moved successfully")
        resolve(targetPath)
      } catch {
        NSLog("[DownloadManager] moveItem failed: %@, trying copyItem", error.localizedDescription)
        do {
          try fileManager.copyItem(at: sourceURL, to: targetURL)
          try? fileManager.removeItem(at: sourceURL)
          NSLog("[DownloadManager] File copied successfully")
          resolve(targetPath)
        } catch {
          NSLog("[DownloadManager] copyItem also failed: %@", error.localizedDescription)
          reject("MOVE_FAILED", "Failed to move file: \(error.localizedDescription)", error)
        }
      }
    }
  }

  @objc func startProgressPolling() {
    NSLog("[DownloadManager] startProgressPolling called (hasListeners=%d)", hasListeners ? 1 : 0)
    DispatchQueue.main.async {
      guard self.pollingTimer == nil else {
        NSLog("[DownloadManager] Polling timer already running, skipping")
        return
      }
      self.pollingTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
        self?.pollProgress()
      }
      NSLog("[DownloadManager] Polling timer STARTED (0.5s interval)")
    }
  }

  @objc func stopProgressPolling() {
    NSLog("[DownloadManager] stopProgressPolling called")
    DispatchQueue.main.async {
      self.pollingTimer?.invalidate()
      self.pollingTimer = nil
      NSLog("[DownloadManager] Polling timer STOPPED")
    }
  }

  @objc override func addListener(_ eventName: String) {
    NSLog("[DownloadManager] addListener('%@') called — calling super", eventName)
    super.addListener(eventName)
    NSLog("[DownloadManager] addListener('%@') done — hasListeners should now be true", eventName)
  }

  @objc override func removeListeners(_ count: Int) {
    NSLog("[DownloadManager] removeListeners(%d) called — calling super", count)
    super.removeListeners(count)
  }

  // MARK: - Progress Polling

  private func pollProgress() {
    guard hasListeners else {
      return
    }
    queue.sync {
      let activeDownloads = downloads.filter { $0.value.status == "running" || $0.value.status == "pending" }
      for (_, info) in activeDownloads {
        sendEvent(withName: "DownloadProgress", body: [
          "downloadId": NSNumber(value: info.downloadId),
          "fileName": info.fileName,
          "modelId": info.modelId,
          "bytesDownloaded": NSNumber(value: info.bytesDownloaded),
          "totalBytes": NSNumber(value: info.totalBytes),
          "status": info.status,
        ] as [String: Any])
      }
    }
  }

  // MARK: - URLSession Delegate Callbacks

  fileprivate func handleProgress(taskId: Int, bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpected: Int64) {
    queue.async(flags: .barrier) {
      guard let downloadId = self.taskToDownloadId[taskId],
            var info = self.downloads[downloadId] else {
        NSLog("[DownloadManager] handleProgress: task#%d NOT FOUND in taskToDownloadId (map has %d entries)", taskId, self.taskToDownloadId.count)
        return
      }

      if info.isMultiFile {
        // Update individual file task progress
        if var ft = info.fileTasks[taskId] {
          ft.bytesDownloaded = totalBytesWritten
          if totalBytesExpected > 0 { ft.totalBytes = totalBytesExpected }
          info.fileTasks[taskId] = ft
        }
        // Calculate aggregate progress
        var totalDown: Int64 = 0
        for (_, ft) in info.fileTasks {
          totalDown += ft.bytesDownloaded
        }
        info.bytesDownloaded = totalDown
        info.status = "running"
        // Log every ~5MB to avoid spam
        if totalBytesWritten % (5 * 1024 * 1024) < bytesWritten || totalBytesWritten == bytesWritten {
          NSLog("[DownloadManager] Multi-file progress: download#%lld task#%d: %lld/%lld (aggregate: %lld/%lld)", downloadId, taskId, totalBytesWritten, totalBytesExpected, info.bytesDownloaded, info.totalBytes)
        }
      } else {
        info.bytesDownloaded = totalBytesWritten
        if totalBytesExpected > 0 { info.totalBytes = totalBytesExpected }
        info.status = "running"
        // Log every ~5MB
        if totalBytesWritten % (5 * 1024 * 1024) < bytesWritten || totalBytesWritten == bytesWritten {
          NSLog("[DownloadManager] Progress: download#%lld task#%d: %lld/%lld", downloadId, taskId, totalBytesWritten, totalBytesExpected)
        }
      }

      self.downloads[downloadId] = info
    }
  }

  fileprivate func handleCompletion(taskId: Int, location: URL) {
    NSLog("[DownloadManager] handleCompletion: task#%d, location=%@", taskId, location.path)
    queue.async(flags: .barrier) {
      guard let downloadId = self.taskToDownloadId[taskId],
            var info = self.downloads[downloadId] else {
        NSLog("[DownloadManager] handleCompletion: task#%d NOT FOUND in taskToDownloadId", taskId)
        return
      }

      let fileManager = FileManager.default
      NSLog("[DownloadManager] handleCompletion for download#%lld (%@), isMultiFile=%d, hasListeners=%d", downloadId, info.fileName, info.isMultiFile ? 1 : 0, self.hasListeners ? 1 : 0)

      if info.isMultiFile {
        // Move individual file to its destination
        guard var ft = info.fileTasks[taskId] else {
          NSLog("[DownloadManager] handleCompletion: task#%d NOT FOUND in fileTasks", taskId)
          return
        }
        let destPath = "\(ft.destinationDir)/\(ft.relativePath)"
        let destURL = URL(fileURLWithPath: destPath)

        NSLog("[DownloadManager] Moving file task#%d: %@ -> %@", taskId, location.path, destPath)

        // Create subdirectories
        let parentDir = destURL.deletingLastPathComponent()
        try? fileManager.createDirectory(at: parentDir, withIntermediateDirectories: true)
        try? fileManager.removeItem(at: destURL)

        do {
          try fileManager.moveItem(at: location, to: destURL)
          NSLog("[DownloadManager] File moved: %@", ft.relativePath)
        } catch {
          NSLog("[DownloadManager] moveItem failed for %@: %@, trying copy", ft.relativePath, error.localizedDescription)
          do {
            try fileManager.copyItem(at: location, to: destURL)
            NSLog("[DownloadManager] File copied: %@", ft.relativePath)
          } catch {
            NSLog("[DownloadManager] Failed to save file %@: %@", ft.relativePath, error.localizedDescription)
          }
        }

        ft.completed = true
        info.fileTasks[taskId] = ft

        let completedCount = info.fileTasks.values.filter { $0.completed }.count
        let totalCount = info.fileTasks.count
        NSLog("[DownloadManager] Multi-file progress: %d/%d files completed for download#%lld", completedCount, totalCount, downloadId)

        // Check if all files complete
        let allDone = info.fileTasks.values.allSatisfy { $0.completed }
        if allDone {
          NSLog("[DownloadManager] ALL files complete for download#%lld!", downloadId)
          info.status = "completed"
          info.bytesDownloaded = info.totalBytes
          info.localUri = info.multiFileDestDir
          self.downloads[downloadId] = info
          self.persistDownloads()

          if self.hasListeners {
            NSLog("[DownloadManager] SENDING DownloadComplete event for #%lld", downloadId)
            self.sendEvent(withName: "DownloadComplete", body: [
              "downloadId": NSNumber(value: info.downloadId),
              "fileName": info.fileName,
              "modelId": info.modelId,
              "bytesDownloaded": NSNumber(value: info.bytesDownloaded),
              "totalBytes": NSNumber(value: info.totalBytes),
              "status": "completed",
              "localUri": info.multiFileDestDir ?? "",
            ] as [String: Any])
          } else {
            NSLog("[DownloadManager] Download#%lld completed but hasListeners=false, NOT sending event!", downloadId)
          }
        } else {
          self.downloads[downloadId] = info
        }
      } else {
        // Single file download — move to temp
        let tmpDir = NSTemporaryDirectory()
        let destPath = "\(tmpDir)/download_\(downloadId)_\(info.fileName)"
        let destURL = URL(fileURLWithPath: destPath)
        try? fileManager.removeItem(at: destURL)

        NSLog("[DownloadManager] Moving single file: %@ -> %@", location.path, destPath)

        do {
          try fileManager.moveItem(at: location, to: destURL)
          NSLog("[DownloadManager] Single file saved to: %@", destPath)
          info.localUri = destPath
          info.status = "completed"
          info.bytesDownloaded = info.totalBytes
          self.downloads[downloadId] = info
          self.persistDownloads()

          if self.hasListeners {
            NSLog("[DownloadManager] SENDING DownloadComplete event for #%lld (single file)", downloadId)
            self.sendEvent(withName: "DownloadComplete", body: [
              "downloadId": NSNumber(value: info.downloadId),
              "fileName": info.fileName,
              "modelId": info.modelId,
              "bytesDownloaded": NSNumber(value: info.bytesDownloaded),
              "totalBytes": NSNumber(value: info.totalBytes),
              "status": "completed",
              "localUri": destPath,
            ] as [String: Any])
          } else {
            NSLog("[DownloadManager] Download#%lld completed but hasListeners=false, NOT sending event!", downloadId)
          }
        } catch {
          NSLog("[DownloadManager] Failed to move single file: %@", error.localizedDescription)
          info.status = "failed"
          self.downloads[downloadId] = info
          self.persistDownloads()
          if self.hasListeners {
            self.sendEvent(withName: "DownloadError", body: [
              "downloadId": NSNumber(value: info.downloadId),
              "fileName": info.fileName,
              "modelId": info.modelId,
              "bytesDownloaded": NSNumber(value: info.bytesDownloaded),
              "totalBytes": NSNumber(value: info.totalBytes),
              "status": "failed",
              "reason": "Failed to save download: \(error.localizedDescription)",
            ] as [String: Any])
          }
        }
      }
    }
  }

  fileprivate func handleError(taskId: Int, error: Error?) {
    NSLog("[DownloadManager] handleError: task#%d, error=%@", taskId, error?.localizedDescription ?? "nil")
    queue.async(flags: .barrier) {
      guard let downloadId = self.taskToDownloadId[taskId],
            var info = self.downloads[downloadId] else {
        NSLog("[DownloadManager] handleError: task#%d NOT FOUND in taskToDownloadId", taskId)
        return
      }

      NSLog("[DownloadManager] Download#%lld (%@) FAILED: %@", downloadId, info.fileName, error?.localizedDescription ?? "Unknown")

      // For multi-file: one file failing = whole download fails
      if info.isMultiFile {
        NSLog("[DownloadManager] Cancelling all remaining tasks for multi-file download#%lld", downloadId)
        for (_, ft) in info.fileTasks where !ft.completed {
          ft.task?.cancel()
        }
      }

      info.status = "failed"
      self.downloads[downloadId] = info
      self.persistDownloads()

      if self.hasListeners {
        NSLog("[DownloadManager] SENDING DownloadError event for #%lld", downloadId)
        self.sendEvent(withName: "DownloadError", body: [
          "downloadId": NSNumber(value: info.downloadId),
          "fileName": info.fileName,
          "modelId": info.modelId,
          "bytesDownloaded": NSNumber(value: info.bytesDownloaded),
          "totalBytes": NSNumber(value: info.totalBytes),
          "status": "failed",
          "reason": error?.localizedDescription ?? "Unknown error",
        ] as [String: Any])
      } else {
        NSLog("[DownloadManager] Download#%lld errored but hasListeners=false, NOT sending event!", downloadId)
      }
    }
  }
}

// MARK: - URLSession Delegate

private class DownloadSessionDelegate: NSObject, URLSessionDownloadDelegate {
  weak var module: DownloadManagerModule?

  init(module: DownloadManagerModule) {
    self.module = module
    super.init()
    NSLog("[DownloadManager] DownloadSessionDelegate created")
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
    module?.handleProgress(
      taskId: downloadTask.taskIdentifier,
      bytesWritten: bytesWritten,
      totalBytesWritten: totalBytesWritten,
      totalBytesExpected: totalBytesExpectedToWrite
    )
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    NSLog("[DownloadManager] Delegate: didFinishDownloadingTo for task#%d at %@", downloadTask.taskIdentifier, location.path)

    // CRITICAL: The file at `location` is deleted by URLSession as soon as this method returns.
    // We must copy it to a safe location SYNCHRONOUSLY before returning.
    let fileManager = FileManager.default
    let safeTmp = NSTemporaryDirectory() + "dl_task_\(downloadTask.taskIdentifier)_\(UUID().uuidString).tmp"
    let safeURL = URL(fileURLWithPath: safeTmp)

    do {
      try fileManager.copyItem(at: location, to: safeURL)
      NSLog("[DownloadManager] Delegate: copied temp file to safe location: %@", safeTmp)
      module?.handleCompletion(taskId: downloadTask.taskIdentifier, location: safeURL)
    } catch {
      NSLog("[DownloadManager] Delegate: FAILED to copy temp file: %@", error.localizedDescription)
      module?.handleError(taskId: downloadTask.taskIdentifier, error: error)
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error = error {
      NSLog("[DownloadManager] Delegate: didCompleteWithError for task#%d: %@", task.taskIdentifier, error.localizedDescription)
      module?.handleError(taskId: task.taskIdentifier, error: error)
    } else {
      NSLog("[DownloadManager] Delegate: didCompleteWithError for task#%d: NO error (success)", task.taskIdentifier)
    }
  }
}
