/**
 * LAN LLM Server Discovery
 *
 * Scans the device's local subnet for running LLM servers
 * (Ollama, LM Studio, Off Grid AI Gateway) using their default ports.
 */

import { getIpAddress, isEmulator } from 'react-native-device-info';
import { isPrivateIPv4, isIPv6 } from '../utils/network';
import logger from '../utils/logger';

export interface DiscoveredServer {
  endpoint: string;
  type: 'ollama' | 'lmstudio' | 'gateway';
  name: string;
}

// Probe paths match exactly where the app later reads models from
// (see fetchModelsFromServer): OpenAI-compatible servers expose /v1/models,
// Ollama answers its native /api/tags. So a successful probe means the data the
// app needs is actually there, not just that the port is open.
const PROVIDERS = [
  { port: 11434, type: 'ollama' as const,   name: 'Ollama',                probePath: '/api/tags'  },
  { port: 1234,  type: 'lmstudio' as const, name: 'LM Studio',             probePath: '/v1/models' },
  // Off Grid AI Gateway runs on the user's laptop on the same LAN, so it is
  // probed across the subnet on its fixed port just like the others.
  { port: 7878,  type: 'gateway' as const,  name: 'Off Grid AI Gateway',   probePath: '/v1/models' },
];

const TIMEOUT_MS = 500;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 50;

/**
 * Why a probe did not find a server. A bare boolean made every failure look the
 * same, which is exactly what made "scan finds nothing" undiagnosable: a denied
 * iOS Local Network permission, a connection refusal, a wrong probe path, and a
 * host that simply is not there all collapsed to `false`. The class + latency
 * separate them:
 *  - `timeout` at the full TIMEOUT_MS  → nothing answered (host absent, or our
 *    own JS thread was too busy to service the socket in time),
 *  - a fast rejection (single-digit ms) → refused/blocked locally (permission),
 *  - `httpNNN`                          → something IS listening, wrong path/status.
 */
interface ProbeOutcome {
  ok: boolean;
  status?: number;
  errorName?: string;
  errorMessage?: string;
  ms: number;
}

/** Probe a single host:port — reports the outcome class so failures are diagnosable */
async function probe(ip: string, port: number, path: string): Promise<ProbeOutcome> {
  const startedAt = Date.now();
  return new Promise(resolve => {
    const controller = new AbortController();
    const settle = (outcome: Omit<ProbeOutcome, 'ms'>) =>
      resolve({ ...outcome, ms: Date.now() - startedAt });
    const timer = setTimeout(
      () => { controller.abort(); settle({ ok: false, errorName: 'timeout' }); },
      TIMEOUT_MS,
    );

    fetch(`http://${ip}:${port}${path}`, { signal: controller.signal }) // NOSONAR — LAN-only probe; HTTPS requires certs on private IPs
      .then(res => { clearTimeout(timer); settle({ ok: res.status === 200, status: res.status }); })
      .catch((err: unknown) => {
        clearTimeout(timer);
        const error = err as { name?: string; message?: string };
        settle({
          ok: false,
          errorName: error?.name ?? 'Error',
          errorMessage: String(error?.message ?? err).slice(0, 120),
        });
      });
  });
}

/** One outcome's class, e.g. 'ok200' | 'http404' | 'timeout' | 'TypeError'. */
function outcomeClass(outcome: ProbeOutcome): string {
  if (outcome.ok) return 'ok200';
  if (outcome.status != null) return `http${outcome.status}`;
  return outcome.errorName ?? 'error';
}

/**
 * Collapse 254 probe outcomes into ONE log line. The latency spread is the tell:
 * every probe sitting at the full TIMEOUT_MS means nothing on the subnet answered
 * (or the JS thread starved), while a uniformly fast failure means the OS rejected
 * the connections before they left the device.
 */
function summarizeOutcomes(outcomes: ProbeOutcome[]): string {
  if (outcomes.length === 0) return 'no probes ran';
  const byClass = new Map<string, number>();
  let totalMs = 0;
  let minMs = Infinity;
  let maxMs = 0;
  for (const outcome of outcomes) {
    const key = outcomeClass(outcome);
    byClass.set(key, (byClass.get(key) ?? 0) + 1);
    totalMs += outcome.ms;
    minMs = Math.min(minMs, outcome.ms);
    maxMs = Math.max(maxMs, outcome.ms);
  }
  const classes = [...byClass.entries()].map(([k, n]) => `${k}=${n}`).join(' ');
  const avgMs = Math.round(totalMs / outcomes.length);
  return `${classes} | latency avg=${avgMs}ms min=${minMs}ms max=${maxMs}ms`;
}

/** Distinct rejection messages (deduped + counted) — 254 identical errors are ONE signal. */
function distinctErrors(outcomes: ProbeOutcome[], limit = 3): string {
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.errorMessage) {
      counts.set(outcome.errorMessage, (counts.get(outcome.errorMessage) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return 'none';
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([msg, n]) => `"${msg}" x${n}`)
    .join(' ; ');
}

/** Run up to BATCH_SIZE probes concurrently with a small delay between batches */
async function runBatch<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE).map(t => t());
    results.push(...await Promise.all(batch));
    if (i + BATCH_SIZE < tasks.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  return results;
}

/** Parse subnet base from IPv4, e.g. "192.168.1.42" → "192.168.1". Returns null if not a private IPv4. */
function subnetBase(ip: string): string | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  if (!isPrivateIPv4(ip)) return null;
  return parts.slice(0, 3).join('.');
}

/**
 * Common home/office subnets to try when IPv4 detection fails (e.g. device returns IPv6).
 * Intentionally limited to the 2 most common home subnets to avoid a flood of timeouts
 * on devices with no WiFi (e.g. cellular-only) where all probes would time out anyway.
 */
const FALLBACK_SUBNETS = ['192.168.1', '192.168.0'];

/**
 * Quick-probe gateway IPs (.1) on candidate subnets to see if any respond.
 * Returns the first reachable subnet base, or null if none respond.
 * Uses a short timeout so we bail fast when on cellular.
 */
async function findReachableSubnet(subnets: string[], log: (msg: string) => void): Promise<string | null> {
  const GATEWAY_TIMEOUT_MS = 800;
  const results = await Promise.all(
    subnets.map(async (base) => {
      const gateway = `${base}.1`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
      try {
        await fetch(`http://${gateway}:80/`, { signal: controller.signal }); // NOSONAR — LAN gateway probe
        clearTimeout(timer);
        log(`Gateway ${gateway}:80 responded`);
        return base;
      } catch {
        clearTimeout(timer);
        const controller2 = new AbortController();
        const timer2 = setTimeout(() => controller2.abort(), GATEWAY_TIMEOUT_MS);
        try {
          await fetch(`http://${gateway}:11434/`, { signal: controller2.signal }); // NOSONAR — LAN Ollama probe
          clearTimeout(timer2);
          log(`Gateway ${gateway}:11434 responded`);
          return base;
        } catch {
          clearTimeout(timer2);
          log(`Gateway ${gateway} did not respond on :80 or :11434`);
          return null;
        }
      }
    }),
  );
  return results.find(r => r !== null) ?? null;
}

/**
 * Scan the local subnet for LLM servers.
 * Returns discovered servers sorted by IP.
 * Throws with a human-readable message if setup fails (no WiFi IP, non-private network).
 * Errors during probing are swallowed — only setup errors propagate.
 */
export async function discoverLANServers(onLog?: (msg: string) => void): Promise<DiscoveredServer[]> {
  const log = (msg: string) => {
    logger.warn('[Discovery]', msg);
    onLog?.(msg);
  };

  let runningOnEmulator: boolean;
  try {
    runningOnEmulator = await isEmulator();
  } catch (err) {
    log(`isEmulator() threw: ${(err as Error).message} — assuming not emulator`);
    runningOnEmulator = false;
  }
  if (runningOnEmulator) {
    log('Running on emulator — skipping scan (emulator network stack cannot handle concurrent probes)');
    return [];
  }

  log('Not an emulator — proceeding');

  let ip: string | null;
  try {
    ip = await getIpAddress();
  } catch (err) {
    log(`getIpAddress() threw: ${(err as Error).message}`);
    ip = null;
  }

  const ipv6 = ip ? isIPv6(ip) : false;
  const privateV4 = ip ? isPrivateIPv4(ip) : false;
  log(`Device IP: ${ip ?? 'null'} | IPv6: ${ipv6} | privateIPv4: ${privateV4}`);

  let subnetsToScan: string[];

  if (!ip || ip === '0.0.0.0' || ip === '127.0.0.1') {
    log(`No usable IP (got: ${ip ?? 'null'}) — skipping scan`);
    return [];
  } else if (ipv6) {
    log(`IPv6 address detected — probing gateways on fallback subnets: ${FALLBACK_SUBNETS.join(', ')}`);
    const reachableSubnet = await findReachableSubnet(FALLBACK_SUBNETS, log);
    if (reachableSubnet) {
      log(`Gateway responded on subnet ${reachableSubnet} — scanning that subnet only`);
      subnetsToScan = [reachableSubnet];
    } else {
      log('No gateway responded — scanning all fallback subnets anyway (device may still be on WiFi)');
      subnetsToScan = FALLBACK_SUBNETS;
    }
  } else {
    const base = subnetBase(ip);
    if (!base) {
      log(`IP ${ip} is not on a private network — skipping scan`);
      return [];
    }
    log(`IPv4 private address — subnet base: ${base}`);
    subnetsToScan = [base];
  }

  const subnetList = subnetsToScan.map((s) => `${s}.0/24`).join(', ');
  const probeCount = subnetsToScan.length * 254 * PROVIDERS.length;
  log(`Scanning ${subnetsToScan.length} subnet(s): ${subnetList} | ${probeCount} total probes | batch size: ${BATCH_SIZE} | timeout: ${TIMEOUT_MS}ms`);

  try {
    const discovered: DiscoveredServer[] = [];
    const seenEndpoints = new Set<string>();

    const recordIfFound = (target: string, provider: typeof PROVIDERS[0]) => (outcome: ProbeOutcome) => {
      if (!outcome.ok) {
        // A host that ANSWERED but not with 200 is the one failure worth naming
        // individually: something is listening and we are rejecting it (wrong probe
        // path, auth, or a server that reports models elsewhere). Bounded — only
        // responding hosts reach here, never the 254 silent ones.
        if (outcome.status != null) {
          log(`${target}:${provider.port}${provider.probePath} answered HTTP ${outcome.status} in ${outcome.ms}ms — NOT counted (need 200)`);
        }
        return outcome;
      }
      const endpoint = `http://${target}:${provider.port}`; // NOSONAR — LAN endpoint
      if (!seenEndpoints.has(endpoint)) {
        seenEndpoints.add(endpoint);
        log(`Found ${provider.name} at ${target}:${provider.port} (${outcome.ms}ms)`);
        discovered.push({ endpoint, type: provider.type, name: `${provider.name} (${target})` });
      }
      return outcome;
    };

    const scanStartedAt = Date.now();

    await Promise.all(subnetsToScan.map(async (base) => {
      for (const provider of PROVIDERS) {
        log(`Probing ${base}.1-254 for ${provider.name} on port ${provider.port}...`);
        const providerStartedAt = Date.now();
        const tasks = Array.from({ length: 254 }, (_, i) => {
          const target = `${base}.${i + 1}`;
          return () => probe(target, provider.port, provider.probePath).then(recordIfFound(target, provider));
        });
        const outcomes = await runBatch(tasks);
        // The whole point of the sweep's diagnostics: WHY the 254 hosts said no.
        log(`Done probing ${base}.x for ${provider.name} in ${Date.now() - providerStartedAt}ms — ${summarizeOutcomes(outcomes)}`);
        log(`  ${provider.name} rejection messages: ${distinctErrors(outcomes)}`);
      }
    }));

    log(`Scan complete in ${Date.now() - scanStartedAt}ms — found ${discovered.length} server(s)`);
    return discovered;
  } catch (error) {
    log(`Scan error: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
