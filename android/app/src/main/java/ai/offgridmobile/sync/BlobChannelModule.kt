package ai.offgridmobile.sync

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.Executors

/**
 * The fast transfer path, as this phone implements it.
 *
 * JavaScript decides WHETHER to use it and mints the key material; this module does the moving. One
 * native call per direction, each streaming disk to socket with the cipher inline - so a model larger
 * than the phone's RAM transfers without ever being held in it, and the thread that draws the screen
 * never sees a byte.
 *
 * Progress comes back as an event rather than a promise, because the point of it is to arrive while
 * the work is still going.
 */
class BlobChannelModule(
    private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
    override fun getName(): String = NAME

    private val work = Executors.newCachedThreadPool()
    private val server by lazy { BlobServer(::emitProgress, ::emitOutcome) }

    /** The address every native sync listener on this phone can accept connections on. */
    @ReactMethod
    fun lanAddress(promise: Promise) {
        work.execute { promise.resolve(BlobCrypto.lanAddress()) }
    }

    /** All current IPv4 interfaces; the shared QR projector decides which routes are safe. */
    @ReactMethod
    fun interfaceCandidates(promise: Promise) {
        work.execute {
            val result = Arguments.createArray()
            BlobCrypto.interfaceCandidates().forEach { candidate ->
                result.pushMap(
                    Arguments.createMap().apply {
                        putString("host", candidate.host)
                        putString("interfaceName", candidate.interfaceName)
                    },
                )
            }
            promise.resolve(result)
        }
    }

    /**
     * Offer an endpoint for one transfer, and answer the url a peer should stream to.
     *
     * Returns nothing when this device has no address on a shared network - there is no endpoint to
     * offer, and the caller falls back to the path that always works.
     */
    @ReactMethod
    fun serve(options: ReadableMap, promise: Promise) {
        work.execute {
            try {
                val requestId = options.requireText("requestId")
                val address = BlobCrypto.lanAddress()
                if (address == null) {
                    promise.resolve(null)
                    return@execute
                }
                val port = server.ensureListening()
                server.offer(
                    requestId,
                    BlobServer.Pending(
                        token = options.requireText("token"),
                        destinationPath = options.requireText("destinationPath"),
                        fileSize = options.getDouble("fileSize").toLong(),
                        keyBase64 = options.requireText("keyBase64"),
                        nonceBase64 = options.requireText("nonceBase64"),
                        frameBytes = options.getDouble("frameBytes").toInt(),
                        offset = options.getDouble("offset").toLong(),
                        expiresAt = System.currentTimeMillis() + options.getDouble("ttlMs").toLong(),
                    ),
                )
                promise.resolve(
                    Arguments.createMap().apply {
                        putString(
                            "url",
                            "http://$address:$port/blob/${java.net.URLEncoder.encode(requestId, "UTF-8")}",
                        )
                    },
                )
            } catch (error: Exception) {
                promise.reject(BLOB_FAILED, error)
            }
        }
    }

    /** Stop serving an endpoint, whether its transfer completed or not. */
    @ReactMethod
    fun release(requestId: String) {
        server.release(requestId)
    }

    /** Stop sending a payload that is still going out. */
    @ReactMethod
    fun abort(requestId: String) {
        BlobUploader.abort(requestId)
    }

    /** Send a local file through the endpoint a peer offered, sealing it on the way out. */
    @ReactMethod
    fun stream(options: ReadableMap, promise: Promise) {
        work.execute {
            try {
                val requestId = options.requireText("requestId")
                val sent = BlobUploader.upload(
                    BlobUploader.Request(
                        requestId = requestId,
                        offset = options.getDouble("offset").toLong(),
                        sourcePath = options.requireText("sourcePath"),
                        url = options.requireText("url"),
                        token = options.requireText("token"),
                        keyBase64 = options.requireText("keyBase64"),
                        nonceBase64 = options.requireText("nonceBase64"),
                        frameBytes = options.getDouble("frameBytes").toInt(),
                    ),
                ) { bytes -> emitProgress(requestId, bytes) }
                promise.resolve(
                    Arguments.createMap().apply { putDouble("bytes", sent.toDouble()) },
                )
            } catch (error: Exception) {
                promise.reject(BLOB_FAILED, error)
            }
        }
    }

    // Required by the event emitter contract; the listeners live entirely on the JavaScript side.
    @ReactMethod fun addListener(eventName: String) = Unit

    @ReactMethod fun removeListeners(count: Int) = Unit

    private fun emitProgress(requestId: String, bytes: Long) {
        emit(
            PROGRESS_EVENT,
            Arguments.createMap().apply {
                putString("requestId", requestId)
                putDouble("bytes", bytes.toDouble())
            },
        )
    }

    private fun emitOutcome(requestId: String, landed: Boolean) {
        emit(
            OUTCOME_EVENT,
            Arguments.createMap().apply {
                putString("requestId", requestId)
                putBoolean("landed", landed)
            },
        )
    }

    private fun emit(event: String, payload: WritableMap) {
        if (!context.hasActiveReactInstance()) return
        context
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, payload)
    }

    private fun ReadableMap.requireText(key: String): String =
        getString(key) ?: throw IllegalArgumentException("$key is required")

    private companion object {
        const val NAME = "SyncBlobChannelModule"
        const val PROGRESS_EVENT = "SyncBlobProgress"
        const val OUTCOME_EVENT = "SyncBlobOutcome"
        const val BLOB_FAILED = "blob_channel_failed"
    }
}
