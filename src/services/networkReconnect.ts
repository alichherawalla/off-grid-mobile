/**
 * Network Reconnect Watcher
 *
 * Fixes the "connected at the office, changed WiFi, must manually rescan" drop. The remote-model
 * (HTTP gateway) path has no liveness check: after the desktop's LAN IP moves or the phone changes
 * network, the saved endpoint is stale but the app still believes it is connected and only fails on
 * the next message. This watcher detects a network change and asks the service to recover.
 *
 * Native-dep-free by design: it reuses `getIpAddress()` (already a dependency via
 * react-native-device-info) and AppState, rather than adding @react-native-community/netinfo (a new
 * native module + rebuild). The device's own IP changing is a reliable proxy for "the network
 * changed"; the actual re-discover / re-select decision lives in `remoteServerManager`, not here.
 */

import { AppState, AppStateStatus } from 'react-native';
import { getIpAddress } from 'react-native-device-info';
import { remoteServerManager } from './remoteServerManager';
import logger from '../utils/logger';

/** How often to poll the device IP while the app is foregrounded. */
const IP_POLL_MS = 15_000;
/** Wait for a WiFi handoff to settle before acting, and coalesce rapid changes into one recovery. */
const DEBOUNCE_MS = 2_500;

let appStateSub: { remove: () => void } | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastIp: string | null = null;
let started = false;
let lifecycleGeneration = 0;

function isUsableIp(ip: string | null | undefined): ip is string {
  return !!ip && ip !== '0.0.0.0';
}

function scheduleRecovery(reason: string, generation: number): void {
  if (!started || generation !== lifecycleGeneration) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (!started || generation !== lifecycleGeneration) return;
    logger.log(`[NetReconnect] recovering after ${reason}`);
    remoteServerManager
      .recoverActiveConnection()
      .catch((err) => logger.warn('[NetReconnect] recovery failed:', (err as Error).message));
  }, DEBOUNCE_MS);
}

async function checkIpChanged(
  generation = lifecycleGeneration,
  validateUnchanged = false,
): Promise<void> {
  let ip: string;
  try {
    ip = await getIpAddress();
  } catch {
    return;
  }
  if (!started || generation !== lifecycleGeneration) return;
  if (!isUsableIp(ip)) return;
  if (isUsableIp(lastIp) && ip !== lastIp) {
    logger.log(`[NetReconnect] device IP changed ${lastIp} -> ${ip}`);
    scheduleRecovery('network change', generation);
  } else if (validateUnchanged && isUsableIp(lastIp)) {
    // A server can move, or WiFi can rejoin, while this phone receives the same private IP.
    // The manager performs a cheap active-endpoint check before it decides whether to scan.
    scheduleRecovery('active connection validation', generation);
  }
  lastIp = ip;
}

function startPoll(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => { checkIpChanged().catch(() => { /* checkIpChanged never rejects */ }); }, IP_POLL_MS);
}

function stopPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function handleAppState(state: AppStateStatus): void {
  if (state === 'active') {
    // The network may have changed while backgrounded; compare current IP to the last one we saw.
    checkIpChanged(lifecycleGeneration, true).catch(() => { /* checkIpChanged never rejects */ });
    startPoll();
  } else {
    stopPoll();
  }
}

/** Start watching for network changes. Idempotent — safe to call once at app boot. */
export function startNetworkReconnectWatcher(): void {
  if (started) return;
  started = true;
  const generation = ++lifecycleGeneration;
  // Seed the baseline IP without triggering a recovery on first launch.
  getIpAddress().then((ip) => {
    if (started && generation === lifecycleGeneration && isUsableIp(ip)) lastIp = ip;
  }).catch(() => { /* no network yet */ });
  appStateSub = AppState.addEventListener('change', handleAppState);
  if (AppState.currentState === 'active') startPoll();
  logger.log('[NetReconnect] watcher started');
}

/** Stop watching. Used on teardown; the watcher is otherwise app-lifetime. */
export function stopNetworkReconnectWatcher(): void {
  started = false;
  lifecycleGeneration += 1;
  appStateSub?.remove();
  appStateSub = null;
  stopPoll();
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
