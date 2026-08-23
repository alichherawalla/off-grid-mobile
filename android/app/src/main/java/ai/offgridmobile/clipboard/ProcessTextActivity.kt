package ai.offgridmobile.clipboard

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/** Receives text selected in another app through Android's public PROCESS_TEXT contract. */
class ProcessTextActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent?.action == Intent.ACTION_PROCESS_TEXT) {
            val text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
            if (text != null && ProcessTextHandoffStore(this).enqueue(text) != null) {
                sendBroadcast(
                    Intent(ACTION_HANDOFF_AVAILABLE)
                        .setPackage(packageName),
                )
            }
        }
        finish()
    }

    companion object {
        const val ACTION_HANDOFF_AVAILABLE =
            "ai.offgridmobile.clipboard.PROCESS_TEXT_HANDOFF_AVAILABLE"
    }
}
