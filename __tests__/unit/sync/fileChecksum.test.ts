import { CHUNK_SIZE } from '@offgrid/sync';
import { NativeModules, Platform } from 'react-native';
import { modelTransferFsBoundary } from '../../utils/modelTransferFsBoundary';
import { fileTransferChecksum } from '../../../src/services/sync/fileChecksum';

jest.mock('react-native-fs', () => {
  const {
    modelTransferFsBoundary: boundary,
  } = require('../../utils/modelTransferFsBoundary');
  return { __esModule: true, default: boundary.module };
});

const fs = modelTransferFsBoundary.module;
const originalPlatformOS = Platform.OS;

/**
 * The checksum the receiving device checks a transfer against.
 *
 * There are two ways to compute it - one native call, or reading the file in chunks over the bridge - and
 * the only thing that makes the fallback safe is that both produce the SAME value. If they can disagree,
 * a phone whose native hash is missing sends a file that every other device rejects as corrupt, and the
 * user sees a transfer that always fails with nothing wrong with the file.
 *
 * So that equality is what is asserted, over a real SHA-512 of real bytes: the filesystem fake hashes with
 * node's crypto and the chunked path runs the shared `IncrementalChecksum`. Nothing here re-implements the
 * format - it is defined once in the shared package, and the test only checks the two roads meet.
 */
describe('the checksum a transfer is verified against', () => {
  const write = async (path: string, contents: Buffer | string) => {
    await fs.writeFile(
      path,
      Buffer.from(contents as string).toString('base64'),
      'base64',
    );
    return (await fs.stat(path)).size;
  };

  /** Forces the read-in-chunks road by making the platform hash unavailable, as an older OS does. */
  const withoutNativeHash = async <T>(run: () => Promise<T>): Promise<T> => {
    fs.hash.mockImplementationOnce(async () => {
      throw new Error('hashing is not supported on this device');
    });
    return run();
  };

  beforeEach(() => {
    modelTransferFsBoundary.reset();
    NativeModules.StreamingHashModule = undefined;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatformOS,
    });
    jest.restoreAllMocks();
  });

  it.each([
    ['a small file', 64],
    ['a file just under one chunk', CHUNK_SIZE - 1],
    ['a file of exactly one chunk', CHUNK_SIZE],
    ['a file one byte over a chunk', CHUNK_SIZE + 1],
    ['a file spanning several chunks', CHUNK_SIZE * 2 + 7],
  ])('reaches the same value both ways for %s', async (_label, size) => {
    // Bytes that are not text and not uniform: a checksum that ignored offsets or dropped a chunk would
    // still match on repeated bytes.
    const contents = Buffer.alloc(size);
    for (let index = 0; index < size; index += 1) {
      contents[index] = (index * 31 + 7) % 256;
    }
    const bytes = await write('/docs/model.gguf', contents);

    const native = await fileTransferChecksum('/docs/model.gguf', bytes);
    const chunked = await withoutNativeHash(() =>
      fileTransferChecksum('/docs/model.gguf', bytes),
    );

    // The whole safety of the fallback: a device that has to read in chunks produces a file every other
    // device accepts.
    expect(chunked).toBe(native);
    // The wire format the shared package defines: the first 16 bytes of the digest, base64. Asserted so a
    // change of format here has to be a deliberate one, since the far side parses exactly this.
    expect(native).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it('agrees on an empty file', async () => {
    const bytes = await write('/docs/empty.bin', '');

    const native = await fileTransferChecksum('/docs/empty.bin', bytes);
    const chunked = await withoutNativeHash(() =>
      fileTransferChecksum('/docs/empty.bin', bytes),
    );

    // Zero bytes still has a digest, and the chunked loop must not read at all rather than reading once
    // with a negative length.
    expect(chunked).toBe(native);
  });

  it('tells apart two files that differ by one byte', async () => {
    const first = Buffer.alloc(CHUNK_SIZE + 10, 5);
    const second = Buffer.from(first);
    second[CHUNK_SIZE + 4] = 6;
    const firstSize = await write('/docs/a.bin', first);
    const secondSize = await write('/docs/b.bin', second);

    // In the SECOND chunk, so a fallback that hashed only the first chunk would call these identical and
    // let a corrupted transfer through as verified.
    expect(
      await withoutNativeHash(() =>
        fileTransferChecksum('/docs/a.bin', firstSize),
      ),
    ).not.toBe(
      await withoutNativeHash(() =>
        fileTransferChecksum('/docs/b.bin', secondSize),
      ),
    );
  });

  it('reads the file only once when the platform can hash it', async () => {
    const bytes = await write('/docs/model.gguf', Buffer.alloc(CHUNK_SIZE * 4));
    fs.read.mockClear();

    await fileTransferChecksum('/docs/model.gguf', bytes);

    // The reason the native call exists: a multi-gigabyte model read over the bridge takes minutes, and it
    // happens before the transfer is on screen, so the app looks hung.
    expect(fs.read).not.toHaveBeenCalled();
  });

  it('uses the constant-memory iOS hash boundary for a model file', async () => {
    const bytes = await write('/docs/model.gguf', Buffer.alloc(CHUNK_SIZE * 4));
    const nativeHex = await fs.hash('/docs/model.gguf', 'sha512');
    const sha512 = jest.fn(async () => nativeHex);
    NativeModules.StreamingHashModule = { sha512 };
    fs.hash.mockClear();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });

    await fileTransferChecksum('/docs/model.gguf', bytes);

    expect(sha512).toHaveBeenCalledWith('/docs/model.gguf');
    expect(fs.hash).not.toHaveBeenCalled();
    expect(fs.read).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[Checksum] streaming 1MB through iOS'),
    );
  });

  it('says in the log why it is about to read a large file the slow way', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const bytes = await write('/docs/model.gguf', Buffer.alloc(CHUNK_SIZE * 8));

    await withoutNativeHash(() =>
      fileTransferChecksum('/docs/model.gguf', bytes),
    );

    // The one clue that a slow transfer is this fallback and not the network.
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('native hash unavailable');
    expect(logged).toContain('2MB');
    expect(logged).toContain('hashing is not supported on this device');
  });

  it('still falls back when the platform fails with something that is not an error', async () => {
    const bytes = await write('/docs/model.gguf', 'the bytes');
    fs.hash.mockImplementationOnce(() => Promise.reject('E_UNAVAILABLE'));

    const chunked = await fileTransferChecksum('/docs/model.gguf', bytes);

    expect(chunked).toBe(await fileTransferChecksum('/docs/model.gguf', bytes));
  });
});
