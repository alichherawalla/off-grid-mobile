import { AppState, NativeModules, Platform } from 'react-native';
import logger from '../utils/logger';
import { flushDebugLogNow } from '../utils/debugLogFile';

/**
 * A heartbeat that says what memory is doing from the moment the app starts.
 *
 * Why this exists: the app was being killed by iOS at launch and the log went silent half a second
 * in, so every diagnosis was a guess. Two facts were missing and this supplies both.
 *
 * WHERE IT STOPS. The line is emitted on a timer. If the ticks stop while the process is still
 * alive, the JS thread is blocked - and the last tick says when. If they keep ticking right up to the
 * kill, the JS thread was fine and the memory went somewhere native.
 *
 * WHAT MEMORY IS DOING. footprint is what this process holds; available is what iOS will still hand
 * it, which on a 12GB iPhone is ~6.3GB, not 12. A jetsam is available reaching zero, and the growth
 * rate between ticks says whether something is streaming in (downloads) or allocated at once (a
 * model load).
 *
 * Flushed every tick rather than batched: a log that is still in a buffer when the process dies is
 * exactly the log we needed.
 */

/** Every second: fine enough to see a ramp, cheap enough to leave on in a dev build. */
const TICK_MS = 1_000;
/** Startup is the window under investigation; after this the app is up and the noise is not worth it. */
const WINDOW_MS = 120_000;

let timer: ReturnType<typeof setInterval> | null = null;

const mb = (bytes: unknown): number =>
  Math.round((Number(bytes) || 0) / (1024 * 1024));

/**
 * Read the per-process picture straight from the native module.
 *
 * Deliberately NOT through hardwareService: that caches, and a probe that reports a cached number
 * cannot show a ramp. It also means a fault in the service layer cannot silence the probe.
 */
async function sample(): Promise<string> {
  // Optional-chained through NativeModules itself: under jest there is no native layer at all, and a
  // diagnostic must never be the thing that breaks a caller.
  const mod = (NativeModules as Record<string, unknown> | undefined)?.[
    'DeviceMemoryModule'
  ] as { getMemoryInfo?: () => Promise<Record<string, unknown>> } | undefined;
  if (!mod?.getMemoryInfo) return 'no DeviceMemoryModule';
  try {
    const info = await mod.getMemoryInfo();
    return `footprintMB=${mb(info?.footprintBytes)} availableMB=${mb(
      info?.processAvailableBytes,
    )} low=${String(info?.lowMemory)}`;
  } catch (e) {
    return `read failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Start the heartbeat. Idempotent, and a no-op outside a dev build.
 *
 * Called as early as possible in startup so the first tick lands before anything heavy runs.
 */
export function startStartupMemoryProbe(): void {
  if (!__DEV__ || timer) return;
  const startedAt = Date.now();
  logger.log(`[MEM-PROBE] start platform=${Platform.OS}`);

  const tick = (): void => {
    const elapsed = Date.now() - startedAt;
    void sample().then((reading) => {
      // Seconds since launch leads the line: the whole point is WHEN, so it should be readable
      // without doing arithmetic on timestamps.
      logger.log(`[MEM-PROBE] t=${(elapsed / 1000).toFixed(1)}s ${reading}`);
      // Straight to disk: a sample still sitting in a buffer when the OS kills us is the sample we
      // needed most.
      flushDebugLogNow();
    });
    if (elapsed >= WINDOW_MS) stopStartupMemoryProbe();
  };

  // The OS's own signals, on the same timeline as the samples. A memory warning immediately before
  // the ticks stop says the kill was memory; ticks stopping with no warning says the thread blocked.
  AppState.addEventListener('memoryWarning', () => {
    logger.log(`[MEM-PROBE] OS MEMORY WARNING t=${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    flushDebugLogNow();
  });
  AppState.addEventListener('change', (state) => {
    logger.log(`[MEM-PROBE] appState=${state} t=${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  });

  tick();
  timer = setInterval(tick, TICK_MS);
}

function stopStartupMemoryProbe(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  logger.log('[MEM-PROBE] stop');
}
