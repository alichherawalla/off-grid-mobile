package ai.offgridmobile.sync

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.pm.FeatureInfo
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class QrScannerManifestTest {
    @Test
    fun `QR scanner declares the runtime camera permission`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val requestedPermissions =
            context.packageManager
                .getPackageInfo(
                    context.packageName,
                    PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()),
                ).requestedPermissions.orEmpty()

        assertTrue(
            "Opening the Android QR scanner must be able to request camera access",
            requestedPermissions.contains(Manifest.permission.CAMERA),
        )
    }

    @Test
    fun `camera hardware stays optional for devices without a camera`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val cameraFeature =
            context.packageManager
                .getPackageInfo(
                    context.packageName,
                    PackageManager.PackageInfoFlags.of(PackageManager.GET_CONFIGURATIONS.toLong()),
                ).reqFeatures
                ?.firstOrNull { it.name == PackageManager.FEATURE_CAMERA }

        assertNotNull("The manifest must state whether camera hardware is required", cameraFeature)
        assertEquals(0, cameraFeature!!.flags and FeatureInfo.FLAG_REQUIRED)
    }
}
