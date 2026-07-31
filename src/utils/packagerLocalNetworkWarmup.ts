/**
 * Foreground warm-up of the Metro packager connection (iOS, dev builds only).
 *
 * Why this exists
 * ---------------
 * On a physical iOS device, RN decides where to load JS from inside
 * `didFinishLaunchingWithOptions`: RCTBundleURLProvider does a BLOCKING
 * NSURLSession GET to `http://<host>:8081/status` and, if that fails, silently
 * falls back to the embedded `main.jsbundle` — which is what puts the
 * "Connect to Metro to develop JavaScript." banner on screen
 * (RCTDevLoadingView takes that branch for any `file://` bundle URL).
 *
 * The Mac's Metro is on the same /24 as the phone, so that GET is a LOCAL
 * NETWORK request and iOS 14+ gates it behind the Local Network permission.
 * But RN issues it before the app has a foreground UI, and iOS will not present
 * a permission alert in that window — so the request is refused, no prompt is
 * ever shown, and the app never even appears under
 * Settings -> Privacy & Security -> Local Network. Every launch repeats this.
 *
 * The fix is to make the SAME request again once the app is foregrounded, where
 * iOS can actually present the alert. Granting it makes RN's launch-time probe
 * succeed from the next launch onward, and the banner goes away.
 *
 * We deliberately reuse RN's own host source (`ip.txt`, written into the app
 * bundle by react-native-xcode.sh for device Debug builds) rather than
 * hardcoding an IP, so this warms up whatever host RN will actually probe.
 */

import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import logger from './logger';

/** Matches kRCTBundleURLProviderDefaultPort / the port Metro is started on. */
const PACKAGER_PORT = 8081;

/** Long enough for the permission alert to be answered, short enough not to hang. */
const TIMEOUT_MS = 15000;

/** RN's own packager-host hint, written into the .app by react-native-xcode.sh. */
async function readPackagerHostFromBundle(): Promise<string | null> {
  const ipFile = `${RNFS.MainBundlePath}/ip.txt`;
  try {
    if (!(await RNFS.exists(ipFile))) return null;
    const host = (await RNFS.readFile(ipFile, 'utf8')).trim();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

/**
 * Ask iOS for Local Network access by repeating RN's packager probe from the
 * foreground. Safe to call unconditionally: it is a no-op outside dev iOS
 * builds, never throws, and never blocks app startup.
 *
 * The outcome is logged (and therefore lands in the on-device debug log file),
 * which is what distinguishes the two failure modes that look identical on
 * screen: a refused local-network request vs. a host that is simply not
 * reachable.
 */
export async function warmUpPackagerLocalNetwork(): Promise<void> {
  if (!__DEV__ || Platform.OS !== 'ios') return;

  const host = await readPackagerHostFromBundle();
  if (!host) {
    logger.warn('[PackagerWarmup] no ip.txt in the app bundle — nothing to warm up');
    return;
  }

  const url = `http://${host}:${PACKAGER_PORT}/status`;
  logger.warn(`[PackagerWarmup] probing ${url} from the foreground (expect an iOS Local Network prompt on first run)`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal }); // NOSONAR — LAN-only dev packager probe
    const body = (await res.text()).trim();
    logger.warn(`[PackagerWarmup] reachable: status=${res.status} body="${body}"`);
    if (body === 'packager-status:running') {
      logger.warn('[PackagerWarmup] Metro is reachable — relaunch the app to load the live bundle');
    }
  } catch (err) {
    // A refused local-network request and an unreachable host both surface here,
    // so log the message verbatim rather than interpreting it.
    logger.warn(`[PackagerWarmup] unreachable: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
