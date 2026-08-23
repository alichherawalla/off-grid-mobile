/**
 * SPEAK "draw a green robot" at the phone, and get a picture back.
 *
 * The highest-contention journey the app has, reached by one natural action and driven through real
 * hardware. Speaking in voice mode holds the text model, the whisper (STT) sidecar and the TTS
 * sidecar in memory; an image request then routes to image intent, so a fourth model has to find
 * room behind them. Prompt enhancement pulls the text model back in on top of that.
 *
 * The audio is genuinely spoken: `say` renders it and the Mac's speakers play it across the desk
 * into the phone's microphone. Nothing is injected. This is the only way to exercise STT on a
 * physical device - and it works; the sequence below is a script of a run that was confirmed by hand:
 *
 *   Recording -> "A minimalist, flat-design illustration of a simple green square robot" (enhanced)
 *   -> Generating Image -> Generated image loaded -> synced to macOS, Windows and Android.
 *
 *   node scripts/e2e/voice-image-intent-journey.mjs --ios http://192.168.1.14:8100
 *   node scripts/e2e/voice-image-intent-journey.mjs --say "draw a red bicycle"
 *
 * Needs the phone within earshot of the Mac, and the microphone permission already granted - the
 * first run of a fresh install shows a system prompt that blocks the recording and swallows the turn.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EVIDENCE_DIR, flag, specFor } from './mesh-config.mjs';
import { connectSurface } from './sync-surface.mjs';
import {
  ensureChat,
  OUTCOMES,
  outcomeBaseline,
  readResidency,
  speakTurn,
  waitForOutcome,
} from './model-residency.mjs';

const primaryKind = flag('primary', 'ios').toLowerCase();
const spoken = flag('say', 'draw a simple green square robot');
// Let the silence endpoint end the turn instead of tapping stop. Needs a build that has it.
const autoStop = process.argv.includes('--auto-stop');
const runId = `${primaryKind}-voice-image-${Date.now()}`;
const evidenceDir = join(EVIDENCE_DIR, 'voice-image-intent', runId);
await mkdir(evidenceDir, { recursive: true });

const surface = await connectSurface({ ...specFor(primaryKind), passive: true });
const readings = [];
let outcome = 'not reached';
let endedBy = 'not reached';

try {
  console.log(`\n${primaryKind} -> voice image-intent journey`);
  console.log(`saying: "${spoken}"`);
  console.log(`evidence: ${evidenceDir}`);
  console.log('\nturn the Mac volume up and keep the phone within earshot.\n');

  await ensureChat(surface, 'voice');

  readings.push(await readResidency(surface, 'before the spoken request'));

  // THE ACTION: say it out loud. Everything after this is the app's own doing - transcribe, route to
  // image intent, enhance the prompt, load the image model behind whatever already holds memory.
  await ensureChat(surface, 'voice');
  // Counted BEFORE speaking: a chat keeps every picture it has made, so "an image is on screen" is
  // already true on a second run and would pass without the app doing anything.
  const baseline = await outcomeBaseline(surface, OUTCOMES);
  console.log(autoStop ? '\nspeaking, then NOT tapping stop...' : '');
  const turn = await speakTurn(surface, spoken, { autoStop });
  endedBy = turn.endedBy;
  console.log(`\nSPOKE  "${spoken}"  (turn ended by: ${turn.endedBy})`);

  const settled = await waitForOutcome(surface, OUTCOMES, { timeoutMs: 8 * 60_000, baseline });
  outcome = settled.outcome;
  console.log(`\nRESULT ${outcome}`);
  if (outcome === 'refused') {
    // Worth printing in full: a refusal the user can act on is the product behaviour we want, and a
    // refusal with no numbers in it is the gap we already logged.
    for (const label of settled.labels.filter((l) => OUTCOMES.refused.test(l))) {
      console.log(`  ${label}`);
    }
  }

  // Read residency while the image model is still the one that ran, before anything unloads.
  readings.push(await readResidency(surface, 'after the spoken request'));
} finally {
  await writeFile(
    join(evidenceDir, 'voice-image-intent.json'),
    `${JSON.stringify({ runId, primaryKind, spoken, autoStop, outcome, endedBy, readings }, null, 2)}\n`,
  );
  console.log(`\nresult: ${join(evidenceDir, 'voice-image-intent.json')}`);
  await Promise.resolve(surface.close()).catch(() => undefined);
}

if (outcome !== 'image' && outcome !== 'refused') {
  // A timeout here is not a pass with a caveat. Either the picture arrived, or the app said why it
  // could not - anything else means the spoken turn went nowhere and the run proved nothing.
  process.exitCode = 1;
}
