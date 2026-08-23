/**
 * Physical Android -> mesh VISION + generated-image journey.
 *
 * The existing image journey generates from words alone. This one starts from a picture: the newest
 * photo on the device is attached to the message, so the reply has to LOOK at something before it
 * can make anything. Two capabilities in one turn, and the attachment has to reach the peers as well
 * as the answer.
 *
 * Mobile has no image-to-image path - there is no init image, strength or denoise anywhere in the
 * app - so "change it" is honestly a two-step: vision reads the photo, and image generation draws
 * from what it read. Asserting a true edit here would be asserting a feature that does not exist.
 *
 *   node scripts/e2e/vision-image-sync.mjs --mesh ios,macos,windows
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AdbClient } from '../android/adb-client.mjs';
import { AppiumAndroidClient } from '../android/appium-client.mjs';
import { EVIDENCE_DIR, flag, specFor } from './mesh-config.mjs';
import { attachNewestPhoto } from './attach-photo.mjs';
import { generatedImageSurface } from './generated-image-surface.mjs';
import { connectSurface } from './sync-surface.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safe = (value) => value.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '');
const minutes = (name, fallback) => Number(flag(name, String(fallback))) * 60_000;

const observerKinds = flag('mesh', 'ios,macos,windows')
  .split(',')
  .map((kind) => kind.trim().toLowerCase())
  .filter(Boolean);
if (observerKinds.includes('android')) {
  throw new Error('Android is the producer; do not repeat it in --mesh');
}

const liveTimeoutMs = minutes('live-timeout-minutes', 8);
const finalTimeoutMs = minutes('timeout-minutes', 25);
const discoveryTimeoutMs = minutes('discovery-timeout-minutes', 5);
const token = `visionproof${Date.now()}`;
const runId = `vision-image-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const evidenceDir = join(EVIDENCE_DIR, 'vision-image-sync', runId);
// The marker leads. A peer finds this turn by the chat-list PREVIEW, which truncates - so a marker
// at the end of a long prompt never reaches the peers and every observer times out on a
// conversation that actually synced perfectly well. The rest asks for BOTH capabilities: the reply
// cannot answer without looking, and cannot finish without drawing.
const prompt =
  `${token} - look at the attached screenshot and describe what app it shows, ` +
  `then generate an image of that same screen redrawn as a simple flat illustration.`;

const results = [];
const connected = [];
await mkdir(evidenceDir, { recursive: true });

const adb = new AdbClient(flag('android', '505b53a0'));
const appium = new AppiumAndroidClient(
  flag('appium', process.env.APPIUM_URL ?? 'http://127.0.0.1:4723'),
  flag('android', '505b53a0'),
);

const present = async (testId) => {
  try {
    await appium.findByTestId(testId);
    return true;
  } catch {
    return false;
  }
};

const waitForControl = async (testId, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await present(testId))) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${testId}`);
    await sleep(700);
  }
};

const capture = async (surface, phase) => {
  const path = join(evidenceDir, `${safe(surface.platform)}--${safe(phase)}.png`);
  await surface.screenshot(path);
  return path;
};

const observe = async (surface, baseline) => {
  const started = Date.now();
  try {
    await surface.openIncomingConversation(token, discoveryTimeoutMs);
    console.log(`OPEN  ${surface.platform.padEnd(8)} synced conversation`);
    const live = await surface.waitForLiveState(liveTimeoutMs);
    const liveShot = await capture(surface, 'live');
    console.log(`LIVE  ${surface.platform.padEnd(8)} ${String(live).split('\n')[0]}`);
    const final = await surface.waitForFinal(token, finalTimeoutMs);
    const finalShot = await capture(surface, 'final');
    console.log(`FINAL ${surface.platform.padEnd(8)} grouped image is decoded`);
    const gallery = await surface.verifyGallery(token, baseline, finalTimeoutMs);
    const galleryShot = await capture(surface, 'gallery');
    results.push({
      platform: surface.platform,
      ok: true,
      live,
      final,
      gallery,
      evidence: { live: liveShot, final: finalShot, gallery: galleryShot },
      ms: Date.now() - started,
    });
    console.log(`PASS  ${surface.platform.padEnd(8)} live, final image, and Gallery`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failureShot = await capture(surface, 'FAILED').catch(() => undefined);
    results.push({
      platform: surface.platform,
      ok: false,
      reason,
      evidence: failureShot ? { failure: failureShot } : {},
      ms: Date.now() - started,
    });
    console.log(`FAIL  ${surface.platform.padEnd(8)} ${reason}`);
  }
};

try {
  console.log('\nAndroid -> mesh VISION + generated-image journey');
  console.log(`marker: ${token}`);
  console.log(`evidence: ${evidenceDir}\n`);

  // Appium and `adb shell uiautomator dump` cannot both own UiAutomator: the device runs ONE
  // instance, so an open Appium session makes every adb dump fail - and the failure reads as "could
  // not read the view hierarchy", which looks like a wedged phone rather than a driver collision.
  // So the session is opened only around the steps that need Appium, and closed before the surface
  // layer reads anything.
  // Relaunch first, then walk back. Pressing back until a screen appears walks straight OUT of the
  // app and onto the phone's launcher, where none of its screens exist and every further press is
  // wasted - the failure then reads as "would not return to its home screen" while the app is not
  // even running.
  await adb.session(flag('package', 'ai.offgridmobile.dev'));
  await sleep(3000);
  await appium.session();
  for (let attempt = 0; attempt < 8 && !(await present('home-screen')); attempt += 1) {
    await adb.back().catch(() => undefined);
    await sleep(900);
    if (!(await present('home-screen')) && !(await present('chat-screen'))) {
      // Back may have left the app altogether; bring it forward and keep going.
      await adb.session(flag('package', 'ai.offgridmobile.dev')).catch(() => undefined);
      await sleep(2000);
    }
  }
  if (!(await present('home-screen'))) {
    throw new Error('Android would not return to its home screen');
  }
  console.log('HOME  android  ready\n');
  await appium.close();

  const kinds = ['android', ...observerKinds];
  const raw = await Promise.all(kinds.map((kind) => connectSurface(specFor(kind))));
  connected.push(...raw);
  const [producer, ...observers] = raw.map(generatedImageSurface);
  const baselines = new Map(
    await Promise.all(
      [producer, ...observers].map(async (surface) => [
        surface.platform,
        await surface.galleryBaseline(),
      ]),
    ),
  );

  // Image mode is deliberately NOT forced. Forcing it routes straight to the diffusion model, which
  // is the one thing that would stop the photo ever being looked at. The prompt asks for an image,
  // so auto-detect has to be what decides - and if it declines, that is a finding rather than
  // something to force past.
  await appium.session();
  await waitForControl('new-chat-button', 40_000);
  await appium.clickTestId('new-chat-button');
  await waitForControl('chat-screen', 30_000);

  const attachmentId = await attachNewestPhoto(appium);
  console.log(`ATTACH android  newest photo (${attachmentId})`);
  await appium.replaceTestId('chat-input', prompt);
  await appium.clickTestId('send-button');
  console.log('SEND  android  vision + image prompt\n');
  // Hand UiAutomator back before the surfaces start reading the mesh.
  await appium.close();

  await sleep(2000);
  await Promise.all([
    observe(producer, baselines.get(producer.platform)),
    ...observers.map((surface) => observe(surface, baselines.get(surface.platform))),
  ]);
} finally {
  const passed = results.filter((result) => result.ok).length;
  await writeFile(
    join(evidenceDir, 'result.json'),
    `${JSON.stringify({ token, prompt, results }, null, 2)}\n`,
  );
  console.log(`\n${passed}/${results.length} surfaces passed`);
  console.log(`result: ${join(evidenceDir, 'result.json')}`);
  await appium.close().catch(() => undefined);
  await Promise.all(
    connected.map((surface) => Promise.resolve(surface.close()).catch(() => undefined)),
  );
  if (results.length === 0 || passed !== results.length) process.exitCode = 1;
}
