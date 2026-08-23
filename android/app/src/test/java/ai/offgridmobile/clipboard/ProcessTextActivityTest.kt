package ai.offgridmobile.clipboard

import android.app.Application
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class ProcessTextActivityTest {
    private lateinit var context: Context
    private lateinit var store: ProcessTextHandoffStore

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.getSharedPreferences(ProcessTextHandoffStore.PREFERENCES_NAME, Context.MODE_PRIVATE)
            .edit().clear().commit()
        store = ProcessTextHandoffStore(context)
    }

    @After
    fun tearDown() {
        context.getSharedPreferences(ProcessTextHandoffStore.PREFERENCES_NAME, Context.MODE_PRIVATE)
            .edit().clear().commit()
    }

    @Test
    fun processTextSelectionIsDurableUntilAcknowledged() {
        val intent = Intent(context, ProcessTextActivity::class.java).apply {
            action = Intent.ACTION_PROCESS_TEXT
            type = "text/plain"
            putExtra(Intent.EXTRA_PROCESS_TEXT, "selected outside Off Grid")
        }

        val activity = Robolectric.buildActivity(ProcessTextActivity::class.java, intent).create().get()

        assertTrue(activity.isFinishing)
        val pending = store.pending().single()
        assertEquals("selected outside Off Grid", pending.text)
        assertTrue(pending.timestamp > 0L)
        store.acknowledge(setOf(pending.id))
        assertTrue(store.pending().isEmpty())
    }

    @Test
    fun handoffQueueKeepsOnlyTheNewestBoundedSelections() {
        repeat(ProcessTextHandoffStore.MAX_ENTRIES + 2) { index ->
            store.enqueue("selection-$index", timestamp = index + 1L)
        }

        val pending = store.pending()
        assertEquals(ProcessTextHandoffStore.MAX_ENTRIES, pending.size)
        assertEquals("selection-2", pending.first().text)
        assertEquals("selection-17", pending.last().text)
        assertEquals(null, store.enqueue("x".repeat(ProcessTextHandoffStore.MAX_TEXT_BYTES + 1)))
    }
}
