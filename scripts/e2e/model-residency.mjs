/**
 * Reading model residency, and speaking to the phone, from one place.
 *
 * Every residency journey asks the same two questions - what is in memory, and what happens when a
 * real request needs more - so the vocabulary for asking lives here rather than being re-typed per
 * script. The selectors are the ones verified on the device, not guessed from source.
 *
 * The speech half is the part that used to be impossible. A physical phone's microphone is hardware:
 * WDA can tap and type, devicectl can copy files, and neither can inject audio. So we play the words
 * out of the Mac's speakers and let the phone hear them. That is not a simulation of the STT path -
 * it IS the STT path, microphone included, and it has been confirmed end to end: spoken "draw a
 * simple green square robot" -> whisper -> image intent -> a rendered picture.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every model kind the residency sheet can list, in the order the sheet shows them. */
export const MODEL_KINDS = ['text', 'image', 'voice', 'speech'];

const labelsOf = async (surface) =>
  (await surface.ui.labels()).map((label) => label.trim()).filter(Boolean);

/**
 * What the app says is in memory right now, read from its own Models sheet.
 *
 * The sheet is the user's view of residency and each row carries the RAM the app attributes to that
 * model, so one surface answers both "what is loaded" and "what does it think that costs". Read from
 * the rendered UI on purpose: a number taken from a service could agree with itself while the screen
 * showed something else.
 */
export const readResidency = async (surface, phase) => {
  // Only open it if it is not open already. Tapping the chip while the sheet is up dismisses it, so
  // an unconditional tap turns a second reading into a closed sheet and a timeout.
  const isOpen = async () =>
    (await surface.ui.labels()).some((label) => label.trim() === 'models-row-text');
  // Retried, because the chip is not always hittable the instant a turn finishes - the keyboard may
  // still be dismissing, or the header may be mid-update - and a single tap that misses reads as an
  // empty residency rather than as a control that was never pressed.
  for (let attempt = 0; attempt < 4 && !(await isOpen()); attempt += 1) {
    // tapLabel, not tapWhenReady: the latter does not open this sheet on iOS.
    await surface.ui.tapLabel('model-selector').catch(() => undefined);
    await sleep(1_500);
  }
  if (!(await isOpen())) {
    throw new Error(
      `could not open the models sheet to read residency at "${phase}" - the chip never responded`,
    );
  }
  // The per-model RAM figures live in the row's composed label, and iOS does not always compose it
  // straight away - it can take several reads after the sheet is up. Polled rather than sampled
  // twice, because the cost is most of what this is for; if it never arrives we still report the
  // resident set, which comes from the row ids and is always present.
  //
  // Matched anywhere in the label rather than at the start: the row's composed label opens with an
  // icon-font glyph (U+F185 and friends), so anchoring to ", IMAGE," silently never matches and every
  // reading comes back with no costs in it.
  const detailFor = (list, kind) =>
    list.find((label) => label.includes(`, ${kind.toUpperCase()},`)) ?? null;
  let labels = await labelsOf(surface);
  const hasDetail = (list) => MODEL_KINDS.some((kind) => detailFor(list, kind));
  for (let attempt = 0; attempt < 8 && !hasDetail(labels); attempt += 1) {
    await sleep(1_000);
    labels = await labelsOf(surface);
  }

  // All four rows ALWAYS render - a row is the model slot, not the model. What marks a model as
  // resident is its RAM line, which only exists once something is actually in memory. Reading the
  // rows instead would report every device as fully loaded.
  const reading = {
    phase,
    at: new Date().toISOString(),
    resident: MODEL_KINDS.filter((kind) => labels.includes(`models-row-${kind}-ram`)),
    // Every line that mentions a size, so a cost the rows do not carry is still captured.
    memoryLines: labels.filter((label) => /\b(GB|MB)\b/.test(label)),
  };
  for (const kind of MODEL_KINDS) reading[kind] = detailFor(labels, kind);

  console.log(`\n--- residency: ${phase} ---`);
  console.log(`  in memory: ${reading.resident.join(' + ') || '(nothing)'}`);
  for (const kind of MODEL_KINDS) {
    const mark = reading.resident.includes(kind) ? '*' : ' ';
    console.log(`  ${mark} ${kind.padEnd(7)} ${reading[kind] ?? '(no row detail)'}`);
  }

  await surface.ui.tapLabel('Done').catch(() => undefined);
  await sleep(800);
  return reading;
};

/**
 * Say something out loud, next to the phone.
 *
 * `say` renders it and `afplay` blocks until the audio finishes, so the caller knows the sentence is
 * over rather than guessing at a duration. Volume is raised deliberately: the phone is listening
 * across a desk, and a quiet Mac is the difference between a transcript and silence.
 */
export const speakFromMac = async (text, { voice = 'Samantha', volume = 90 } = {}) => {
  const file = join(tmpdir(), `offgrid-e2e-${text.replace(/\W+/g, '-').slice(0, 40)}.aiff`);
  await run('say', ['-v', voice, '-o', file, text]);
  await run('osascript', ['-e', `set volume output volume ${volume}`]);
  await run('afplay', [file]);
  return file;
};

/**
 * Get to a chat that is ready for the mode we want, from wherever the app happens to be.
 *
 * Journeys are run back to back and each leaves the app somewhere: a sheet open, voice mode on from
 * the last run, a different tab. Starting from "wherever it was" is what makes a rig flaky, and the
 * failure reads as a missing control rather than as a leftover from the previous script.
 */
export const ensureChat = async (surface, mode = 'chat') => {
  const labels = async () => (await surface.ui.labels()).map((l) => l.trim());
  let current = await labels();

  // A sheet from a previous step covers everything underneath it.
  if (current.includes('models-row-text') || current.includes('app-sheet-close')) {
    await surface.ui.tapLabel('Done').catch(() => undefined);
    await sleep(800);
    current = await labels();
  }
  if (!current.includes('chat-screen')) {
    await surface.ui.tapLabel('home-tab').catch(() => undefined);
    await sleep(800);
    await surface.ui.tapWhenReady('new-chat-button', { timeoutMs: 30_000 });
    await sleep(1_200);
    current = await labels();
  }

  const wants = mode === 'voice' ? 'voice-record-button-audio' : 'chat-input';
  if (!current.includes(wants)) await setChatMode(surface, mode);
  await surface.ui.waitForLabel(wants, {
    label: `${surface.platform} chat (${mode})`,
    timeoutMs: 30_000,
  });
};

/** Switch the chat between typing and talking, the way a person does - the header chip. */
export const setChatMode = async (surface, mode) => {
  await surface.ui.tapWhenReady('chat-mode-toggle', { timeoutMs: 20_000 });
  const option = mode === 'voice' ? 'mode-option-audio' : 'mode-option-chat';
  await surface.ui.tapWhenReady(option, { timeoutMs: 20_000 });
  await sleep(600);
};

/**
 * One spoken turn: start recording, say it out loud, stop.
 *
 * A short pause on each side of the sentence so the opening syllable is not clipped by the recorder
 * still starting, and so the tail is not cut before whisper has seen it.
 */
export const speakTurn = async (surface, text, { settleMs = 1_500, autoStop = false } = {}) => {
  await surface.ui.tapWhenReady('voice-record-button-audio', { timeoutMs: 20_000 });
  await sleep(settleMs);
  await speakFromMac(text);

  if (!autoStop) {
    await sleep(settleMs);
    // Tapping stop works on every build and is what a user can always do.
    await surface.ui.tapWhenReady('voice-record-button-audio', { timeoutMs: 20_000 });
    return { text, endedBy: 'tap' };
  }

  // Nothing is pressed. The turn has to end by itself, which is the whole claim.
  //
  // The BEFORE state is asserted first. "Not recording any more" is free if recording never started -
  // the tap could have missed, or the mic permission dialog could have eaten it - and a check that
  // only looks at the after-state calls that a pass. It is also why this waits for the label to
  // actually READ as recording before it starts timing the silence.
  const recording = async () =>
    (await surface.ui.labels()).some((label) => /recording|tap to stop/i.test(label.trim()));

  const armedBy = Date.now() + 8_000;
  let started = false;
  while (Date.now() < armedBy && !started) {
    started = await recording();
    if (!started) await sleep(500);
  }
  if (!started) {
    console.log('  NEVER STARTED recording - the record tap did not take; not an auto-stop result');
    return { text, endedBy: 'never started' };
  }

  const quietFrom = Date.now();
  const deadline = quietFrom + 25_000;
  while (Date.now() < deadline) {
    await sleep(500);
    if (!(await recording())) {
      const waited = Math.round((Date.now() - quietFrom) / 100) / 10;
      console.log(`  auto-stopped after ~${waited}s (measured from confirmed recording state)`);
      return { text, endedBy: 'silence', quietSeconds: waited };
    }
  }
  console.log('  STILL RECORDING after 25s - auto-stop did not fire; tapping stop');
  await surface.ui.tapWhenReady('voice-record-button-audio', { timeoutMs: 20_000 });
  return { text, endedBy: 'tap (auto-stop failed)' };
};

/**
 * Wait for one of several outcomes, naming which arrived.
 *
 * Journeys care about "the picture appeared OR the app refused" far more than about a single happy
 * label, and a refusal that is reported as a timeout hides the very message we want to read.
 */
export const waitForOutcome = async (surface, outcomes, { timeoutMs, pollMs = 3_000, baseline } = {}) => {
  const deadline = Date.now() + (timeoutMs ?? 6 * 60_000);
  // How many already matched BEFORE the request. A chat keeps every picture it has ever produced, so
  // "a generated image is on screen" is true the moment a second run starts - it would pass without
  // the app doing anything at all. Only an INCREASE counts.
  const counts = (labels, pattern) => labels.filter((label) => pattern.test(label)).length;
  const before = baseline ?? {};
  let lastLabels = [];
  while (Date.now() < deadline) {
    lastLabels = await labelsOf(surface);
    for (const [name, pattern] of Object.entries(outcomes)) {
      if (counts(lastLabels, pattern) > (before[name] ?? 0)) {
        return { outcome: name, labels: lastLabels };
      }
    }
    await sleep(pollMs);
  }
  return { outcome: 'timeout', labels: lastLabels };
};

/** Count each outcome BEFORE acting, so waitForOutcome can require a new one rather than any one. */
export const outcomeBaseline = async (surface, outcomes) => {
  const labels = await labelsOf(surface);
  const baseline = {};
  for (const [name, pattern] of Object.entries(outcomes)) {
    baseline[name] = labels.filter((label) => pattern.test(label)).length;
  }
  return baseline;
};

/** The labels a residency journey watches for, in one place so the journeys cannot drift apart. */
export const OUTCOMES = {
  image: /generated image loaded|generated-image/i,
  refused: /not enough memory|insufficient memory|needs about/i,
  error: /something went wrong|failed to load/i,
};
