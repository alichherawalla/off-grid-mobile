package ai.offgridmobile.sync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Keeps the Personal Mesh reachable while Off Grid is not in the foreground.
 *
 * Without this, Android suspends the process and mDNS discovery, the TCP listener and any in-flight
 * transfer stop, while the other device still shows this one as connected. Android classifies this
 * live local-device connection as connectedDevice work. That type is not subject to dataSync's
 * six-hour budget. The ongoing notification keeps background reachability visible, never silent.
 */
class MeshResidencyService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat()
        // Restart if the OS kills us for memory, so the mesh comes back without the user
        // reopening the app. No redelivered intent is needed - residency carries no payload.
        return START_STICKY
    }

    private fun startForegroundCompat() {
        val notification = buildNotification(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                FOREGROUND_SERVICE_TYPE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        const val CHANNEL_ID = "offgrid-personal-mesh"
        const val NOTIFICATION_ID = 4711
        const val FOREGROUND_SERVICE_TYPE =
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE

        /**
         * Ensure the channel exists before the first foreground start.
         *
         * IMPORTANCE_LOW keeps the notification silent: it is a status indicator, not an alert.
         */
        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager =
                context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (manager.getNotificationChannel(CHANNEL_ID) != null) return
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Personal Mesh",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "Shown while this device stays reachable to your other devices."
                    setShowBadge(false)
                },
            )
        }

        fun buildNotification(context: Context): Notification =
            NotificationCompat.Builder(context, CHANNEL_ID)
                .setContentTitle("Personal Mesh is on")
                .setContentText("This device stays reachable to your other devices.")
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()

        fun start(context: Context) {
            ensureChannel(context)
            val intent = Intent(context, MeshResidencyService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, MeshResidencyService::class.java))
        }
    }
}
