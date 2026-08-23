package ai.offgridmobile.clipboard

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

internal data class PendingProcessText(
    val id: String,
    val text: String,
    val timestamp: Long,
)

/**
 * Durable handoff between Android's PROCESS_TEXT activity and the React Native clipboard owner.
 *
 * The activity can run while the React instance is absent. SharedPreferences makes that handoff
 * process-safe, while the entry and byte limits stop a selection-menu action from becoming an
 * unbounded store. Entries remain until the clipboard coordinator has handled and acknowledged them.
 */
internal class ProcessTextHandoffStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    fun enqueue(text: String, timestamp: Long = System.currentTimeMillis()): PendingProcessText? =
        synchronized(lock) {
            val bytes = text.toByteArray(Charsets.UTF_8).size
            if (text.isBlank() || bytes > MAX_TEXT_BYTES) return@synchronized null

            val pending = readValidEntries().toMutableList()
            val item = PendingProcessText(UUID.randomUUID().toString(), text, timestamp)
            pending.add(item)
            while (pending.size > MAX_ENTRIES || pending.sumOf(::textBytes) > MAX_TOTAL_BYTES) {
                pending.removeAt(0)
            }
            persist(pending)
            item
        }

    fun pending(): List<PendingProcessText> = synchronized(lock) {
        val valid = readValidEntries()
        persist(valid)
        valid
    }

    fun acknowledge(ids: Set<String>) = synchronized(lock) {
        if (ids.isEmpty()) return@synchronized
        persist(readValidEntries().filterNot { ids.contains(it.id) })
    }

    private fun readValidEntries(): List<PendingProcessText> {
        val raw = preferences.getString(PENDING_KEY, null) ?: return emptyList()
        val array = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val id = item.optString(ID_KEY).trim()
                val text = item.optString(TEXT_KEY)
                val timestamp = item.optLong(TIMESTAMP_KEY, Long.MIN_VALUE)
                if (
                    id.isEmpty() ||
                    text.isBlank() ||
                    timestamp <= 0L ||
                    textBytes(PendingProcessText(id, text, timestamp)) > MAX_TEXT_BYTES
                ) {
                    continue
                }
                add(PendingProcessText(id, text, timestamp))
            }
        }.takeLast(MAX_ENTRIES).let { entries ->
            val retained = entries.toMutableList()
            while (retained.sumOf(::textBytes) > MAX_TOTAL_BYTES) retained.removeAt(0)
            retained
        }
    }

    private fun persist(entries: List<PendingProcessText>) {
        val array = JSONArray()
        entries.forEach { entry ->
            array.put(
                JSONObject()
                    .put(ID_KEY, entry.id)
                    .put(TEXT_KEY, entry.text)
                    .put(TIMESTAMP_KEY, entry.timestamp),
            )
        }
        // The PROCESS_TEXT activity finishes immediately, so commit before its process can be killed.
        preferences.edit().putString(PENDING_KEY, array.toString()).commit()
    }

    private fun textBytes(item: PendingProcessText): Int =
        item.text.toByteArray(Charsets.UTF_8).size

    companion object {
        internal const val PREFERENCES_NAME = "offgrid-process-text-handoff-v1"
        internal const val PENDING_KEY = "pending"
        internal const val MAX_ENTRIES = 16
        internal const val MAX_TEXT_BYTES = 256 * 1024
        internal const val MAX_TOTAL_BYTES = 1024 * 1024

        private const val ID_KEY = "id"
        private const val TEXT_KEY = "text"
        private const val TIMESTAMP_KEY = "timestamp"
        private val lock = Any()
    }
}
