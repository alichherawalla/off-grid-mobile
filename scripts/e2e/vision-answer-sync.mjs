/**
 * Physical Android -> mesh VISION-ONLY journey.
 *
 * A photo goes on, a question is asked about it, and no image is ever generated. That is the whole
 * point: the image journeys always end in a picture, so the thing they can never prove on its own is
 * that a reply DERIVED FROM LOOKING reaches the other devices as text.
 *
 * The assertion is deliberately about the answer, not about a phase. A peer must show the turn, and
 * then a settled assistant reply with words in it - not a thinking indicator, not an empty bubble.
 *
 *   node scripts/e2e/vision-answer-sync.mjs --mesh ios,macos,windows
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AdbClient } from '../android/adb-client.mjs';
import { AppiumAndroidClient } from '../android/appium-client.mjs';
import { EVIDENCE_DIR, flag, specFor } from './mesh-config.mjs';
import { attachNewestPhoto } from './attach-photo.mjs';
import { openNewChat, reachHome, sendPrompt } from './android-producer.mjs';
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

const answerTimeoutMs = minutes('timeout-minutes', 15);
const discoveryTimeoutMs = minutes('discovery-timeout-minutes', 5);
const token = `visiononly${Date.now()}`;
const runId = `vision-answer-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const evidenceDir = join(EVIDENCE_DIR, 'vision-answer-sync', runId);
// The marker LEADS: a peer finds the turn by the chat-list preview, which truncates. It asks for a
// short answer so a settled reply arrives in a sensible time, and it does NOT tell the model to
// avoid generating an image - a question is a question, and steering the router by instruction
// would test the instruction rather than the routing.
const prompt =
  `${token} - look at the attached screenshot and answer in one sentence: ` +
  `what app is on screen?`;

const results = [];
const connected = [];
await mkdir(evidenceDir, { recursive: true });

const adb = new AdbClient(flag('android', '505b53a0'));
const appium = new AppiumAndroidClient(
  flag('appium', process.env.APPIUM_URL ?? 'http://127.0.0.1:4723'),
  flag('android', '505b53a0'),
);

const capture = async (surface, phase) => {
  const path = join(evidenceDir, `${safe(surface.platform)}--${safe(phase)}.png`);
  await surface.screenshot(path);
  return path;
};

/** Whatever this surface currently shows, as one string, whichever family it belongs to. */
const readAll = async (surface) =>
  surface.family === 'electron'
    ? surface.text()
    : (await surface.ui.labels()).join('\n');

/**
 * A finished answer, not a phase.
 *
 * "Settled" is the load-bearing half: a peer that is still streaming has text on screen too, and
 * accepting that would pass on a reply the user never actually received in full.
 */
const waitForSettledAnswer = async (surface, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = await readAll(surface).catch(() => '');
    const live = /Thinking\.\.\.|thinking-indicator|stop-button|Preparing reply|Generating|Loading model/i.test(
      text,
    );
    const marker = text.includes(token);
    // The answer is whatever follows the prompt. Requiring real words rules out an empty bubble.
    const answered = /\b(screen|app|shows?|screenshot|chat|Off Grid)\b/i.test(
      text.replace(prompt, ''),
    );
    if (marker && answered && !live) return text.slice(0, 400);
    if (Date.now() >= deadline) {
      throw new Error(
        `no settled answer (marker=${marker} answered=${answered} live=${live})`,
      );
    }
    await sleep(2000);
  }
};

const observe = async (surface) => {
  const started = Date.now();
  try {
    await surface.openIncomingConversation(token, discoveryTimeoutMs);
    console.log(`OPEN  ${surface.platform.padEnd(8)} synced conversation`);
    const answer = await waitForSettledAnswer(surface.raw ?? surface, answerTimeoutMs);
    const shot = await capture(surface, 'answer');
    results.push({
      platform: surface.platform,
      ok: true,
      answer,
      evidence: { answer: shot },
      ms: Date.now() - started,
    });
    console.log(`PASS  ${surface.platform.padEnd(8)} vision answer arrived and settled`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const shot = await capture(surface, 'FAILED').catch(() => undefined);
    results.push({
      platform: surface.platform,
      ok: false,
      reason,
      evidence: shot ? { failure: shot } : {},
      ms: Date.now() - started,
    });
    console.log(`FAIL  ${surface.platform.padEnd(8)} ${reason}`);
  }
};

try {
  console.log('\nAndroid -> mesh VISION-ONLY journey');
  console.log(`marker: ${token}`);
  console.log(`evidence: ${evidenceDir}\n`);

  await appium.session();
  const cold = flag('cold', 'false') === 'true';
  await reachHome(adb, appium, { cold });
  console.log(`HOME  android  ready${cold ? ' (cold: the model has to load)' : ''}`);
  await appium.close();

  const kinds = ['android', ...observerKinds];
  const raw = await Promise.all(kinds.map((kind) => connectSurface(specFor(kind))));
  connected.push(...raw);
  const surfaces = raw.map((surface, index) => {
    const wrapped = generatedImageSurface(surface);
    // The wrapper knows how to FIND the conversation; the raw surface is what reads it.
    wrapped.raw = surface;
    return { wrapped, surface, kind: kinds[index] };
  });
  const [producer, ...observers] = surfaces;

  await appium.session();
  await openNewChat(appium);
  const attachmentId = await attachNewestPhoto(appium);
  console.log(`ATTACH android  newest photo (${attachmentId})`);
  await sendPrompt(appium, prompt, token);
  console.log('SEND  android  vision-only prompt\n');
  await appium.close();

  await sleep(2000);
  await Promise.all([
    observe(producer.wrapped),
    ...observers.map(({ wrapped }) => observe(wrapped)),
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
