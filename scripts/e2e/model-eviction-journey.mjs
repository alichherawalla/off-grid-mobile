/**
 * What actually leaves memory when the next model needs the room.
 *
 * The jest suite proves the accounting with faked RAM; only a phone can say whether the numbers the
 * app predicts match the memory it then uses, and whether the model it chose to evict is the one a
 * user would expect to lose. This walks residency up one model at a time and reads the sheet between
 * each step, so the transition is recorded rather than inferred:
 *
 *   text alone -> text + STT (a spoken turn) -> + TTS (a spoken reply) -> + image (a picture)
 *
 * Each step is a real gesture. Nothing is pre-marked loaded, and nothing is read from a service - the
 * evidence is the same Models sheet the user reads, captured at every stage.
 *
 *   node scripts/e2e/model-eviction-journey.mjs --ios http://192.168.1.14:8100
 *
 * The interesting output is not "it worked". It is the residency table across the four stages: which
 * models co-resided, which disappeared when the image model loaded, and what each was said to cost.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EVIDENCE_DIR, flag, specFor } from './mesh-config.mjs';
import { connectSurface } from './sync-surface.mjs';
import {
  ensureChat,
  MODEL_KINDS,
  OUTCOMES,
  readResidency,
  speakTurn,
  waitForOutcome,
} from './model-residency.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const primaryKind = flag('primary', 'ios').toLowerCase();
const runId = `${primaryKind}-eviction-${Date.now()}`;
const evidenceDir = join(EVIDENCE_DIR, 'model-eviction', runId);
await mkdir(evidenceDir, { recursive: true });

const surface = await connectSurface({ ...specFor(primaryKind), passive: true });
const readings = [];

/** Send a typed message and wait for a reply, so the text model is genuinely resident. */
const typeAndSend = async (text) => {
  await surface.ui.tapWhenReady('chat-input', { timeoutMs: 20_000 });
  await surface.ui.type(text);
  await sleep(800);
  await surface.ui.tapWhenReady('send-button', { timeoutMs: 20_000 });
};

try {
  console.log(`\n${primaryKind} -> model eviction journey`);
  console.log(`evidence: ${evidenceDir}`);

  await ensureChat(surface, 'chat');
  readings.push(await readResidency(surface, '1. at rest'));
  await ensureChat(surface, 'chat');

  // STEP 1 - the text model, loaded by using it.
  await typeAndSend('say hello in three words');
  const typed = await waitForOutcome(
    surface,
    { replied: /hello/i, refused: OUTCOMES.refused, error: OUTCOMES.error },
    { timeoutMs: 4 * 60_000 },
  );
  // Reported, not assumed: labelling the next reading "after a typed reply" while the reply never
  // came would put a caption on the evidence that the run did not earn.
  console.log(`\nTYPED  ${typed.outcome}`);
  readings.push(await readResidency(surface, `2. after a typed turn (${typed.outcome})`));

  // STEP 2 - speaking adds the STT sidecar, and the spoken reply adds TTS, on top of the text model.
  await ensureChat(surface, 'voice');
  await speakTurn(surface, 'what is two plus two');
  const spoken = await waitForOutcome(
    surface,
    { replied: /four|4/i, refused: OUTCOMES.refused, error: OUTCOMES.error },
    { timeoutMs: 4 * 60_000 },
  );
  console.log(`\nSPOKEN ${spoken.outcome}`);
  readings.push(await readResidency(surface, `3. after a spoken turn (${spoken.outcome})`));

  // STEP 3 - the image model now has to find room behind all three.
  await ensureChat(surface, 'voice');
  await speakTurn(surface, 'draw a small blue square');
  const settled = await waitForOutcome(surface, OUTCOMES, { timeoutMs: 8 * 60_000 });
  console.log(`\nIMAGE  ${settled.outcome}`);
  readings.push(await readResidency(surface, '4. after an image request (contention)'));

  // The whole point of the run: what changed, stage by stage.
  console.log('\n=== residency across the journey ===');
  for (const reading of readings) {
    console.log(
      `  ${reading.phase.padEnd(46)} ${reading.resident.join(' + ') || '(nothing)'}`,
    );
  }
  // Named explicitly: a model that never becomes resident across the whole journey is the finding,
  // not an omission. The text model refusing to load while three others sit in memory is exactly the
  // contention this run exists to surface.
  const everResident = new Set(readings.flatMap((reading) => reading.resident));
  const never = MODEL_KINDS.filter((kind) => !everResident.has(kind));
  if (never.length > 0) {
    console.log(`\n  never resident at any stage: ${never.join(', ')}`);
  }
} finally {
  await writeFile(
    join(evidenceDir, 'eviction.json'),
    `${JSON.stringify({ runId, primaryKind, readings }, null, 2)}\n`,
  );
  console.log(`\nresult: ${join(evidenceDir, 'eviction.json')}`);
  await Promise.resolve(surface.close()).catch(() => undefined);
}
