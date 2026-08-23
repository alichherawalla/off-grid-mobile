// A real transfer between two real platforms, both ways.
//
// This is the test that the unit tests cannot be: the payload is sealed by one platform's shipping
// code and opened by another's, across a real socket, and the file that lands is compared byte for
// byte. A format that differs by one byte - a frame size, a nonce, what the tag covers - fails here.
//
//   node run.mjs --phone <harness> --label ios [--size 10485760]
//
// The phone harness is the platform under test, compiled from the app's own sources:
//   <harness> serve  <requestId> <destination> <fileSize> <keyBase64> <nonceBase64> <token> <frameBytes>
//   <harness> stream <requestId> <source> <url> <token> <keyBase64> <nonceBase64> <frameBytes>
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const build = join(here, '.build');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at < 0 ? fallback : argv[at + 1];
};

const phone = flag('phone');
const label = flag('label', 'phone');
const size = Number(flag('size', String(10 * 1024 * 1024)));
if (!phone) {
  console.error('--phone <harness> is required');
  process.exit(2);
}

const sync = await import(pathToFileURL(join(build, 'offgrid-sync.cjs')).href);
const { createBlobMaterial, BLOB_FRAME_BYTES } = sync;
const env = {
  ...process.env,
  BLOB_HOST_BUNDLE: join(build, 'desktop-blob-host.cjs'),
  BLOB_SYNC_BUNDLE: join(build, 'offgrid-sync.cjs')
};

const dir = mkdtempSync(join(tmpdir(), 'blob-e2e-'));
const secret = 'a-shared-pairing-secret';
const sha256 = (path) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });

/** A payload with real entropy, and a size that ends mid-frame so the short last frame is exercised. */
const source = join(dir, 'payload.bin');
writeFileSync(source, randomBytes(size));
const sourceHash = await sha256(source);

const run = (command, args) => {
  const child = spawn(command, args, { env });
  const lines = [];
  let buffer = '';
  const waiters = [];
  child.stdout.on('data', (data) => {
    buffer += data.toString();
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      const parsed = tryParse(line);
      const waiting = waiters.shift();
      // A line goes to whoever is waiting, or into the queue - never both, or the next read gets a
      // line that has already been consumed.
      if (waiting) waiting(parsed);
      else lines.push(parsed);
    }
  });
  child.stderr.on('data', (data) => process.stderr.write(`[${command}] ${data}`));
  // The exit is recorded when it happens, not asked for later: a child that finishes before anyone
  // waits on it would otherwise be waited on forever.
  let exited;
  const exitWaiters = [];
  child.on('exit', (code) => {
    exited = code;
    for (const waiting of exitWaiters.splice(0)) waiting(code);
  });
  return {
    child,
    lines,
    nextLine: () =>
      new Promise((resolve) => {
        const pending = lines.shift();
        if (pending !== undefined) return resolve(pending);
        waiters.push(resolve);
      }),
    exit: () =>
      new Promise((resolve) => {
        if (exited !== undefined) return resolve(exited);
        exitWaiters.push(resolve);
      })
  };
};

const tryParse = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return { raw: line };
  }
};

const trace = (message) => process.stderr.write(`[e2e] ${message}\n`);

const results = [];
const record = (name, passed, detail) => {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
};
const transferRate = (bytes, startedAt) => {
  const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
  return `${(bytes / 1024 / 1024 / seconds).toFixed(1)} MiB/s in ${seconds.toFixed(2)} s`;
};

// ---------------------------------------------------------------- phone -> Mac
{
  const requestId = 'e2e-phone-to-mac';
  const destination = join(dir, 'landed-on-mac.bin');
  const mac = run('node', [
    join(here, 'desktop-side.mjs'),
    'serve',
    '--request-id',
    requestId,
    '--secret',
    secret,
    '--dest',
    destination,
    '--size',
    String(size)
  ]);
  trace('waiting for the mac to offer an endpoint');
  const endpoint = await mac.nextLine();
  trace(`endpoint: ${JSON.stringify(endpoint)}`);
  if (!endpoint?.url) {
    record(`${label} -> mac`, false, `no endpoint: ${JSON.stringify(endpoint)}`);
  } else {
    const startedAt = process.hrtime.bigint();
    const sender = run(phone, [
      'stream',
      requestId,
      source,
      endpoint.url,
      endpoint.token,
      endpoint.keyBase64,
      endpoint.nonce,
      String(BLOB_FRAME_BYTES)
    ]);
    const sent = await sender.nextLine();
    trace(`sender said ${JSON.stringify(sent)}`);
    const landed = await mac.nextLine();
    trace(`receiver said ${JSON.stringify(landed)}`);
    await Promise.all([sender.exit(), mac.exit()]);
    const same = landed?.received === true && landed.sha256 === sourceHash;
    record(
      `${label} -> mac`,
      same,
      same
        ? `${size} bytes, sha256 matches, ${transferRate(size, startedAt)}`
        : `sender=${JSON.stringify(sent)} receiver=${JSON.stringify(landed)}`
    );
  }
}

// ---------------------------------------------------------------- Mac -> phone
{
  const requestId = 'e2e-mac-to-phone';
  const destination = join(dir, `landed-on-${label}.bin`);
  // The receiving device mints the material, which here is the phone: its JavaScript would do this.
  const material = createBlobMaterial(secret, requestId);
  const receiver = run(phone, [
    'serve',
    requestId,
    destination,
    String(size),
    material.keyBase64,
    material.nonceBase64,
    material.token,
    String(BLOB_FRAME_BYTES)
  ]);
  const offered = await receiver.nextLine();
  if (!offered?.url) {
    record(`mac -> ${label}`, false, `no endpoint: ${JSON.stringify(offered)}`);
  } else {
    const startedAt = process.hrtime.bigint();
    const mac = run('node', [
      join(here, 'desktop-side.mjs'),
      'stream',
      '--request-id',
      requestId,
      '--secret',
      secret,
      '--url',
      offered.url,
      '--token',
      material.token,
      '--nonce',
      material.nonceBase64,
      '--source',
      source
    ]);
    const sent = await mac.nextLine();
    const landed = await receiver.nextLine();
    await Promise.all([mac.exit(), receiver.exit()]);
    const same =
      landed?.received === true && (await sha256(destination).catch(() => '')) === sourceHash;
    record(
      `mac -> ${label}`,
      same,
      same
        ? `${size} bytes, sha256 matches, ${transferRate(size, startedAt)}`
        : `sender=${JSON.stringify(sent)} receiver=${JSON.stringify(landed)}`
    );
  }
}

// ------------------------------------------------- a payload nobody may open
{
  const requestId = 'e2e-wrong-pairing';
  const destination = join(dir, 'must-not-land.bin');
  const material = createBlobMaterial('a-different-pairing', requestId);
  const receiver = run(phone, [
    'serve',
    requestId,
    destination,
    String(size),
    material.keyBase64,
    material.nonceBase64,
    material.token,
    String(BLOB_FRAME_BYTES)
  ]);
  const offered = await receiver.nextLine();
  if (!offered?.url) {
    record(`mac -> ${label}, wrong pairing`, false, 'no endpoint');
  } else {
    // The Mac seals with the real pairing; the phone expects a different one. Nothing may land.
    const mac = run('node', [
      join(here, 'desktop-side.mjs'),
      'stream',
      '--request-id',
      requestId,
      '--secret',
      secret,
      '--url',
      offered.url,
      '--token',
      material.token,
      '--nonce',
      material.nonceBase64,
      '--source',
      source
    ]);
    await mac.nextLine();
    const landed = await receiver.nextLine();
    await Promise.all([mac.exit(), receiver.exit()]);
    const refused = landed?.received !== true;
    record(
      `mac -> ${label}, wrong pairing is refused`,
      refused,
      refused ? 'nothing landed' : 'a payload sealed with another pairing was accepted'
    );
  }
}

rmSync(dir, { recursive: true, force: true });
const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
