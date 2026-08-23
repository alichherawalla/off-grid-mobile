/**
 * Physical phone -> mesh MULTI-ATTACHMENT journey.
 *
 * One message carrying THREE attachments of three different origins - a photo taken with the
 * camera, a photo chosen from the library, and a PDF from the document picker - then the same
 * message proved on every peer.
 *
 * This is the composer path, and it is deliberately not the project Knowledge Base path: a
 * Knowledge Base document is attached to a PROJECT and indexed, while these ride on a single turn.
 * The handoff doc lists "multiple attachments in one turn - pdf + text + image on a single message"
 * as uncovered by any journey, and this is that journey.
 *
 * It exists because driving it by hand on 2026-08-16 found a real defect immediately: the PDF
 * reached desktop as a chip reading "mobile.pdf text" whose preview opened empty, while Android
 * rendered the same message correctly - two renderers each deciding what an attachment is, and
 * drifting. A journey that sends only images would never have found it.
 *
 *   node scripts/e2e/multi-attachment-sync.mjs --primary ios --ios http://192.168.1.14:8100
 *   node scripts/e2e/multi-attachment-sync.mjs --primary ios --mesh macos,windows --document off
 *
 * WHY THE THREE SOURCES ARE NOT INTERCHANGEABLE, on iOS:
 *
 *   camera    fully addressable - `PhotoCapture` then `Use Photo` are real elements.
 *   library   NOT addressable. The system picker exposes only PXG* layout groups and ONE
 *             concatenated label listing every photo; there are no per-photo cells and no rects.
 *             So the first item is taken by a geometric tap on the grid's first position. Android's
 *             approach - XPath on content-desc="Photo taken on ..." - has no equivalent here.
 *   document  addressable, but the picker names a file "mobile, pdf": the extension is a separate
 *             accessibility component, so searching for "mobile.pdf" never matches.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EVIDENCE_DIR, flag, specFor } from './mesh-config.mjs';
import { connectSurface } from './sync-surface.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safe = value => value.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '');

const primaryKind = flag('primary', 'ios').toLowerCase();
if (!['android', 'ios'].includes(primaryKind)) {
  throw new Error('--primary must be android or ios; a desktop cannot attach from a camera');
}
const DEFAULT_OBSERVERS = { ios: 'android,macos,windows', android: 'ios,macos,windows' };
const observerKinds = flag('mesh', DEFAULT_OBSERVERS[primaryKind])
  .split(',')
  .map(kind => kind.trim().toLowerCase())
  .filter(Boolean);
if (observerKinds.includes(primaryKind)) {
  throw new Error(`${primaryKind} is the producer; do not repeat it in --mesh`);
}

const wantCamera = flag('camera', 'on') === 'on';
const wantLibrary = flag('library', 'on') === 'on';
const wantDocument = flag('document', 'on') === 'on';
const documentName = flag('document-name', 'mobile.pdf');
const timeoutMs = Number(flag('timeout-minutes', '10')) * 60_000;

const token = `attachproof${Date.now()}`;
const prompt = `${token} write one line each about each of the attachments`;
const runId = `${primaryKind}-multi-attachment-${token}`;
const evidenceDir = join(EVIDENCE_DIR, 'multi-attachment-sync', runId);
const results = [];
const connected = [];

await mkdir(evidenceDir, { recursive: true });

const capture = async (surface, phase) => {
  const path = join(evidenceDir, `${safe(surface.platform)}--${safe(phase)}.png`);
  await surface.screenshot(path);
  return path;
};

const labelsOf = async surface =>
  (await surface.ui.labels()).map(label => label.trim());
const has = async (surface, name) => (await labelsOf(surface)).includes(name);

/** Count what is actually in the composer, so each step proves itself before the next one runs. */
const attachmentCount = async surface =>
  (await labelsOf(surface)).filter(label => label.startsWith('attachment-preview-')).length;

const waitForCount = async (surface, wanted, what) => {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if ((await attachmentCount(surface)) >= wanted) return;
    if (Date.now() > deadline) {
      throw new Error(`${surface.platform}: ${what} did not reach ${wanted} attachments`);
    }
    await sleep(1000);
  }
};

/**
 * Make sure the chat is running the text model this journey means to exercise.
 *
 * A journey that inherits whatever model was last selected is not the same test twice: a 0.8B and a
 * 2B answer differently, and a remote gateway model does not exercise on-device vision at all. The
 * sheet's first row is the text model, so its label is the current one; the switch list names each
 * row `text-model-row-<repo>/<file>.gguf`.
 */
const ensureTextModel = async (surface, wanted) => {
  await surface.ui.tapWhenReady('model-selector', { timeoutMs: 20_000 });
  await surface.ui.waitForLabel('models-row-text', {
    label: `${surface.platform} models sheet`,
    timeoutMs: 20_000,
  });
  const current = (await labelsOf(surface)).find(label => label.includes(', TEXT,'));
  if (current?.includes(wanted)) {
    await surface.ui.tapLabel('Done');
    await surface.ui.waitForLabel('chat-input', {
      label: `${surface.platform} chat after closing models`,
      timeoutMs: 20_000,
    });
    return 'already selected';
  }

  await surface.ui.tapLabel('models-row-text');
  await surface.ui.waitForLabel('SWITCH MODEL', {
    label: `${surface.platform} text model list`,
    timeoutMs: 20_000,
  });
  const row = (await labelsOf(surface)).find(
    label => label.startsWith('text-model-row-') && label.includes(wanted),
  );
  if (!row) throw new Error(`${surface.platform} has no downloaded ${wanted} to select`);
  await surface.ui.scrollToLabel(row, { maxSwipes: 8 }).catch(() => undefined);
  await surface.ui.tapLabel(row);

  // Selecting starts a load. Done is what closes the sheet, and the chat is only usable once the
  // composer is back - waiting on the sheet alone would race the model into the first message.
  await surface.ui.waitFor(
    async () => (await labelsOf(surface)).includes('Done'),
    { label: `${surface.platform} model sheet after selecting`, timeoutMs: 180_000, intervalMs: 1000 },
  );
  await surface.ui.tapLabel('Done');
  await surface.ui.waitForLabel('chat-input', {
    label: `${surface.platform} chat after model load`,
    timeoutMs: 180_000,
  });
  return 'selected';
};

/** Open the composer's attach sheet and choose one of its three options. */
const chooseAttachSource = async (surface, option) => {
  await surface.ui.tapWhenReady('attach-button', { timeoutMs: 20_000 });
  await surface.ui.waitForLabel(option, {
    label: `${surface.platform} attach option ${option}`,
    timeoutMs: 20_000,
  });
  await surface.ui.tapLabel(option);
  await sleep(1200);
};

const attachFromCamera = async surface => {
  await chooseAttachSource(surface, 'Photo');
  await surface.ui.waitForLabel('Camera', {
    label: `${surface.platform} photo source sheet`,
    timeoutMs: 20_000,
  });
  await surface.ui.tapLabel('Camera');
  // The shutter is a real control on iOS, unlike the library grid.
  await surface.ui.waitForLabel('PhotoCapture', {
    label: `${surface.platform} camera shutter`,
    timeoutMs: 40_000,
  });
  await surface.ui.tapLabel('PhotoCapture');
  await surface.ui.waitForLabel('Use Photo', {
    label: `${surface.platform} camera review`,
    timeoutMs: 30_000,
  });
  await surface.ui.tapLabel('Use Photo');
};

/**
 * The library grid is opaque to accessibility, so the first cell is taken by position.
 *
 * Measured from the device rather than assumed: on a 440x956 logical screen the first thumbnail's
 * centre sits at roughly 16% across and 23% down, inside the sheet that opens below the status bar.
 * Expressed as fractions so it survives a different screen size.
 */
const attachFromLibrary = async surface => {
  await chooseAttachSource(surface, 'Photo');
  await surface.ui.waitForLabel('Photo Library', {
    label: `${surface.platform} photo source sheet`,
    timeoutMs: 20_000,
  });
  await surface.ui.tapLabel('Photo Library');
  await sleep(3000);
  const { width, height } = await surface.ui.windowSize();
  await surface.ui.tap(Math.round(width * 0.16), Math.round(height * 0.235));
};

const attachDocument = async surface => {
  await chooseAttachSource(surface, 'Document');
  // "mobile.pdf" is never a label here: the picker splits the extension into its own component.
  const pickerLabel = documentName.replace(/\.([^.]+)$/, ', $1');
  await surface.ui.waitForLabel(pickerLabel, {
    label: `${surface.platform} document picker showing ${documentName} (as "${pickerLabel}")`,
    timeoutMs: 40_000,
  });
  await surface.ui.tapLabel(pickerLabel);
};

const run = async () => {
  console.log(`\n${primaryKind} -> mesh multi-attachment journey`);
  console.log(`marker: ${token}`);
  console.log(`evidence: ${evidenceDir}\n`);

  const kinds = [primaryKind, ...observerKinds];
  for (const kind of kinds) connected.push(await connectSurface(specFor(kind)));
  const [producer, ...observers] = connected;

  // A fresh chat, so the transcript stays short enough to dump quickly.
  await producer.ui.tapWhenReady('home-tab', { timeoutMs: 20_000 }).catch(() => undefined);
  await producer.ui.tapWhenReady('new-chat-button', { timeoutMs: 30_000 });
  await producer.ui.waitForLabel('chat-screen', {
    label: `${primaryKind} new chat`,
    timeoutMs: 30_000,
  });

  const textModel = flag('text-model', 'Qwen3.5-2B');
  const modelOutcome = await ensureTextModel(producer, textModel);
  console.log(`MODEL  ${primaryKind.padEnd(8)} ${textModel} ${modelOutcome}`);

  // A composer can carry a draft from a previous run; three attachments must mean THESE three.
  for (const label of await labelsOf(producer)) {
    if (label.startsWith('remove-attachment-')) {
      await producer.ui.tapLabel(label);
      await sleep(600);
    }
  }
  if ((await attachmentCount(producer)) !== 0) {
    throw new Error(`${primaryKind} composer still holds a draft attachment`);
  }

  let expected = 0;
  if (wantCamera) {
    await attachFromCamera(producer);
    expected += 1;
    await waitForCount(producer, expected, 'camera photo');
    console.log(`ATTACH ${primaryKind.padEnd(8)} camera photo`);
  }
  if (wantLibrary) {
    await attachFromLibrary(producer);
    expected += 1;
    await waitForCount(producer, expected, 'library photo');
    console.log(`ATTACH ${primaryKind.padEnd(8)} library photo`);
  }
  if (wantDocument) {
    await attachDocument(producer);
    expected += 1;
    await waitForCount(producer, expected, documentName);
    console.log(`ATTACH ${primaryKind.padEnd(8)} ${documentName}`);
  }
  const composed = await capture(producer, 'composed');

  await producer.ui.tapWhenReady('chat-input', { timeoutMs: 20_000 });
  await producer.ui.type(prompt);
  await sleep(1000);
  await producer.ui.tapWhenReady('send-button', { timeoutMs: 20_000 });
  await producer.ui.waitForLabel(token, {
    label: `${primaryKind} sent marker`,
    timeoutMs: 60_000,
  });
  console.log(`SEND   ${primaryKind.padEnd(8)} ${expected} attachments\n`);
  results.push({ platform: primaryKind, ok: true, attachments: expected, evidence: composed });

  // Every peer must show the same turn WITH its attachments. The document is named explicitly,
  // because a chip that says the file name while rendering nothing is exactly the defect this
  // journey exists to catch.
  for (const observer of observers) {
    const started = Date.now();
    try {
      await observer.ui
        .waitFor(async () => (await observer.text()).includes(token), {
          label: `${observer.platform} synced message`,
          timeoutMs,
          intervalMs: 1500,
        });
      const text = await observer.text();
      const missing = [];
      if (wantDocument && !text.includes(documentName)) missing.push(documentName);
      const shot = await capture(observer, missing.length ? 'FAILED' : 'synced');
      if (missing.length) {
        throw new Error(`arrived without: ${missing.join(', ')}`);
      }
      console.log(`OK     ${observer.platform.padEnd(8)} message and attachments present`);
      results.push({
        platform: observer.platform,
        ok: true,
        ms: Date.now() - started,
        evidence: shot,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`FAIL   ${observer.platform.padEnd(8)} ${reason}`);
      results.push({ platform: observer.platform, ok: false, reason, ms: Date.now() - started });
    }
  }
};

try {
  await run();
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.log(`FAIL   producer ${reason}`);
  results.push({ platform: primaryKind, ok: false, reason });
} finally {
  await writeFile(
    join(evidenceDir, 'result.json'),
    `${JSON.stringify({ runId, token, prompt, primaryKind, observerKinds, results }, null, 2)}\n`,
  );
  for (const surface of connected) {
    await Promise.resolve(surface.close()).catch(() => undefined);
  }
}

const failures = results.filter(result => !result.ok);
console.log(`\n${results.length - failures.length}/${results.length} surfaces passed`);
console.log(`result: ${join(evidenceDir, 'result.json')}`);
process.exitCode = failures.length > 0 ? 1 : 0;
