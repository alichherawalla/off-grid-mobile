/**
 * The failing case, reproduced deliberately.
 *
 * Restart the phone app so it takes a NEW ephemeral port, then watch whether the Mac follows it.
 * Before the fix the Mac kept the old port and every dial refused; the phone's own Reconnect was the
 * only thing that worked. The pass condition here is the Mac reporting the phone connected again
 * WITHOUT anyone touching the phone.
 */
import { AdbClient } from '../android/adb-client.mjs';
import { flag, specFor } from './mesh-config.mjs';
import { connectSurface } from './sync-surface.mjs';

const PACKAGE = flag('package', 'ai.offgridmobile.dev');
const ANDROID_NAME = flag('android-name', 'OnePlus Nord 5 (Debug)');
const adb = new AdbClient(flag('android', '505b53a0'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The port the phone's sync listener is actually bound to, read from the kernel. */
const phonePort = async () => {
  const raw = await adb.shell('cat /proc/net/tcp /proc/net/tcp6');
  const uid = (await adb.shell('dumpsys package ' + PACKAGE)).match(/uid=(\d+)/)?.[1];
  const ports = [];
  for (const line of raw.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols[3] !== '0A' || cols[7] !== uid) continue;
    const hex = cols[1].split(':')[1];
    const port = parseInt(hex, 16);
    // Loopback listeners are Metro/inspector plumbing, not the mesh.
    if (!cols[1].startsWith('0100007F')) ports.push(port);
  }
  return { uid, ports: [...new Set(ports)].sort((a, b) => a - b) };
};

const macos = await connectSurface({ ...specFor('macos'), passive: false });
await macos.openDevices();

console.log('BEFORE');
console.log('  phone listeners :', JSON.stringify(await phonePort()));
console.log('  mac sees phone  :', await macos.isConnectedTo(ANDROID_NAME));

console.log('\n>>> restarting the phone app (it will take a new ephemeral port)');
await adb.restart(PACKAGE);
await sleep(12_000);

const after = await phonePort();
console.log('\nAFTER restart');
console.log('  phone listeners :', JSON.stringify(after));

console.log('\n>>> watching the Mac. Nothing is pressed on either device.');
const startedAt = Date.now();
let connected = false;
for (let i = 0; i < 40; i += 1) {
  connected = await macos.isConnectedTo(ANDROID_NAME).catch(() => false);
  const secs = Math.round((Date.now() - startedAt) / 1000);
  if (connected) {
    console.log(`  PASS  the Mac reports "${ANDROID_NAME}" connected after ${secs}s, unattended`);
    break;
  }
  if (i % 4 === 0) console.log(`  ...${secs}s not yet`);
  await sleep(3000);
}

if (!connected) {
  console.log('\n  no unattended heal. Pressing Reconnect ON THE MAC - the button that used to do nothing.');
  await macos.startPairing(ANDROID_NAME);
  for (let i = 0; i < 20; i += 1) {
    await sleep(3000);
    connected = await macos.isConnectedTo(ANDROID_NAME).catch(() => false);
    if (connected) {
      console.log(`  PASS  the Mac's own Reconnect worked (${Math.round((Date.now() - startedAt) / 1000)}s total)`);
      break;
    }
  }
  if (!connected) console.log('  FAIL  the Mac still cannot reach the phone');
}

await Promise.resolve(macos.close()).catch(() => {});
