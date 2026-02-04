package com.localllm.download

import android.app.DownloadManager
import android.content.Context
import android.content.SharedPreferences
import android.database.Cursor
import android.net.Uri
import android.os.Environment
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class DownloadManagerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "DownloadManagerModule"
        const val PREFS_NAME = "LocalLLMDownloads"
        const val DOWNLOADS_KEY = "active_downloads"
        private const val POLL_INTERVAL_MS = 500L
    }

    private val downloadManager: DownloadManager by lazy {
        reactApplicationContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    }

    private val sharedPrefs: SharedPreferences by lazy {
        reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    private val handler = Handler(Looper.getMainLooper())
    private var isPolling = false
    private val pollRunnable = object : Runnable {
        override fun run() {
            if (isPolling) {
                pollAllDownloads()
                handler.postDelayed(this, POLL_INTERVAL_MS)
            }
        }
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun startDownload(params: ReadableMap, promise: Promise) {
        try {
            val url = params.getString("url") ?: throw IllegalArgumentException("URL is required")
            val fileName = params.getString("fileName") ?: throw IllegalArgumentException("fileName is required")
            val title = params.getString("title") ?: fileName
            val description = params.getString("description") ?: "Downloading model..."
            val modelId = params.getString("modelId") ?: ""
            val totalBytes = if (params.hasKey("totalBytes")) params.getDouble("totalBytes").toLong() else 0L

            val request = DownloadManager.Request(Uri.parse(url))
                .setTitle(title)
                .setDescription(description)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(
                    reactApplicationContext,
                    Environment.DIRECTORY_DOWNLOADS,
                    fileName
                )
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true)

            val downloadId = downloadManager.enqueue(request)

            // Persist download info
            val downloadInfo = JSONObject().apply {
                put("downloadId", downloadId)
                put("url", url)
                put("fileName", fileName)
                put("modelId", modelId)
                put("title", title)
                put("totalBytes", totalBytes)
                put("status", "pending")
                put("startedAt", System.currentTimeMillis())
            }
            persistDownload(downloadId, downloadInfo)

            val result = Arguments.createMap().apply {
                putDouble("downloadId", downloadId.toDouble())
                putString("fileName", fileName)
                putString("modelId", modelId)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("DOWNLOAD_ERROR", "Failed to start download: ${e.message}", e)
        }
    }

    @ReactMethod
    fun cancelDownload(downloadId: Double, promise: Promise) {
        try {
            val id = downloadId.toLong()
            downloadManager.remove(id)
            removeDownload(id)

            // Clean up partial file
            val downloadInfo = getDownloadInfo(id)
            downloadInfo?.optString("fileName")?.let { fileName ->
                val file = File(
                    reactApplicationContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                    fileName
                )
                if (file.exists()) {
                    file.delete()
                }
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CANCEL_ERROR", "Failed to cancel download: ${e.message}", e)
        }
    }

    @ReactMethod
    fun getActiveDownloads(promise: Promise) {
        try {
            val downloads = getAllPersistedDownloads()
            val result = Arguments.createArray()

            for (i in 0 until downloads.length()) {
                val download = downloads.getJSONObject(i)
                val downloadId = download.getLong("downloadId")

                // Get current status from DownloadManager
                val statusInfo = queryDownloadStatus(downloadId)

                val map = Arguments.createMap().apply {
                    putDouble("downloadId", downloadId.toDouble())
                    putString("fileName", download.optString("fileName"))
                    putString("modelId", download.optString("modelId"))
                    putString("title", download.optString("title"))
                    putDouble("totalBytes", download.optDouble("totalBytes", 0.0))
                    putString("status", statusInfo.getString("status"))
                    putDouble("bytesDownloaded", statusInfo.getDouble("bytesDownloaded"))
                    putString("localUri", statusInfo.getString("localUri"))
                    putDouble("startedAt", download.optDouble("startedAt", 0.0))
                }
                result.pushMap(map)
            }

            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("QUERY_ERROR", "Failed to get active downloads: ${e.message}", e)
        }
    }

    @ReactMethod
    fun getDownloadProgress(downloadId: Double, promise: Promise) {
        try {
            val id = downloadId.toLong()
            val statusInfo = queryDownloadStatus(id)
            val downloadInfo = getDownloadInfo(id)

            val result = Arguments.createMap().apply {
                putDouble("downloadId", id.toDouble())
                putDouble("bytesDownloaded", statusInfo.getDouble("bytesDownloaded"))
                putDouble("totalBytes", statusInfo.getDouble("totalBytes").takeIf { it > 0 }
                    ?: downloadInfo?.optDouble("totalBytes", 0.0) ?: 0.0)
                putString("status", statusInfo.getString("status"))
                putString("localUri", statusInfo.getString("localUri"))
                putString("reason", statusInfo.getString("reason"))
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("PROGRESS_ERROR", "Failed to get download progress: ${e.message}", e)
        }
    }

    @ReactMethod
    fun moveCompletedDownload(downloadId: Double, targetPath: String, promise: Promise) {
        try {
            val id = downloadId.toLong()
            val downloadInfo = getDownloadInfo(id)
            val fileName = downloadInfo?.optString("fileName")
                ?: throw IllegalArgumentException("Download info not found")

            val sourceFile = File(
                reactApplicationContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                fileName
            )

            if (!sourceFile.exists()) {
                throw IllegalArgumentException("Downloaded file not found: ${sourceFile.absolutePath}")
            }

            val targetFile = File(targetPath)
            targetFile.parentFile?.mkdirs()

            // Move the file
            if (sourceFile.renameTo(targetFile)) {
                removeDownload(id)
                promise.resolve(targetFile.absolutePath)
            } else {
                // If rename fails (different filesystem), copy then delete
                sourceFile.copyTo(targetFile, overwrite = true)
                sourceFile.delete()
                removeDownload(id)
                promise.resolve(targetFile.absolutePath)
            }
        } catch (e: Exception) {
            promise.reject("MOVE_ERROR", "Failed to move completed download: ${e.message}", e)
        }
    }

    @ReactMethod
    fun startProgressPolling() {
        if (!isPolling) {
            isPolling = true
            handler.post(pollRunnable)
        }
    }

    @ReactMethod
    fun stopProgressPolling() {
        isPolling = false
        handler.removeCallbacks(pollRunnable)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN event emitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN event emitter
    }

    private fun pollAllDownloads() {
        val downloads = getAllPersistedDownloads()

        for (i in 0 until downloads.length()) {
            val download = downloads.getJSONObject(i)
            val downloadId = download.getLong("downloadId")
            val statusInfo = queryDownloadStatus(downloadId)
            val status = statusInfo.getString("status")

            val eventParams = Arguments.createMap().apply {
                putDouble("downloadId", downloadId.toDouble())
                putString("fileName", download.optString("fileName"))
                putString("modelId", download.optString("modelId"))
                putDouble("bytesDownloaded", statusInfo.getDouble("bytesDownloaded"))
                putDouble("totalBytes", statusInfo.getDouble("totalBytes").takeIf { it > 0 }
                    ?: download.optDouble("totalBytes", 0.0))
                putString("status", status)
            }

            val previousStatus = download.optString("status", "pending")

            when (status) {
                "completed" -> {
                    android.util.Log.d("DownloadManager", "Download $downloadId completed! previousStatus=$previousStatus")
                    eventParams.putString("localUri", statusInfo.getString("localUri"))
                    // Only emit DownloadComplete once — skip if already marked completed
                    if (previousStatus != "completed") {
                        android.util.Log.d("DownloadManager", "Sending DownloadComplete event for $downloadId")
                        sendEvent("DownloadComplete", eventParams)
                    }
                    updateDownloadStatus(downloadId, "completed", statusInfo.getString("localUri"))
                }
                "failed" -> {
                    android.util.Log.e("DownloadManager", "Download $downloadId failed: ${statusInfo.getString("reason")}")
                    eventParams.putString("reason", statusInfo.getString("reason"))
                    sendEvent("DownloadError", eventParams)
                    removeDownload(downloadId)
                }
                "paused" -> {
                    val reason = statusInfo.getString("reason")
                    android.util.Log.w("DownloadManager", "Download $downloadId paused: $reason")
                    eventParams.putString("reason", reason)
                    sendEvent("DownloadProgress", eventParams)
                }
                "running", "pending" -> {
                    val progress = if (statusInfo.getDouble("totalBytes") > 0) {
                        (statusInfo.getDouble("bytesDownloaded") / statusInfo.getDouble("totalBytes") * 100).toInt()
                    } else 0
                    if (progress >= 95) {
                        android.util.Log.d("DownloadManager", "Download $downloadId at $progress% (status=$status)")
                    }
                    sendEvent("DownloadProgress", eventParams)
                }
                "unknown" -> {
                    android.util.Log.w("DownloadManager", "Download $downloadId has unknown status - may have completed or been removed")
                    // Query the file directly to see if it completed
                    val downloadInfo = getDownloadInfo(downloadId)
                    downloadInfo?.optString("fileName")?.let { fileName ->
                        val file = java.io.File(
                            reactApplicationContext.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS),
                            fileName
                        )
                        if (file.exists() && file.length() > 0) {
                            android.util.Log.d("DownloadManager", "File exists, treating as completed: ${file.absolutePath}")
                            eventParams.putString("localUri", file.toURI().toString())
                            if (previousStatus != "completed") {
                                sendEvent("DownloadComplete", eventParams)
                            }
                            updateDownloadStatus(downloadId, "completed", file.toURI().toString())
                        }
                    }
                }
            }
        }
    }

    private fun queryDownloadStatus(downloadId: Long): ReadableMap {
        val query = DownloadManager.Query().setFilterById(downloadId)
        val cursor: Cursor? = downloadManager.query(query)

        val result = Arguments.createMap()

        cursor?.use {
            if (it.moveToFirst()) {
                val bytesDownloadedIdx = it.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
                val totalBytesIdx = it.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
                val statusIdx = it.getColumnIndex(DownloadManager.COLUMN_STATUS)
                val reasonIdx = it.getColumnIndex(DownloadManager.COLUMN_REASON)
                val localUriIdx = it.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)

                val bytesDownloaded = if (bytesDownloadedIdx >= 0) it.getLong(bytesDownloadedIdx) else 0L
                val totalBytes = if (totalBytesIdx >= 0) it.getLong(totalBytesIdx) else 0L
                val status = if (statusIdx >= 0) it.getInt(statusIdx) else DownloadManager.STATUS_PENDING
                val reason = if (reasonIdx >= 0) it.getInt(reasonIdx) else 0
                val localUri = if (localUriIdx >= 0) it.getString(localUriIdx) else null

                result.putDouble("bytesDownloaded", bytesDownloaded.toDouble())
                result.putDouble("totalBytes", totalBytes.toDouble())
                result.putString("localUri", localUri ?: "")
                result.putString("status", statusToString(status))
                result.putString("reason", reasonToString(status, reason))
            } else {
                // Download not found - might have been removed or completed
                result.putDouble("bytesDownloaded", 0.0)
                result.putDouble("totalBytes", 0.0)
                result.putString("localUri", "")
                result.putString("status", "unknown")
                result.putString("reason", "Download not found")
            }
        } ?: run {
            result.putDouble("bytesDownloaded", 0.0)
            result.putDouble("totalBytes", 0.0)
            result.putString("localUri", "")
            result.putString("status", "unknown")
            result.putString("reason", "Query failed")
        }

        return result
    }

    private fun statusToString(status: Int): String = when (status) {
        DownloadManager.STATUS_PENDING -> "pending"
        DownloadManager.STATUS_RUNNING -> "running"
        DownloadManager.STATUS_PAUSED -> "paused"
        DownloadManager.STATUS_SUCCESSFUL -> "completed"
        DownloadManager.STATUS_FAILED -> "failed"
        else -> "unknown"
    }

    private fun reasonToString(status: Int, reason: Int): String {
        if (status == DownloadManager.STATUS_PAUSED) {
            return when (reason) {
                DownloadManager.PAUSED_QUEUED_FOR_WIFI -> "Waiting for WiFi"
                DownloadManager.PAUSED_WAITING_FOR_NETWORK -> "Waiting for network"
                DownloadManager.PAUSED_WAITING_TO_RETRY -> "Waiting to retry"
                else -> "Paused"
            }
        }
        if (status == DownloadManager.STATUS_FAILED) {
            return when (reason) {
                DownloadManager.ERROR_CANNOT_RESUME -> "Cannot resume"
                DownloadManager.ERROR_DEVICE_NOT_FOUND -> "Device not found"
                DownloadManager.ERROR_FILE_ALREADY_EXISTS -> "File already exists"
                DownloadManager.ERROR_FILE_ERROR -> "File error"
                DownloadManager.ERROR_HTTP_DATA_ERROR -> "HTTP data error"
                DownloadManager.ERROR_INSUFFICIENT_SPACE -> "Insufficient space"
                DownloadManager.ERROR_TOO_MANY_REDIRECTS -> "Too many redirects"
                DownloadManager.ERROR_UNHANDLED_HTTP_CODE -> "Unhandled HTTP code"
                DownloadManager.ERROR_UNKNOWN -> "Unknown error"
                else -> "Error: $reason"
            }
        }
        return ""
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    private fun persistDownload(downloadId: Long, info: JSONObject) {
        val downloads = getAllPersistedDownloads()

        // Update or add the download
        var found = false
        for (i in 0 until downloads.length()) {
            val existing = downloads.getJSONObject(i)
            if (existing.getLong("downloadId") == downloadId) {
                downloads.put(i, info)
                found = true
                break
            }
        }
        if (!found) {
            downloads.put(info)
        }

        sharedPrefs.edit().putString(DOWNLOADS_KEY, downloads.toString()).apply()
    }

    private fun updateDownloadStatus(downloadId: Long, status: String, localUri: String?) {
        val info = getDownloadInfo(downloadId)
        if (info != null) {
            info.put("status", status)
            if (localUri != null) {
                info.put("localUri", localUri)
            }
            info.put("completedAt", System.currentTimeMillis())
            persistDownload(downloadId, info)
        }
    }

    private fun removeDownload(downloadId: Long) {
        val downloads = getAllPersistedDownloads()
        val newDownloads = JSONArray()

        for (i in 0 until downloads.length()) {
            val download = downloads.getJSONObject(i)
            if (download.getLong("downloadId") != downloadId) {
                newDownloads.put(download)
            }
        }

        sharedPrefs.edit().putString(DOWNLOADS_KEY, newDownloads.toString()).apply()
    }

    private fun getDownloadInfo(downloadId: Long): JSONObject? {
        val downloads = getAllPersistedDownloads()
        for (i in 0 until downloads.length()) {
            val download = downloads.getJSONObject(i)
            if (download.getLong("downloadId") == downloadId) {
                return download
            }
        }
        return null
    }

    private fun getAllPersistedDownloads(): JSONArray {
        val json = sharedPrefs.getString(DOWNLOADS_KEY, "[]") ?: "[]"
        return try {
            JSONArray(json)
        } catch (e: Exception) {
            JSONArray()
        }
    }
}
