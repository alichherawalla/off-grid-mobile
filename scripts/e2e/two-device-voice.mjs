#!/usr/bin/env node
/**
 * The two-device voice conversation, driven end to end.
 *
 * iOS is seeded by the Mac's own voice through the air, answers out loud, and Android - in hands-free -
 * has to hear iOS finish and take its own turn. Nothing is stubbed: real microphones, real speakers,
 * real VAD, real TTS. Every fault this evening was invisible to anything that did not go through air.
 *
 * Two hard lessons are baked in, because both wasted a whole run:
 *
 * 1. READ THE APP'S LOG FILE, not the platform log. `console.log` under Hermes goes to Metro, so
 *    `adb logcat` returns nothing for our lines and `devicectl process monitor` returned nothing at
 *    all. The app writes every line to Documents/offgrid-debug.log, and that file is the only source
 *    that works on both platforms.
 *
 * 2. NEVER tap blind coordinates. A guessed y=2100 was the Image Gallery card, so every run opened the
 *    gallery instead of recording. Android controls are resolved from a uiautomator dump by label, and
 *    iOS by accessibility id.
 *
 * Reports the STAGE each device reached, so a failure names a subsystem rather than a symptom, and
 * surfaces [TTS-PERF] so slowness is attributed to synthesis or to scheduling rather than guessed at.
 */
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const WDA = process.env.WDA_URL ?? 'http://192.168.1.54:8100';
const BUNDLE = 'ai.offgridmobile.dev';
const IOS_UDID = process.env.WDA_UDID ?? '4CF4A291-280A-598C-8AC5-851073C14B30';
const PHRASE =
  process.env.PHRASE ?? 'tell me in one short sentence why rabbits make good pets';

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return '';
  }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = phrase => new Promise(r => execFile('say', ['-r', '165', phrase], () => r()));

// ── iOS, over WDA ───────────────────────────────────────────────────────────────────────────────────
let sid = null;
const wda = async (method, path, body) => {
  const res = await fetch(`${WDA}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
};
const iosSession = async () => {
  if (sid) return sid;
  const out = await wda('POST', '/session', {
    capabilities: { alwaysMatch: { bundleId: BUNDLE, shouldWaitForQuiescence: false } },
  });
  sid = out?.value?.sessionId;
  if (!sid) throw new Error('no WDA session - is WDA running?');
  return sid;
};
const iosLabels = async () => {
  const id = await iosSession();
  const out = await wda('GET', `/session/${id}/source?format=json`);
  const names = [];
  const walk = n => {
    const l = n?.name || n?.label || '';
    if (l) names.push(l);
    for (const c of n?.children ?? []) walk(c);
  };
  walk(out?.value ?? {});
  return names;
};
const iosTap = async name => {
  const id = await iosSession();
  const found = await wda('POST', `/session/${id}/elements`, {
    using: 'accessibility id',
    value: name,
  });
  const first = found?.value?.[0];
  const el = first?.ELEMENT ?? first?.['element-6066-11e4-a52e-4f735466cecf'];
  if (!el) return false;
  await wda('POST', `/session/${id}/element/${el}/click`, {});
  return true;
};
/** A reloading app reports almost nothing; tapping then does nothing useful. */
const iosSettled = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await iosLabels()).length > 10) return true;
    await sleep(6000);
  }
  return false;
};

// ── Android, over adb, by LABEL ─────────────────────────────────────────────────────────────────────
const androidControls = () => {
  sh('adb', ['shell', 'uiautomator', 'dump', '/sdcard/rig.xml']);
  const xml = sh('adb', ['exec-out', 'cat', '/sdcard/rig.xml']);
  const found = [];
  const re = /(?:content-desc|text)="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
  for (const m of xml.matchAll(re)) {
    const [, label, x1, y1, x2, y2] = m;
    found.push({
      label,
      cx: (Number(x1) + Number(x2)) >> 1,
      cy: (Number(y1) + Number(y2)) >> 1,
      area: (Number(x2) - Number(x1)) * (Number(y2) - Number(y1)),
    });
  }
  const clickable = [];
  for (const m of xml.matchAll(/clickable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)) {
    const [, x1, y1, x2, y2] = m.map(Number);
    clickable.push({
      cx: (x1 + x2) >> 1,
      cy: (y1 + y2) >> 1,
      w: x2 - x1,
      h: y2 - y1,
    });
  }
  return { found, clickable };
};
const androidTapLabel = label => {
  const hit = androidControls().found.find(c => c.label.includes(label));
  if (!hit) return false;
  sh('adb', ['shell', 'input', 'tap', String(hit.cx), String(hit.cy)]);
  return true;
};
/** The mic is the large round button low on the screen - found by SHAPE, never a fixed pixel. */
const androidTapMic = () => {
  const round = androidControls()
    .clickable.filter(c => c.cy > 1800 && Math.abs(c.w - c.h) < 24 && c.w > 120)
    .sort((a, b) => b.w - a.w)[0];
  if (!round) return false;
  sh('adb', ['shell', 'input', 'tap', String(round.cx), String(round.cy)]);
  return `${round.cx},${round.cy} (${round.w}x${round.h})`;
};

// ── The app's own log, on both platforms ────────────────────────────────────────────────────────────
const androidLog = () =>
  sh('adb', ['exec-out', 'run-as', BUNDLE, 'cat', 'files/offgrid-debug.log']).split('\n');
const iosLog = () => {
  sh('xcrun', [
    'devicectl', 'device', 'copy', 'from',
    '--device', IOS_UDID,
    '--domain-type', 'appDataContainer',
    '--domain-identifier', BUNDLE,
    '--source', 'Documents/offgrid-debug.log',
    '--destination', '/tmp/rig-ios.log',
  ]);
  try {
    return readFileSync('/tmp/rig-ios.log', 'utf8').split('\n');
  } catch {
    return [];
  }
};

const STAGES = [
  ['lock taken by person', /\[LOCK\] person acquired/],
  ['mic opened', /\[VAD\].*(taking the floor|attaching level callback)/],
  ['buffers arriving', /\[VAD\] first buffer frames=/],
  ['speech detected', /\[VAD\].*speech detected/],
  ['turn ended on silence', /\[VAD\].*(ENDING turn|silence detected)/],
  ['recording finalised', /\[TURN\] finalise/],
  ['reply took the lock', /\[LOCK\] assistant acquired|\[TTS\] reply takes the floor/],
  ['reply spoken to the end', /\[TTS-PERF\] segment done/],
  ['lock released', /\[LOCK\] assistant released/],
];

const report = (label, lines) => {
  console.log(`\n=== ${label} ===`);
  let firstMissing = null;
  for (const [key, re] of STAGES) {
    const hit = lines.some(l => re.test(l));
    console.log(`${hit ? 'ok  ' : 'MISS'} ${key}`);
    if (!hit && !firstMissing) firstMissing = key;
  }
  const perf = lines.filter(l => l.includes('[TTS-PERF] segment done'));
  if (perf.length) {
    console.log(`--- ${label} speech timing ---`);
    for (const line of perf.slice(-4)) console.log('   ', line.slice(line.indexOf('[TTS-PERF]')));
  }
  const interesting = lines.filter(
    l => /\[LOCK\]|\[TURN\]|\[TTS\]|\[VAD\]/.test(l) && !/rms=/.test(l),
  );
  console.log(`--- ${label} trace (last 22 of ${interesting.length}) ---`);
  for (const line of interesting.slice(-22)) console.log('   ', line.slice(0, 150));
  return firstMissing;
};

const main = async () => {
  console.log('[rig] waiting for iOS to finish loading its bundle');
  if (!(await iosSettled())) throw new Error('iOS never settled - still reloading?');

  const androidMark = androidLog().length;
  const iosMark = iosLog().length;
  console.log(`[rig] log marks android=${androidMark} ios=${iosMark}`);

  console.log('[rig] iOS: new chat');
  await iosTap('new-chat-button');
  await sleep(6000);

  console.log('[rig] iOS: tap to record');
  if (!(await iosTap('audio-hero-mic'))) {
    console.log('[rig]   NO MIC CONTROL. visible:', (await iosLabels()).slice(0, 25));
    throw new Error('iOS mic control not found - wrong screen?');
  }
  await sleep(1500);

  console.log('[rig] Mac speaks now');
  await say(PHRASE);
  console.log('[rig] stopped speaking - 5s silence gap applies');

  console.log('[rig] Android: new chat');
  console.log(`[rig]   New Chat tapped: ${androidTapLabel('New Chat')}`);
  await sleep(6000);
  console.log(`[rig]   Android mic tapped at ${androidTapMic()}`);

  console.log('[rig] waiting 160s for both turns to complete');
  await sleep(160_000);

  const iosNew = iosLog().slice(iosMark);
  const androidNew = androidLog().slice(androidMark);
  const iosMissing = report('iOS', iosNew);
  const androidMissing = report('Android', androidNew);

  console.log('\n=== verdict ===');
  console.log(`iOS stopped at:     ${iosMissing ?? 'nothing - full turn'}`);
  console.log(`Android stopped at: ${androidMissing ?? 'nothing - full turn'}`);
  console.log(
    `Android heard iOS speak: ${androidNew.some(l => /\[VAD\].*speech detected/.test(l))}`,
  );
};

main().catch(error => {
  console.error('[rig] FAILED:', error.message);
  process.exit(1);
});
