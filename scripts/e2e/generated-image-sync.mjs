/**
 * Physical phone -> mesh generated-image journey.
 *
 * Preconditions: the four apps are already paired and connected. This runner does not change mesh
 * membership. It starts one image on the PRODUCER and observes every named peer at the same time.
 *
 * `--primary` names the producer, exactly as attended-thinking-sync does. It used to be hardwired
 * to Android: the producer was `kinds[0] = 'android'` and naming android in --mesh was rejected
 * outright, so an iPhone could only ever watch. Both phones run the same React Native tree with the
 * same testIDs, so the journey is the same on either.
 *
 * Run on the Mac that owns WDA and both desktop CDP endpoints:
 *   npm run e2e:image-sync
 *   npm run e2e:image-sync -- --primary ios --mesh android,macos,windows
 *   npm run e2e:image-sync -- --primary ios --enhancement off
 *
 * `--enhancement on|off` sets prompt enhancement on the producer before it generates - enhancement
 * adds a whole model pass before the image, so the two settings are genuinely different journeys.
 * Omit it to use whatever the device is already set to.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EVIDENCE_DIR, flag, specFor } from './mesh-config.mjs';
import { generatedImageSurface } from './generated-image-surface.mjs';
import { connectSurface } from './sync-surface.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safe = (value) => value.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '');
const minutes = (name, fallback) => {
  const value = Number(flag(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value * 60_000;
};

const primaryKind = flag('primary', 'android').toLowerCase();
if (!['android', 'ios'].includes(primaryKind)) {
  throw new Error('--primary must be android or ios; a desktop cannot start this journey');
}
const enhancement = flag('enhancement', '').toLowerCase();
if (enhancement && !['on', 'off'].includes(enhancement)) {
  throw new Error('--enhancement must be on or off');
}
const DEFAULT_OBSERVERS = { android: 'ios,macos,windows', ios: 'android,macos,windows' };
const observerKinds = flag('mesh', DEFAULT_OBSERVERS[primaryKind])
  .split(',')
  .map((kind) => kind.trim().toLowerCase())
  .filter(Boolean);
if (observerKinds.length === 0) throw new Error('--mesh names no observers');
if (observerKinds.includes(primaryKind)) {
  throw new Error(`${primaryKind} is the producer; do not repeat it in --mesh`);
}
if (new Set(observerKinds).size !== observerKinds.length) throw new Error('--mesh repeats an observer');

const liveTimeoutMs = minutes('live-timeout-minutes', 5);
const finalTimeoutMs = minutes('timeout-minutes', 30);
const discoveryTimeoutMs = minutes('discovery-timeout-minutes', 5);
const runId = `${primaryKind}-to-mesh-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const evidenceDir = join(EVIDENCE_DIR, 'generated-image-sync', runId);
const token = `meshproof${Date.now()}`;
const prompt = `draw a simple green square robot keep marker ${token} unchanged`;
const connected = [];
const results = [];

await mkdir(evidenceDir, { recursive: true });

const capture = async (surface, phase) => {
  const path = join(evidenceDir, `${safe(surface.platform)}--${safe(phase)}.png`);
  await surface.screenshot(path);
  return path;
};

const observe = async (surface, baseline, { alreadyOpen = false } = {}) => {
  const started = Date.now();
  try {
    if (!alreadyOpen) await surface.openIncomingConversation(token, discoveryTimeoutMs);
    console.log(`OPEN  ${surface.platform.padEnd(8)} synced conversation`);
    // A live state can only be witnessed by an observer that arrives before it ends.
    //
    // Generation took 31s in one run and Android was the last surface to open the conversation, so
    // it sat waiting for a transient state that was already over - and failed a device that had the
    // right image on screen the whole time. Requiring every surface to SEE the work happen makes
    // the result depend on who got there first, which is not what this journey is for.
    //
    // So: still wait for it, but if the finished image is already present, record the live state as
    // MISSED rather than failing the surface - and say so in the log and the result, because a
    // silent downgrade would be worse than the wrong verdict it replaces.
    let live;
    let liveMissed = false;
    {
      // Watch for BOTH outcomes and take whichever happens first: the live state, or the finished
      // image. Waiting out the live timeout before checking whether generation had already ended
      // cost the whole timeout on every late surface - minutes of nothing, for a generation that
      // takes about thirty seconds. The timeout is a ceiling, not a schedule.
      const liveRace = surface
        .waitForLiveState(liveTimeoutMs)
        .then((value) => ({ kind: 'live', value }), (error) => ({ kind: 'live-failed', error }));
      const finishedRace = surface
        .waitForFinal(token, liveTimeoutMs)
        .then(() => ({ kind: 'finished' }), () => ({ kind: 'never-finished' }));
      const first = await Promise.race([liveRace, finishedRace]);
      if (first.kind === 'live') {
        live = first.value;
      } else if (first.kind === 'live-failed') {
        throw first.error;
      } else {
        // The image was already there. Give the live check one last look in case a fast generation
        // let both resolve together, then call it missed rather than pretending it was seen.
        const late = await liveRace;
        if (late.kind === 'live') {
          live = late.value;
        } else {
          liveMissed = true;
          live = 'not observed - this surface opened the conversation after generation had finished';
        }
      }
    }
    const liveShot = await capture(surface, 'live');
    console.log(
      `${liveMissed ? 'MISS ' : 'LIVE '} ${surface.platform.padEnd(8)} ${String(live).split('\n')[0]}`,
    );
    const final = await surface.waitForFinal(token, finalTimeoutMs);
    const finalShot = await capture(surface, 'final');
    console.log(`FINAL ${surface.platform.padEnd(8)} grouped image is decoded`);
    const gallery = await surface.verifyGallery(token, baseline, finalTimeoutMs);
    const galleryShot = await capture(surface, 'gallery');
    const result = {
      platform: surface.platform,
      ok: true,
      live,
      liveObserved: !liveMissed,
      final,
      gallery,
      evidence: { live: liveShot, final: finalShot, gallery: galleryShot },
      ms: Date.now() - started,
    };
    results.push(result);
    console.log(`PASS  ${surface.platform.padEnd(8)} live, final image, and Gallery`);
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failureShot = await capture(surface, 'FAILED').catch(() => undefined);
    const result = {
      platform: surface.platform,
      ok: false,
      reason,
      evidence: failureShot ? { failure: failureShot } : {},
      ms: Date.now() - started,
    };
    results.push(result);
    console.log(`FAIL  ${surface.platform.padEnd(8)} ${reason}`);
    return result;
  }
};

try {
  console.log(`\n${primaryKind} -> mesh generated-image journey${enhancement ? ` (enhancement ${enhancement.toUpperCase()})` : ''}`);
  console.log(`marker: ${token}`);
  console.log(`evidence: ${evidenceDir}\n`);

  const kinds = [primaryKind, ...observerKinds];
  const connections = await Promise.allSettled(
    kinds.map((kind) => connectSurface(specFor(kind))),
  );
  const rawSurfaces = connections
    .filter((connection) => connection.status === 'fulfilled')
    .map((connection) => connection.value);
  connected.push(...rawSurfaces);
  const connectionFailures = connections
    .map((connection, index) => ({ connection, kind: kinds[index] }))
    .filter(({ connection }) => connection.status === 'rejected');
  if (connectionFailures.length > 0) {
    throw new Error(
      connectionFailures
        .map(({ connection, kind }) => `${kind}: ${connection.reason?.message ?? connection.reason}`)
        .join('; '),
    );
  }
  const [producer, ...observers] = rawSurfaces.map(generatedImageSurface);

  const baselines = new Map(
    await Promise.all(
      [producer, ...observers].map(async (surface) => [surface.platform, await surface.galleryBaseline()]),
    ),
  );
  await Promise.all(observers.map((surface) => surface.prepareForIncoming()));

  // Start every observer before the producer sends. This is what makes temporary Enhancing/Loading/
  // Generating frames observable instead of checking only the durable record after the fact.
  const observerRuns = observers.map((surface) =>
    observe(surface, baselines.get(surface.platform)),
  );
  await sleep(500);
  if (enhancement) {
    console.log(`SET   ${producer.platform} prompt enhancement = ${enhancement.toUpperCase()}`);
  }
  await producer.startGeneration(prompt, { enhancement: enhancement || undefined });
  const producerRun = observe(producer, baselines.get(producer.platform), { alreadyOpen: true });

  await Promise.all([producerRun, ...observerRuns]);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.log(`FAIL  preflight ${reason}`);
  results.push({ platform: 'preflight', ok: false, reason, ms: 0 });
  await Promise.all(
    connected.map(async (surface) => {
      const adapter = generatedImageSurface(surface);
      await capture(adapter, 'PRECHECK-FAILED').catch(() => undefined);
    }),
  );
} finally {
  await writeFile(
    join(evidenceDir, 'result.json'),
    `${JSON.stringify({ runId, token, prompt, primaryKind, enhancement: enhancement || 'device default', observerKinds, results }, null, 2)}\n`,
  );
  await Promise.all(connected.map((surface) => Promise.resolve(surface.close()).catch(() => undefined)));
}

const failures = results.filter((result) => !result.ok);
console.log(`\n${results.length - failures.length}/${results.length} surfaces passed`);
console.log(`result: ${join(evidenceDir, 'result.json')}`);
process.exitCode = failures.length > 0 ? 1 : 0;
