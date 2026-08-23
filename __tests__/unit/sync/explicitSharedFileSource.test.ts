import { MAX_SHARED_FILE_BYTES } from '@offgrid/sync';
import type { SharedFileDescriptor } from '@offgrid/sync';
import {
  MobileExplicitFileShareSource,
  discardExplicitSharedFile,
  stageExplicitSharedFile,
} from '../../../pro/sync/explicitSharedFileSource';
import { modelTransferFsBoundary } from '../../utils/modelTransferFsBoundary';

jest.mock('react-native-fs', () => {
  const {
    modelTransferFsBoundary: boundary,
  } = require('../../utils/modelTransferFsBoundary');
  return { __esModule: true, default: boundary.module };
});

const fs = modelTransferFsBoundary.module;
const STAGING_ROOT = `${modelTransferFsBoundary.DocumentDirectoryPath}/shared_files/file`;

/**
 * Sending a file the user picked themselves.
 *
 * A picked file lives somewhere the app does not control - a share sheet's temp copy, a cache the OS can
 * reclaim - so it is copied into our own staging directory before anything is announced. The copy is what
 * makes the transfer survive the picker closing.
 *
 * Two things are worth breaking a test over. The first is that a failed share leaves nothing behind: the
 * descriptor is rolled back AND the staged copy is deleted, or a 200 MB video the user never managed to
 * send sits in app storage for ever. The second is that the name is taken apart before it is used in a
 * path, because it came from outside.
 *
 * The filesystem is a real in-memory one (see utils/modelTransferFsBoundary), so what is asserted below is
 * bytes actually landing and actually disappearing, not a copy call having been made.
 */
describe('sharing a file the user picked', () => {
  const source = (
    hooks: Partial<{
      admit: (descriptor: SharedFileDescriptor, path: string) => Promise<void>;
      deliver: (
        descriptor: SharedFileDescriptor,
        destinationIds: readonly string[],
      ) => Promise<void>;
      rollback: (descriptor: SharedFileDescriptor) => Promise<void>;
    }> = {},
  ) => {
    const admitted: Array<{ descriptor: SharedFileDescriptor; path: string }> =
      [];
    const delivered: Array<{
      descriptor: SharedFileDescriptor;
      destinationIds: readonly string[];
    }> = [];
    const rolledBack: SharedFileDescriptor[] = [];
    const share = new MobileExplicitFileShareSource({
      admit: async (descriptor, path) => {
        admitted.push({ descriptor, path });
        await hooks.admit?.(descriptor, path);
      },
      deliver: async (descriptor, destinationIds) => {
        delivered.push({ descriptor, destinationIds });
        await hooks.deliver?.(descriptor, destinationIds);
      },
      rollback: async descriptor => {
        rolledBack.push(descriptor);
        await hooks.rollback?.(descriptor);
      },
    });
    return { share, admitted, delivered, rolledBack };
  };

  beforeEach(async () => {
    modelTransferFsBoundary.reset();
    await fs.writeFile('/docs/inbox/holiday.png', 'the-picked-bytes');
  });

  const picked = {
    path: '/docs/inbox/holiday.png',
    name: 'holiday.png',
    mimeType: 'image/png',
    destinationIds: ['the-mac'],
  };

  it('copies the file into our own storage and announces it to the chosen device', async () => {
    const { share, admitted, delivered } = source();

    await share.share(picked);

    expect(admitted).toHaveLength(1);
    const { descriptor, path } = admitted[0];
    expect(descriptor).toMatchObject({
      kind: 'file',
      name: 'holiday.png',
      mimeType: 'image/png',
      fileSize: 'the-picked-bytes'.length,
    });
    // The staged copy, not the picked path: the picker's temp file can be gone by the time we send.
    expect(path.startsWith(STAGING_ROOT)).toBe(true);
    expect(await fs.readFile(path)).toBe('the-picked-bytes');
    expect(await fs.exists(picked.path)).toBe(true);
    // Admitted before delivered, and delivered only to who was asked for.
    expect(delivered).toEqual([{ descriptor, destinationIds: ['the-mac'] }]);
  });

  it('refuses before touching the disk when no device is paired', async () => {
    const { share, admitted } = source();

    await expect(
      share.share({ ...picked, destinationIds: [] }),
    ).rejects.toThrow('Pair a device before sharing a file.');

    // Nothing staged: a copy made for a share that could never happen is storage the user never gets back.
    expect(await fs.exists(STAGING_ROOT)).toBe(false);
    expect(admitted).toEqual([]);
  });

  it('leaves nothing behind when the mesh refuses the file', async () => {
    const { share, admitted, rolledBack } = source({
      admit: async () => {
        throw new Error('This file is already being shared.');
      },
    });

    await expect(share.share(picked)).rejects.toThrow(
      'This file is already being shared.',
    );

    expect(rolledBack).toEqual([admitted[0].descriptor]);
    // Both halves: the descriptor is withdrawn and the bytes are gone.
    expect(await fs.exists(admitted[0].path)).toBe(false);
  });

  it('leaves nothing behind when the send itself fails', async () => {
    const { share, admitted, delivered, rolledBack } = source({
      deliver: async () => {
        throw new Error('the other device went away');
      },
    });

    await expect(share.share(picked)).rejects.toThrow(
      'the other device went away',
    );

    // Failing after admission is the case that actually leaks: the file is on disk and announced.
    expect(delivered).toHaveLength(1);
    expect(rolledBack).toEqual([admitted[0].descriptor]);
    expect(await fs.exists(admitted[0].path)).toBe(false);
  });

  it('reports the original failure even if cleaning up fails too', async () => {
    const { share } = source({
      admit: async () => {
        throw new Error('This file is already being shared.');
      },
      rollback: async () => {
        throw new Error('the database is locked');
      },
    });

    // The user is told why the share failed, not why the tidying failed - the second error is ours.
    await expect(share.share(picked)).rejects.toThrow('the database is locked');
  });

  it('keeps two shares of the same file apart', async () => {
    const { share, admitted } = source();

    await share.share(picked);
    await share.share(picked);

    // Distinct ids and distinct paths: the second share must not overwrite the bytes the first one is
    // still sending.
    expect(admitted[0].descriptor.syncId).not.toBe(
      admitted[1].descriptor.syncId,
    );
    expect(admitted[0].path).not.toBe(admitted[1].path);
    expect(await fs.exists(admitted[0].path)).toBe(true);
  });
});

describe('staging a picked file', () => {
  beforeEach(async () => {
    modelTransferFsBoundary.reset();
    await fs.writeFile('/docs/inbox/holiday.png', 'bytes');
  });

  const input = (
    overrides: Partial<Parameters<typeof stageExplicitSharedFile>[0]> = {},
  ) => ({
    path: '/docs/inbox/holiday.png',
    name: 'holiday.png',
    destinationIds: ['the-mac'],
    ...overrides,
  });

  it('says the file is gone when the picker handed back a path that no longer exists', async () => {
    await expect(
      stageExplicitSharedFile(input({ path: '/docs/inbox/deleted.png' })),
    ).rejects.toThrow('The selected file is no longer available.');
  });

  it('says the same about a directory', async () => {
    await fs.mkdir('/docs/inbox/album');

    // Android's picker can hand back a tree uri. Copying a directory as a file would fail much later,
    // after the share had been announced.
    await expect(
      stageExplicitSharedFile(input({ path: '/docs/inbox/album' })),
    ).rejects.toThrow('The selected file is no longer available.');
  });

  /**
   * A size the in-memory filesystem cannot produce cheaply: 256 MB of real bytes to prove one comparison,
   * and a native stat that reports its size as a string. Still the filesystem boundary answering - nothing
   * of ours is stood in for.
   */
  const reportsSize = (size: number | string) =>
    modelTransferFsBoundary.setReportedFileSize('/docs/inbox/holiday.png', size);

  it('accepts a size reported as text, the way the native layer sends it', async () => {
    reportsSize('5');

    const staged = await stageExplicitSharedFile(input());

    expect(staged.descriptor.fileSize).toBe(5);
  });

  it.each([
    ['an empty file', 0],
    ['a size the native layer could not read', Number.NaN],
    ['a file over the limit', MAX_SHARED_FILE_BYTES + 1],
  ])('refuses %s with the range the user can act on', async (_label, size) => {
    reportsSize(size);

    await expect(stageExplicitSharedFile(input())).rejects.toThrow(
      'Choose a file between 1 byte and 256 MB.',
    );
  });

  it('accepts a file exactly at the limit', async () => {
    reportsSize(MAX_SHARED_FILE_BYTES);

    // The message says 256 MB, so 256 MB has to be allowed - an off-by-one here contradicts the copy the
    // user is shown.
    const staged = await stageExplicitSharedFile(input());
    expect(staged.descriptor.fileSize).toBe(MAX_SHARED_FILE_BYTES);
  });

  it('takes the name apart before putting it in a path', async () => {
    const staged = await stageExplicitSharedFile(
      input({ name: '../../../Library/Preferences/holiday.png' }),
    );

    // The name arrived from outside the app. Only the last segment is used, so the staged copy cannot be
    // steered out of the staging directory.
    expect(staged.descriptor.name).toBe('holiday.png');
    expect(staged.path.startsWith(STAGING_ROOT)).toBe(true);
    expect(staged.path).not.toContain('..');
  });

  it('names the file itself when the name it was given is unusable', async () => {
    for (const name of ['', '   ', '/', 'C:\\Users\\me\\holiday.png']) {
      const staged = await stageExplicitSharedFile(input({ name }));

      // Falls back to the share's own id rather than staging something at a path it did not choose.
      expect(staged.descriptor.name).toBe(`${staged.descriptor.syncId}.bin`);
    }
  });

  it('decodes a name that arrived percent-encoded', async () => {
    const staged = await stageExplicitSharedFile(
      input({ name: 'file:///docs/My%20Holiday.png' }),
    );

    // What the receiving device writes to disk is this name, so leaving it encoded would land a file
    // called "My%20Holiday.png" on the Mac.
    expect(staged.descriptor.name).toBe('My Holiday.png');
  });

  it.each([
    ['no type at all', undefined],
    ['a null type', null],
    ['a blank type', '   '],
  ])(
    'falls back to a generic type when the picker gave %s',
    async (_label, mimeType) => {
      const staged = await stageExplicitSharedFile(input({ mimeType }));

      expect(staged.descriptor.mimeType).toBe('application/octet-stream');
    },
  );

  it('trims a type that arrived padded', async () => {
    const staged = await stageExplicitSharedFile(
      input({ mimeType: ' image/png ' }),
    );

    expect(staged.descriptor.mimeType).toBe('image/png');
  });

  it('stamps a time the receiving device can read', async () => {
    const staged = await stageExplicitSharedFile(input());

    expect(new Date(staged.descriptor.createdAt).toISOString()).toBe(
      staged.descriptor.createdAt,
    );
  });
});

describe('discarding a staged copy', () => {
  beforeEach(async () => {
    modelTransferFsBoundary.reset();
    await fs.writeFile('/docs/staged.bin', 'bytes');
  });

  it('deletes the bytes', async () => {
    await discardExplicitSharedFile('/docs/staged.bin');

    expect(await fs.exists('/docs/staged.bin')).toBe(false);
  });

  it('is happy when there is nothing left to delete', async () => {
    // It runs on the failure path, where the copy may never have been made. Throwing here would replace
    // the real failure with a cleanup one.
    await expect(
      discardExplicitSharedFile('/docs/never-existed.bin'),
    ).resolves.toBeUndefined();
  });

  it('is happy when the filesystem refuses to delete', async () => {
    fs.unlink.mockImplementationOnce(async () => {
      throw new Error('EPERM');
    });

    // Same reason, harder case: on iOS the file can be locked by the extension that handed it over. The
    // share still has to fail with the reason the share failed.
    await expect(
      discardExplicitSharedFile('/docs/staged.bin'),
    ).resolves.toBeUndefined();
  });
});
