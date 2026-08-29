package ai.offgridmobile.sync

import android.Manifest
import android.app.Application
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class MeshResidencyServiceTest {
    @After
    fun releaseResidency() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        MeshResidencyService.stop(context)
    }

    @Test
    fun personalMeshUsesConnectedDeviceForegroundServiceContract() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val serviceInfo =
            context.packageManager.getServiceInfo(
                ComponentName(context, MeshResidencyService::class.java),
                PackageManager.ComponentInfoFlags.of(0),
            )

        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            MeshResidencyService.FOREGROUND_SERVICE_TYPE,
        )
        assertEquals(
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            serviceInfo.foregroundServiceType,
        )

        val requestedPermissions =
            context.packageManager
                .getPackageInfo(
                    context.packageName,
                    PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()),
                ).requestedPermissions.orEmpty()

        assertTrue(
            requestedPermissions.contains(Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE),
        )
        assertTrue(
            requestedPermissions.contains(Manifest.permission.CHANGE_WIFI_MULTICAST_STATE),
        )
    }

    @Test
    @Config(sdk = [34], application = Application::class)
    fun timeoutStopsResidencyImmediately() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        var startedStatus: String? = null
        MeshResidencyService.start(context) { startedStatus = it.status }
        val startIntent = shadowOf(context as Application).nextStartedService
        val service =
            org.robolectric.Robolectric
                .buildService(MeshResidencyService::class.java)
                .create()
                .get()

        service.onStartCommand(startIntent, 0, 17)
        assertEquals("background", startedStatus)
        service.onTimeout(17, MeshResidencyService.FOREGROUND_SERVICE_TYPE)

        val shadow = shadowOf(service)
        assertTrue(shadow.isForegroundStopped)
        assertTrue(shadow.notificationShouldRemoved)
        assertTrue(shadow.isStoppedBySelf)

        var restartedStatus: String? = null
        MeshResidencyService.start(context) { restartedStatus = it.status }
        assertNotNull(shadowOf(context as Application).nextStartedService)
        assertEquals("starting", MeshResidencyService.currentSnapshot().status)
        assertEquals(null, restartedStatus)
    }

    @Test
    fun serviceDoesNotRestartWithoutItsMeshOwner() {
        val service =
            org.robolectric.Robolectric
                .buildService(MeshResidencyService::class.java)
                .create()
                .get()

        val restartMode = service.onStartCommand(null, 0, 18)

        assertEquals(Service.START_NOT_STICKY, restartMode)
    }

    @Test
    fun timeoutIsProjectedAsForegroundOnlyInsteadOfBackgroundRunning() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        MeshResidencyService.start(context) {}
        val startIntent = shadowOf(context as Application).nextStartedService
        val service =
            org.robolectric.Robolectric
                .buildService(MeshResidencyService::class.java)
                .create()
                .get()

        service.onStartCommand(startIntent, 0, 19)
        service.onTimeout(19, MeshResidencyService.FOREGROUND_SERVICE_TYPE)

        assertEquals("foreground_only", MeshResidencyService.currentSnapshot().status)
        assertEquals("timed_out", MeshResidencyService.currentSnapshot().reason)
    }

    @Test
    fun unexpectedServiceStopRemovesTheBackgroundReachabilityClaim() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        MeshResidencyService.start(context) {}
        val startIntent = shadowOf(context as Application).nextStartedService
        val controller =
            org.robolectric.Robolectric
                .buildService(MeshResidencyService::class.java)
                .create()
        val service = controller.get()

        service.onStartCommand(startIntent, 0, 20)
        controller.destroy()

        assertEquals("foreground_only", MeshResidencyService.currentSnapshot().status)
        assertEquals("unavailable", MeshResidencyService.currentSnapshot().reason)
    }
}
