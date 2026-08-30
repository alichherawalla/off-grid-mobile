package ai.offgridmobile.sync

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * Android half of the mesh residency contract (see src/services/sync/nativeMeshResidency.ts).
 *
 * Thin handler: it starts and stops the foreground service and reports what Android can actually
 * guarantee. Android holds residency for as long as the service lives, so the background grace is
 * unbounded and the ongoing notification is mandatory.
 */
class MeshResidencyModule(
    private val reactContext: ReactApplicationContext,
    private val snapshotMapFactory: () -> WritableMap = { Arguments.createMap() },
) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "MeshResidencyModule"

    override fun getConstants(): Map<String, Any?> =
        mapOf(
            "survivesBackground" to true,
            // null = unbounded. Android keeps the sockets open while the service holds.
            "backgroundGraceSeconds" to null,
            "showsOngoingIndicator" to true,
        )

    @ReactMethod
    fun begin(promise: Promise) {
        try {
            MeshResidencyService.start(reactContext) { snapshot ->
                promise.resolve(snapshot.toWritableMap(snapshotMapFactory()))
            }
        } catch (e: IllegalStateException) {
            // Android throws when a foreground service is started from a disallowed state (for
            // example a background start without an exemption). Report it rather than crashing: the
            // mesh still works in the foreground.
            promise.reject("mesh_residency_denied", e)
        } catch (e: SecurityException) {
            promise.reject("mesh_residency_denied", e)
        }
    }

    @ReactMethod
    fun state(promise: Promise) {
        promise.resolve(
            MeshResidencyService.currentSnapshot().toWritableMap(snapshotMapFactory()),
        )
    }

    @ReactMethod
    fun end(promise: Promise) {
        try {
            MeshResidencyService.stop(reactContext)
            promise.resolve(null)
        } catch (e: IllegalStateException) {
            promise.reject("mesh_residency_stop_failed", e)
        }
    }

    override fun invalidate() {
        // A reload or teardown must not leave an orphan notification promising reachability the
        // JS engine can no longer provide.
        MeshResidencyService.stop(reactContext)
        super.invalidate()
    }
}
