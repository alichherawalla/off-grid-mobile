#!/usr/bin/env node
/**
 * Drive a whole voice turn from the Mac and read the trace back.
 *
 * The phone's microphone is the only honest input to this feature, so the Mac SPEAKS through its own
 * speaker and the device hears it exactly as it hears a person. Nothing about the app is stubbed: real
 * mic, real VAD, real floor, real TTS. That is the point - every fault this evening was invisible to a
 * test that did not go through the air.
 *
 * Reads the app's own trace ([FLOOR] / [TURN] / [TTS] / [VAD]) and reports which stage of the turn was
 * reached, so a failure names a subsystem instead of a symptom.
 *
 * Usage:
 *   node scripts/e2e/voice-turn-from-mac.mjs            # iOS (default)
 *   node scripts/e2e/voice-turn-from-mac.mjs --android
 *   node scripts/e2e/voice-turn-from-mac.mjs --say "tell me why rabbits are good pets"
 */
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';

const args = process.argv.slice(2);
const android = args.includes('--android');
const sayIndex = args.indexOf('--say');
const PHRASE = sayIndex >= 0 ? args[sayIndex + 1] : 'what is the capital of France';
/** Long enough for the model to answer and speak; the trace tells us where it stopped if it did. */
const WATCH_MS = Number(args[args.indexOf('--wait') + 1]) || 90_000;

/** The stages of one turn, in the order they must happen. Each is a line the app already logs. */
const STAGES = [
  { key: 'mic opened', match: /\[VAD\].*(opening the mic|attaching level callback)/ },
  { key: 'buffers arriving', match: /\[VAD\] first buffer frames=/ },
  { key: 'speech detected', match: /\[VAD\].*(speech=true|person has the floor)/ },
  { key: 'turn ended on silence', match: /\[VAD\] ENDING turn|silence detected/ },
  { key: 'recording finalised', match: /\[TURN\] finalise/ },
  { key: 'floor taken by assistant', match: /\[FLOOR\].*-> assistant/ },
  { key: 'reply spoken', match: /\[TTS\] reply takes the floor/ },
  { key: 'floor released', match: /\[FLOOR\].*-> idle/ },
];

const logStream = () =>
  android
    ? spawn('adb', ['logcat', '-T', '1', 'ReactNativeJS:V', '*:S'])
    : spawn('xcrun', ['devicectl', 'device', 'process', 'monitor', '--console', '--device', 'iphone']);

const speak = () =>
  new Promise(resolve => {
    // The Mac's own voice, out loud, so the device hears it through the air like a person.
    execFile('say', ['-r', '170', PHRASE], () => resolve());
  });

const main = async () => {
  console.log(`[rig] platform=${android ? 'android' : 'ios'} phrase="${PHRASE}"`);
  const proc = logStream();
  const seen = new Map();
  const lines = [];

  const onData = chunk => {
    for (const line of String(chunk).split('\n')) {
      if (!/\[VAD\]|\[FLOOR\]|\[TURN\]|\[TTS\]/.test(line)) continue;
      lines.push(line.trim());
      for (const stage of STAGES) {
        if (!seen.has(stage.key) && stage.match.test(line)) {
          seen.set(stage.key, line.trim());
          console.log(`[rig] ✓ ${stage.key}`);
        }
      }
    }
  };
  proc.stdout?.on('data', onData);
  proc.stderr?.on('data', onData);

  // Let the log stream attach before making a sound, or the first buffers are missed.
  await new Promise(r => setTimeout(r, 3_000));
  console.log('[rig] speaking now - the device should hear this');
  await speak();

  await Promise.race([once(proc, 'exit'), new Promise(r => setTimeout(r, WATCH_MS))]);
  proc.kill('SIGKILL');

  console.log('\n=== turn stages ===');
  let firstMissing = null;
  for (const stage of STAGES) {
    const hit = seen.get(stage.key);
    console.log(`${hit ? 'ok  ' : 'MISS'} ${stage.key}${hit ? '' : '  <-- stopped here'}`);
    if (!hit && !firstMissing) firstMissing = stage.key;
  }
  console.log(`\n=== trace (${lines.length} lines) ===`);
  for (const line of lines.slice(-80)) console.log(line);

  if (firstMissing) {
    console.log(`\n[rig] FAILED at: ${firstMissing}`);
    process.exit(1);
  }
  console.log('\n[rig] full turn completed');
};

main().catch(error => {
  console.error('[rig] error', error);
  process.exit(1);
});
