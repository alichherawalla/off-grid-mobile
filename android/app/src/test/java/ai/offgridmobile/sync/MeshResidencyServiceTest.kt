package ai.offgridmobile.sync

import android.Manifest
import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class MeshResidencyServiceTest {
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
}
