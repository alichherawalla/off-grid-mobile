package ai.offgridmobile.sync

import org.junit.Assert.assertEquals
import org.junit.Test

class BlobCryptoInterfaceCandidatesTest {
    @Test
    fun usableCandidatesKeepOnlyActiveUnicastInterfacesAndPreserveNames() {
        val candidates =
            listOf(
                record("wlan0", "192.168.1.10"),
                record("tun0", "100.80.1.2"),
                record("lo", "127.0.0.1", isLoopback = true),
                record("wlan0", "169.254.2.3", isLinkLocal = true),
                record("down0", "10.0.0.4", isUp = false),
                record("any0", "0.0.0.0", isAnyLocal = true),
                record("cast0", "224.0.0.1", isMulticast = true),
            )

        assertEquals(
            listOf(record("tun0", "100.80.1.2"), record("wlan0", "192.168.1.10")),
            BlobCrypto.usableInterfaceCandidates(candidates),
        )
    }

    @Test
    fun usableCandidatesDeduplicatePerInterfaceWithoutCollapsingDifferentInterfaces() {
        val candidate = record("tun0", "100.64.0.9")

        assertEquals(
            listOf(candidate, record("tun1", "100.64.0.9")),
            BlobCrypto.usableInterfaceCandidates(
                listOf(candidate, candidate, record("tun1", "100.64.0.9")),
            ),
        )
    }

    private fun record(
        interfaceName: String,
        host: String,
        isUp: Boolean = true,
        isLoopback: Boolean = false,
        isLinkLocal: Boolean = false,
        isAnyLocal: Boolean = false,
        isMulticast: Boolean = false,
    ) = BlobCrypto.InterfaceCandidate(
        host = host,
        interfaceName = interfaceName,
        isUp = isUp,
        isLoopback = isLoopback,
        isLinkLocal = isLinkLocal,
        isAnyLocal = isAnyLocal,
        isMulticast = isMulticast,
    )
}
