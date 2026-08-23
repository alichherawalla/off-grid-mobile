/**
 * Physical phone -> model RESIDENCY under a real image request.
 *
 * What actually loads, what gets evicted, and what it really costs - read off a real device instead
 * of estimated. The jest suite proves the accounting with faked RAM; only a phone can say whether the
 * numbers the app predicts match the memory it then uses.
 *
 * The journey is one natural action: with a text model loaded, ask for a picture. Image-intent
 * routing sends it to the image model, which has to find room behind whatever is already resident -
 * the highest-contention path the app has, reached by typing one sentence.
 *
 *   node scripts/e2e/model-residency-journey.mjs --ios http://192.168.1.14:8100
 *   node scripts/e2e/model-residency-journey.mjs --prompt "draw a red bicycle"
 *
 * This is the TYPED half. The spoken half is voice-image-intent-journey.mjs, which plays the request
 * out of the Mac's speakers into the phone's microphone - the transcript is where the two meet, so
 * this script covers everything after it and that one covers the microphone too.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EVIDENCE_DIR, flag, specFor } from './mesh-config.mjs';
import { connectSurface } from './sync-surface.mjs';
import {
  OUTCOMES,
  readResidency,
  setChatMode,
  waitForOutcome,
} from './model-residency.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const primaryKind = flag('primary', 'ios').toLowerCase();
const prompt = flag('prompt', 'draw a simple green square robot');
const runId = `${primaryKind}-residency-${Date.now()}`;
const evidenceDir = join(EVIDENCE_DIR, 'model-residency', runId);
const readings = [];
await mkdir(evidenceDir, { recursive: true });

const surface = await connectSurface({ ...specFor(primaryKind), passive: true });
let outcome = 'not reached';
try {
  console.log(`\n${primaryKind} -> model residency journey`);
  console.log(`prompt: ${prompt}`);
  console.log(`evidence: ${evidenceDir}`);

  // A chat to type into. The app may be left in voice mode by a previous run, where there is no text
  // field at all - so put it in typing mode rather than assuming, then get to a chat if we are not
  // already in one.
  const labels = (await surface.ui.labels()).map((label) => label.trim());
  if (!labels.includes('chat-screen')) {
    await surface.ui.tapWhenReady('home-tab', { timeoutMs: 20_000 }).catch(() => undefined);
    await surface.ui.tapWhenReady('new-chat-button', { timeoutMs: 30_000 });
  }
  if (!(await surface.ui.labels()).some((label) => label.trim() === 'chat-input')) {
    await setChatMode(surface, 'chat');
  }
  await surface.ui.waitForLabel('chat-input', {
    label: `${primaryKind} chat`,
    timeoutMs: 30_000,
  });

  readings.push(await readResidency(surface, 'before the request'));

  // THE ACTION: ask for a picture in a text chat. Image-intent routing sends this to the image model,
  // which must find room behind whatever is already resident.
  await surface.ui.tapWhenReady('chat-input', { timeoutMs: 20_000 });
  await surface.ui.type(prompt);
  await sleep(800);
  await surface.ui.tapWhenReady('send-button', { timeoutMs: 20_000 });
  console.log(`\nSENT  ${prompt}`);

  const settled = await waitForOutcome(surface, OUTCOMES, {
    timeoutMs: Number(flag('timeout-minutes', '8')) * 60_000,
  });
  outcome = settled.outcome;
  console.log(`\nIMAGE  ${outcome}`);
  if (outcome === 'refused') {
    for (const label of settled.labels.filter((l) => OUTCOMES.refused.test(l))) {
      console.log(`  ${label}`);
    }
  }

  readings.push(await readResidency(surface, 'after the request'));
} finally {
  await writeFile(
    join(evidenceDir, 'residency.json'),
    `${JSON.stringify({ runId, primaryKind, prompt, outcome, readings }, null, 2)}\n`,
  );
  console.log(`\nresult: ${join(evidenceDir, 'residency.json')}`);
  await Promise.resolve(surface.close()).catch(() => undefined);
}

if (outcome !== 'image' && outcome !== 'refused') process.exitCode = 1;
