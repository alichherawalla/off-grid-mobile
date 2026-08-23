import { Buffer } from 'buffer';
import RNFS from 'react-native-fs';
import {
  CHUNK_SIZE,
  IncrementalChecksum,
  MODEL_TRANSFER_MIME,
  type FileRequestMessage,
  type ModelTransferMetadata,
  type TransferredModelManifest,
} from '@offgrid/sync';
import { modelManager } from '../../../src/services/modelManager';
import { whisperService } from '../../../src/services/whisperService';
import { MobileModelPackageSink } from '../../../pro/sync/modelPackageSink';
import { modelTransferFsBoundary } from '../../utils/modelTransferFsBoundary';

jest.mock('react-native-fs', () => {
  const {
    modelTransferFsBoundary: boundary,
  } = require('../../utils/modelTransferFsBoundary');
  return { __esModule: true, default: boundary.module, ...boundary.module };
});

/**
 * A model arriving from another of the user's devices, landing on this one's disk.
 *
 * A model is the largest thing this app ever moves - gigabytes, over a phone's wifi, while the screen may go
 * off and the transfer may be interrupted several times before it finishes. So the sink is not really about
 * writing bytes; it is about what happens on the second, third and fourth attempt. It has to be able to pick
 * up where it stopped, or the user is watching the same gigabyte arrive over and over. It has to refuse a
 * model this device already has, in words the user recognises. And when the very last step fails, it has to
 * leave nothing behind that a later attempt would mistake for a real file.
 *
 * Everything here runs for real against a real filesystem in memory - the checksum, the model catalog, the
 * transcription catalog, the naming rules. Only the platform's file API is stood in for, because that is the
 * one part of this path that is not ours.
 */
describe('a model arriving on this device', () => {
  const DEVICE = 'the-mac';

  beforeEach(async () => {
    modelTransferFsBoundary.reset();
    await modelManager.initialize();
    await whisperService.ensureModelsDirExists();
  });

  /** Bytes that read as a real GGUF model: the magic the sink checks, then filler. */
  function modelBytes(size: number, fill = 0x31): Buffer {
    const bytes = Buffer.alloc(size, fill);
    bytes.write('GGUF', 0, 'ascii');
    return bytes;
  }

  function checksumOf(bytes: Buffer): string {
    const checksum = new IncrementalChecksum();
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      checksum.update(bytes.subarray(offset, offset + CHUNK_SIZE));
    }
    return checksum.digest();
  }

  function request(fileName: string, bytes: Buffer): FileRequestMessage {
    return {
      type: 'file_request',
      id: `request-for-${fileName}`,
      timestamp: 1_700_000_000_000,
      payload: {
        fileName,
        fileSize: bytes.length,
        mimeType: MODEL_TRANSFER_MIME,
        checksum: checksumOf(bytes),
      },
    };
  }

  function packageOf(
    manifest: TransferredModelManifest,
    fileIndex: number,
  ): ModelTransferMetadata {
    return {
      type: 'offgrid-model',
      version: 2,
      packageId: 'this-attempt',
      fileIndex,
      manifest,
    };
  }

  /**
   * A one-file text model. Small enough to move quickly here, and the sink's decisions do not depend on how
   * big it is - only on how much of it has already landed.
   */
  const TEXT_BYTES = modelBytes(3 * CHUNK_SIZE);
  const TEXT_MANIFEST: TransferredModelManifest = {
    id: 'off-grid/mobile-text',
    name: 'Mobile Text',
    kind: 'text',
    source: 'downloaded',
    files: [
      { name: 'mobile-text-Q4_K_M.gguf', sizeBytes: TEXT_BYTES.length, role: 'primary' },
    ],
  };

  /** A vision model: a weights file plus the projector that makes it able to see. */
  const VISION_PRIMARY = modelBytes(2 * CHUNK_SIZE, 0x32);
  const VISION_PROJECTOR = modelBytes(CHUNK_SIZE, 0x33);
  const VISION_MANIFEST: TransferredModelManifest = {
    id: 'off-grid/mobile-vision',
    name: 'Mobile Vision',
    kind: 'vision',
    source: 'downloaded',
    files: [
      {
        name: 'mobile-vision-Q4_K_M.gguf',
        sizeBytes: VISION_PRIMARY.length,
        role: 'primary',
      },
      {
        name: 'mmproj-F16.gguf',
        sizeBytes: VISION_PROJECTOR.length,
        role: 'projector',
      },
    ],
  };

  /** Transcription models are checked against a floor, so this one is genuinely that big. */
  const WHISPER_BYTES = Buffer.alloc(10 * 1024 * 1024, 0x34);
  const whisperManifest = (
    id: string,
    fileName: string,
  ): TransferredModelManifest => ({
    id,
    name: 'Whisper Base',
    kind: 'transcription',
    source: 'downloaded',
    files: [{ name: fileName, sizeBytes: WHISPER_BYTES.length, role: 'primary' }],
  });

  interface Receiver {
    sink: MobileModelPackageSink;
    /** True once the model is registered and usable, which is the only thing that ends a receive. */
    installed: () => boolean;
    releases: () => number;
    stageDirectory: string;
  }

  function receive(
    manifest: TransferredModelManifest,
    fileIndex: number,
    bytes: Buffer,
    destination = modelManager.getModelsDirectory(),
  ): Receiver {
    const file = manifest.files[fileIndex];
    if (!file) throw new Error('the package has no such file');
    const metadata = packageOf(manifest, fileIndex);
    let installed = false;
    let releases = 0;
    const sink = new MobileModelPackageSink({
      deviceId: DEVICE,
      request: request(file.name, bytes),
      metadata,
      releaseReservation: () => {
        releases += 1;
      },
      onInstalled: () => {
        installed = true;
      },
    });
    return {
      sink,
      installed: () => installed,
      releases: () => releases,
      stageDirectory: `${destination}/.sync-packages/${encodeURIComponent(DEVICE)}--this-attempt`,
    };
  }

  async function write(path: string, bytes: Buffer): Promise<void> {
    await RNFS.writeFile(path, bytes.toString('base64'), 'base64');
  }

  /** Stream a file in exactly as the transfer would: chunk by chunk, from the given offset. */
  async function stream(
    sink: MobileModelPackageSink,
    bytes: Buffer,
    from = 0,
  ): Promise<void> {
    for (let offset = from; offset < bytes.length; offset += CHUNK_SIZE) {
      await sink.write(offset, bytes.subarray(offset, offset + CHUNK_SIZE));
    }
  }

  describe('the whole model, first time', () => {
    it('lands in Models and is usable', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);

      expect(await receiver.sink.prepare()).toBe(0);
      await stream(receiver.sink, TEXT_BYTES);
      await expect(receiver.sink.finalize()).resolves.toBe(true);

      await expect(modelManager.getDownloadedModels()).resolves.toEqual([
        expect.objectContaining({
          // The catalog's identity for a downloaded model is repository plus file, because one repository
          // ships the same model at several quantizations and the user can hold more than one.
          id: 'off-grid/mobile-text/mobile-text-Q4_K_M.gguf',
          fileName: 'mobile-text-Q4_K_M.gguf',
          fileSize: TEXT_BYTES.length,
        }),
      ]);
      expect(receiver.installed()).toBe(true);
      // The staging directory is the transfer's scratch space. Left behind, it would count against the phone's
      // storage for a model that is already sitting in Models.
      await expect(RNFS.exists(receiver.stageDirectory)).resolves.toBe(false);
    });

    it('writes the bytes byte for byte', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await receiver.sink.prepare();
      await stream(receiver.sink, TEXT_BYTES);
      await receiver.sink.finalize();

      const landed = Buffer.from(
        await RNFS.read(
          `${modelManager.getModelsDirectory()}/mobile-text-Q4_K_M.gguf`,
          TEXT_BYTES.length,
          0,
          'base64',
        ),
        'base64',
      );
      expect(landed.equals(TEXT_BYTES)).toBe(true);
    });

    it('frees the reservation exactly once, so the same model can be sent again', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await receiver.sink.prepare();
      await stream(receiver.sink, TEXT_BYTES);
      await receiver.sink.finalize();
      await receiver.sink.abort('finished', false);

      // The reservation is what stops two transfers writing the same file at once. Releasing it twice would
      // free a reservation a LATER transfer had taken out.
      expect(receiver.releases()).toBe(1);
    });
  });

  describe('a transfer that was interrupted', () => {
    it('picks up from the last whole chunk that landed', async () => {
      const first = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await first.sink.prepare();
      await stream(first.sink, TEXT_BYTES.subarray(0, CHUNK_SIZE));
      // The phone slept, the wifi dropped, the app was killed: whatever the reason, the partial survives.
      await first.sink.abort('connection lost', true);

      const second = receive(TEXT_MANIFEST, 0, TEXT_BYTES);

      // Not zero: the user does not watch the first chunk arrive twice.
      expect(await second.sink.prepare()).toBe(CHUNK_SIZE);
      await stream(second.sink, TEXT_BYTES, CHUNK_SIZE);
      await expect(second.sink.finalize()).resolves.toBe(true);
      expect(second.installed()).toBe(true);
    });

    it('starts over when the partial stopped mid-chunk', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await write(
        `${receiver.stageDirectory}/mobile-text-Q4_K_M.gguf.part`,
        TEXT_BYTES.subarray(0, CHUNK_SIZE + 5),
      );

      // The sender can only resume on a chunk boundary, so a partial that ends anywhere else cannot be
      // continued from - and continuing from the wrong offset writes a file that is the right SIZE and the
      // wrong bytes, which is far worse than starting again.
      expect(await receiver.sink.prepare()).toBe(0);
      const partial = await RNFS.stat(
        `${receiver.stageDirectory}/mobile-text-Q4_K_M.gguf.part`,
      );
      expect(partial.size).toBe(0);
    });

    it('starts over when the partial is somehow longer than the file', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await write(
        `${receiver.stageDirectory}/mobile-text-Q4_K_M.gguf.part`,
        Buffer.concat([TEXT_BYTES, Buffer.alloc(CHUNK_SIZE)]),
      );

      expect(await receiver.sink.prepare()).toBe(0);
    });

    it('resumes at the very end, where the last chunk was short', async () => {
      // A model is not a whole number of chunks, so the final chunk almost never is one. A partial that is
      // already the full size is complete even though it is not a chunk multiple, and demanding a multiple
      // here would restart every transfer that got all the way to its last byte.
      const bytes = modelBytes(2 * CHUNK_SIZE + 17, 0x35);
      const manifest: TransferredModelManifest = {
        ...TEXT_MANIFEST,
        id: 'off-grid/odd-sized',
        files: [{ name: 'odd-sized-Q4_K_M.gguf', sizeBytes: bytes.length, role: 'primary' }],
      };
      const receiver = receive(manifest, 0, bytes);
      await write(`${receiver.stageDirectory}/odd-sized-Q4_K_M.gguf.part`, bytes);

      expect(await receiver.sink.prepare()).toBe(bytes.length);
      await expect(receiver.sink.finalize()).resolves.toBe(true);
    });

    it('asks for nothing more when the file already finished staging', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await write(`${receiver.stageDirectory}/mobile-text-Q4_K_M.gguf`, TEXT_BYTES);

      // Staged and verified on an earlier attempt, and the transfer was interrupted between that and being
      // registered. There is nothing left to send.
      expect(await receiver.sink.prepare()).toBe(TEXT_BYTES.length);
      await expect(receiver.sink.finalize()).resolves.toBe(true);
      expect(receiver.installed()).toBe(true);
    });

    it('refuses when a directory is sitting where the partial should be', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await RNFS.mkdir(`${receiver.stageDirectory}/mobile-text-Q4_K_M.gguf.part`);

      // Writing into it would fail at some unpredictable later point. Refusing here means the transfer fails
      // with a reason instead of half-succeeding.
      await expect(receiver.sink.prepare()).rejects.toThrow(
        'model partial is not a regular file',
      );
    });

    it('picks up from the last whole chunk on an iPhone too', async () => {
      const first = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await first.sink.prepare();
      await stream(first.sink, TEXT_BYTES.subarray(0, CHUNK_SIZE));
      await first.sink.abort('connection lost', true);

      // iOS reports a file's size as a STRING and Android as a number. Compared as a number, an iPhone's
      // "262144" is never equal to anything and is never a multiple of the chunk size, so every interrupted
      // transfer would restart from zero - on one platform only, which is the kind of thing that reads as
      // "sync is slow on my phone" rather than as a bug.
      const stat = RNFS.stat as jest.Mock;
      const realStat = stat.getMockImplementation()!;
      stat.mockImplementation(async (path: string) => {
        const value = await realStat(path);
        return { ...value, size: String(value.size) };
      });

      try {
        const second = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
        expect(await second.sink.prepare()).toBe(CHUNK_SIZE);
        await stream(second.sink, TEXT_BYTES, CHUNK_SIZE);
        await expect(second.sink.finalize()).resolves.toBe(true);
        expect(second.installed()).toBe(true);
      } finally {
        stat.mockImplementation(realStat);
      }
    });

    it('throws away the partial when the transfer was cancelled outright', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await receiver.sink.prepare();
      await stream(receiver.sink, TEXT_BYTES.subarray(0, CHUNK_SIZE));
      await receiver.sink.abort('cancelled by the user', false);

      // Cancelled means cancelled: a gigabyte of a model nobody is waiting for must not keep occupying the
      // phone's storage.
      await expect(RNFS.exists(receiver.stageDirectory)).resolves.toBe(false);
      expect(receiver.releases()).toBe(1);
    });

    it('survives being aborted twice', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await receiver.sink.prepare();
      await receiver.sink.abort('cancelled by the user', false);
      await receiver.sink.abort('cancelled by the user', false);

      expect(receiver.releases()).toBe(1);
    });
  });

  describe('a model this device already has', () => {
    it('is refused in words the user recognises', async () => {
      const first = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await first.sink.prepare();
      await stream(first.sink, TEXT_BYTES);
      await first.sink.finalize();

      const again = receive(TEXT_MANIFEST, 0, TEXT_BYTES);

      // The one thing worth refusing outright, and the reason travels back to the sending device to be shown
      // there. Name the model and the destination state; "this" leaves both facts ambiguous.
      await expect(again.sink.prepare()).rejects.toThrow(
        'Mobile Text is already installed on the receiving device',
      );
    });

    it('keeps the file it already has and only takes the one it is missing', async () => {
      // The user downloaded these weights on this phone already, and is now sent the vision package for the
      // same model from the Mac. The projector is the only new thing.
      const destination = modelManager.getModelsDirectory();
      await write(`${destination}/mobile-vision-Q4_K_M.gguf`, VISION_PRIMARY);

      for (const [index, bytes] of [VISION_PRIMARY, VISION_PROJECTOR].entries()) {
        const receiver = receive(VISION_MANIFEST, index, bytes);
        await receiver.sink.prepare();
        await stream(receiver.sink, bytes);
        await expect(receiver.sink.finalize()).resolves.toBe(true);
      }

      // A file already here at the same size IS this same file, so it is left exactly where it is rather than
      // moved over itself - and it is not in the set that a later failure would undo, because undoing it
      // would delete a model the user already had.
      const landed = Buffer.from(
        await RNFS.read(
          `${destination}/mobile-vision-Q4_K_M.gguf`,
          VISION_PRIMARY.length,
          0,
          'base64',
        ),
        'base64',
      );
      expect(landed.equals(VISION_PRIMARY)).toBe(true);
      await expect(modelManager.getDownloadedModels()).resolves.toEqual([
        expect.objectContaining({ isVisionModel: true }),
      ]);
    });

    it('is not refused when only part of the package is here', async () => {
      const primary = receive(VISION_MANIFEST, 0, VISION_PRIMARY);
      await primary.sink.prepare();
      await stream(primary.sink, VISION_PRIMARY);
      await expect(primary.sink.finalize()).resolves.toBe(true);
      // One of two files landed, so the model is not usable yet and nothing has been registered.
      expect(primary.installed()).toBe(false);

      const projector = receive(VISION_MANIFEST, 1, VISION_PROJECTOR);

      // A package that partly landed on an earlier attempt has to be able to finish. Refusing here would
      // leave the user with a vision model that can never see.
      await expect(projector.sink.prepare()).resolves.toBe(0);
      await stream(projector.sink, VISION_PROJECTOR);
      await expect(projector.sink.finalize()).resolves.toBe(true);
      expect(projector.installed()).toBe(true);
    });

    it('repairs a deleted registry row when all package files remain', async () => {
      const destination = modelManager.getModelsDirectory();
      const projectorHere = 'mobile-vision-mmproj-F16.gguf';
      await write(
        `${destination}/${VISION_MANIFEST.files[0].name}`,
        VISION_PRIMARY,
      );
      await write(`${destination}/${projectorHere}`, VISION_PROJECTOR);
      await expect(modelManager.getDownloadedModels()).resolves.toEqual([]);

      for (const [index, bytes] of [
        VISION_PRIMARY,
        VISION_PROJECTOR,
      ].entries()) {
        const receiver = receive(VISION_MANIFEST, index, bytes);
        await expect(receiver.sink.prepare()).resolves.toBe(0);
        await stream(receiver.sink, bytes);
        await expect(receiver.sink.finalize()).resolves.toBe(true);
      }

      await expect(modelManager.getDownloadedModels()).resolves.toEqual([
        expect.objectContaining({
          name: 'Mobile Vision',
          fileName: VISION_MANIFEST.files[0].name,
          mmProjFileName: projectorHere,
          isVisionModel: true,
        }),
      ]);
    });
  });

  describe("a projector that another model's projector is already called", () => {
    /** A second vision model whose projector ships under the exact same generic name. */
    const OTHER_PRIMARY = modelBytes(CHUNK_SIZE, 0x36);
    const OTHER_MANIFEST: TransferredModelManifest = {
      id: 'off-grid/other-vision',
      name: 'Other Vision',
      kind: 'vision',
      source: 'downloaded',
      files: [
        {
          name: 'other-vision-Q4_K_M.gguf',
          sizeBytes: OTHER_PRIMARY.length,
          role: 'primary',
        },
        { name: 'mmproj-F16.gguf', sizeBytes: VISION_PROJECTOR.length, role: 'projector' },
      ],
    };

    async function install(
      manifest: TransferredModelManifest,
      files: Buffer[],
    ): Promise<void> {
      for (const [index, bytes] of files.entries()) {
        const receiver = receive(manifest, index, bytes);
        await receiver.sink.prepare();
        await stream(receiver.sink, bytes);
        await receiver.sink.finalize();
      }
    }

    it('is renamed so both models keep their sight', async () => {
      await install(VISION_MANIFEST, [VISION_PRIMARY, VISION_PROJECTOR]);
      await install(OTHER_MANIFEST, [OTHER_PRIMARY, VISION_PROJECTOR]);

      // Several repositories ship a projector called exactly `mmproj-F16.gguf`. Keeping the sender's name
      // would mean the second model collides with the first on disk - and the on-disk stem is also what ties
      // a projector to its model, so a wrong name leaves a vision model that loads as text only.
      const directory = modelManager.getModelsDirectory();
      const present = (await RNFS.readDir(directory))
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .sort();
      expect(present).toEqual([
        'mobile-vision-Q4_K_M.gguf',
        'mobile-vision-mmproj-F16.gguf',
        'other-vision-Q4_K_M.gguf',
        'other-vision-mmproj-F16.gguf',
      ]);
    });

    it('is recorded under the name it actually has here', async () => {
      await install(VISION_MANIFEST, [VISION_PRIMARY, VISION_PROJECTOR]);

      // Promotion and registration read the same resolution, so what is on disk and what the catalog believes
      // cannot drift apart. They used to disagree, and the disagreement was a vision model with no vision.
      const models = await modelManager.getDownloadedModels();
      expect(models).toEqual([
        expect.objectContaining({
          id: 'off-grid/mobile-vision/mobile-vision-Q4_K_M.gguf',
          isVisionModel: true,
          mmProjPath: `${modelManager.getModelsDirectory()}/mobile-vision-mmproj-F16.gguf`,
        }),
      ]);
    });
  });

  describe('a phone that runs out of room on the last step', () => {
    it('leaves no half-installed model behind', async () => {
      const primary = receive(VISION_MANIFEST, 0, VISION_PRIMARY);
      await primary.sink.prepare();
      await stream(primary.sink, VISION_PRIMARY);
      await primary.sink.finalize();

      const projector = receive(VISION_MANIFEST, 1, VISION_PROJECTOR);
      await projector.sink.prepare();
      await stream(projector.sink, VISION_PROJECTOR);

      // Both files are staged and verified, and the phone fills up as they are being moved into place. This
      // is the platform's own failure, reported the way it reports it.
      const move = RNFS.moveFile as jest.Mock;
      const realMove = move.getMockImplementation()!;
      move.mockImplementation(async (from: string, to: string) => {
        if (to.endsWith('mobile-vision-mmproj-F16.gguf')) {
          throw new Error('ENOSPC: no space left on device');
        }
        return realMove(from, to);
      });

      await expect(projector.sink.finalize()).rejects.toThrow('ENOSPC');
      move.mockImplementation(realMove);

      // The weights arrived and the projector did not. Left there, that is a vision model the catalog would
      // list as usable and which would load as text only - the exact failure the naming rule exists to
      // prevent, arrived at from the other direction. So the files this attempt moved are moved back out.
      const present = (await RNFS.readDir(modelManager.getModelsDirectory()))
        .filter(entry => entry.isFile())
        .map(entry => entry.name);
      expect(present).toEqual([]);
      await expect(modelManager.getDownloadedModels()).resolves.toEqual([]);
      expect(projector.installed()).toBe(false);

      // The staged bytes go too. The whole package has to be sent again, which on a phone that just ran out
      // of room is the right way round: holding a gigabyte of a model that could not be installed would keep
      // the disk full and the next attempt would fail the same way.
      await expect(RNFS.exists(projector.stageDirectory)).resolves.toBe(false);
    });
  });

  describe("tidying up that the platform will not let it do", () => {
    /** The platform refusing to delete anything: a file held open, a directory that has already gone. */
    function refuseDeletes(): () => void {
      const unlink = RNFS.unlink as jest.Mock;
      const real = unlink.getMockImplementation()!;
      unlink.mockRejectedValue(new Error('EPERM: operation not permitted'));
      return () => unlink.mockImplementation(real);
    }

    it('still installs the model when the scratch directory will not delete', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await receiver.sink.prepare();
      await stream(receiver.sink, TEXT_BYTES);
      const restore = refuseDeletes();

      try {
        // The model is on disk and registered. Failing the whole transfer over leftover scratch space would
        // throw away a completed multi-gigabyte download to tidy up a directory.
        await expect(receiver.sink.finalize()).resolves.toBe(true);
        expect(receiver.installed()).toBe(true);
      } finally {
        restore();
      }
    });

    it('still gives up the reservation when a cancelled transfer will not clean up', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await receiver.sink.prepare();
      const restore = refuseDeletes();

      try {
        // The reservation is what lets the user try again. Holding onto it because a delete failed would
        // leave this model permanently unable to be sent to this phone until the app restarts.
        await expect(
          receiver.sink.abort('cancelled by the user', false),
        ).resolves.toBeUndefined();
        expect(receiver.releases()).toBe(1);
      } finally {
        restore();
      }
    });

    it('still reports the real failure when the rollback cannot delete either', async () => {
      const primary = receive(VISION_MANIFEST, 0, VISION_PRIMARY);
      await primary.sink.prepare();
      await stream(primary.sink, VISION_PRIMARY);
      await primary.sink.finalize();

      const projector = receive(VISION_MANIFEST, 1, VISION_PROJECTOR);
      await projector.sink.prepare();
      await stream(projector.sink, VISION_PROJECTOR);

      const move = RNFS.moveFile as jest.Mock;
      const realMove = move.getMockImplementation()!;
      move.mockRejectedValue(new Error('ENOSPC: no space left on device'));
      const restore = refuseDeletes();

      try {
        // Two failures at once, and the one the user is told about is the one that actually stopped the
        // transfer. A rollback that reported its own cleanup trouble instead would hide the cause.
        await expect(projector.sink.finalize()).rejects.toThrow('ENOSPC');
      } finally {
        restore();
        move.mockImplementation(realMove);
      }
    });
  });

  describe('bytes that are not what was promised', () => {
    it('are refused when the checksum does not match', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await receiver.sink.prepare();
      await stream(receiver.sink, modelBytes(TEXT_BYTES.length, 0x39));

      // Right size, wrong contents. Nothing is promoted, so the user never gets a model that fails to load
      // hours later with nothing to explain it.
      await expect(receiver.sink.finalize()).resolves.toBe(false);
      await expect(modelManager.getDownloadedModels()).resolves.toEqual([]);
    });

    it('are refused when the file came up short', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await receiver.sink.prepare();
      await stream(receiver.sink, TEXT_BYTES.subarray(0, 2 * CHUNK_SIZE));

      await expect(receiver.sink.finalize()).resolves.toBe(false);
    });

    it('are refused when the file is not a model at all', async () => {
      const notAModel = Buffer.alloc(2 * CHUNK_SIZE, 0x3a);
      const manifest: TransferredModelManifest = {
        ...TEXT_MANIFEST,
        id: 'off-grid/not-a-model',
        files: [{ name: 'not-a-model-Q4_K_M.gguf', sizeBytes: notAModel.length, role: 'primary' }],
      };
      const receiver = receive(manifest, 0, notAModel);
      await receiver.sink.prepare();
      await stream(receiver.sink, notAModel);

      // The size and the checksum both agree - they only prove the bytes arrived intact, not that they are a
      // model. The header is what says this file is loadable, and loading a file that is not crashes the app.
      await expect(receiver.sink.finalize()).resolves.toBe(false);
    });
  });

  describe('a package that arrived whole over the fast path', () => {
    it('lands where the chunks would have, and is checked on the same terms', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      const destination = await receiver.sink.blobDestination();
      expect(destination).toBe(
        `${receiver.stageDirectory}/mobile-text-Q4_K_M.gguf.part`,
      );

      // Streamed natively rather than chunk by chunk, but finalize verifies the size and checksum of
      // whatever is there, so a payload that arrived whole is admitted on exactly the terms a chunked one is.
      await write(destination!, TEXT_BYTES);
      await expect(receiver.sink.finalize()).resolves.toBe(true);
      expect(receiver.installed()).toBe(true);
    });

    it('is still refused when the bytes are wrong', async () => {
      const receiver = receive(TEXT_MANIFEST, 0, TEXT_BYTES);
      await write(
        (await receiver.sink.blobDestination())!,
        modelBytes(TEXT_BYTES.length, 0x3b),
      );

      await expect(receiver.sink.finalize()).resolves.toBe(false);
    });
  });

  describe('a transcription model', () => {
    it('lands in the transcription catalog, not the model one', async () => {
      const receiver = receive(
        whisperManifest('ggerganov/whisper.cpp/base.en', 'ggml-base.en.bin'),
        0,
        WHISPER_BYTES,
        whisperService.getModelsDir(),
      );
      await receiver.sink.prepare();
      await stream(receiver.sink, WHISPER_BYTES);
      await expect(receiver.sink.finalize()).resolves.toBe(true);

      await expect(whisperService.listDownloadedModels()).resolves.toEqual([
        expect.objectContaining({ modelId: 'base.en' }),
      ]);
      expect(receiver.installed()).toBe(true);
    });

    it('is refused, and deleted, when it is too small to be one', async () => {
      const tooSmall = Buffer.alloc(1024, 0x3c);
      const receiver = receive(
        whisperManifest('ggerganov/whisper.cpp/base.en', 'ggml-base.en.bin'),
        0,
        tooSmall,
        whisperService.getModelsDir(),
      );
      await receiver.sink.prepare();
      await stream(receiver.sink, tooSmall);

      // Note the shape of this refusal: a text model that fails its check comes back false, and this one
      // throws, because the transcription catalog's own validator throws (and deletes the file it rejected).
      // Both end the transfer; only this one carries a reason the user can read.
      await expect(receiver.sink.finalize()).rejects.toThrow('too small');
      await expect(whisperService.listDownloadedModels()).resolves.toEqual([]);
    });

    it.each([
      ['its file is named after a different model', 'ggerganov/whisper.cpp/base.en', 'ggml-small.en.bin'],
      ['its id tries to reach out of the models directory', 'ggerganov/whisper.cpp/../base.en', 'ggml-base.en.bin'],
      ['it carries a second file', 'ggerganov/whisper.cpp/base.en', 'ggml-base.en.bin'],
    ])('is refused before a byte is written when %s', (_label, id, fileName) => {
      const manifest = whisperManifest(id, fileName);
      const files: TransferredModelManifest['files'] =
        _label === 'it carries a second file'
          ? [
              manifest.files[0],
              { name: 'extra.bin', sizeBytes: 1024, role: 'primary' as const },
            ]
          : manifest.files;

      // A transcription model's id IS its file name on disk, so an id that does not agree with the file it
      // arrived as is the one shape that could write outside the models directory. The shared rule catches
      // every such package at construction, which is why the sink's own identity check has never had to
      // fire - it is the second lock on the same door, and it stays because the two are written apart.
      expect(() =>
        receive({ ...manifest, files }, 0, WHISPER_BYTES, whisperService.getModelsDir()),
      ).toThrow('a Whisper transfer is one ggml bin named after the model');
    });

    it('is refused before a byte is written when its id names no model', () => {
      // `ggerganov/whisper.cpp/` with nothing after it: the prefix says Whisper, and there is no model left
      // to name, so it is not a package at all rather than a malformed one.
      expect(() =>
        receive(
          whisperManifest('ggerganov/whisper.cpp/', 'ggml-.bin'),
          0,
          WHISPER_BYTES,
          whisperService.getModelsDir(),
        ),
      ).toThrow('not a Whisper package');
    });

    it('is refused before a byte is written when it does not come from the project this app knows', () => {
      // Not a Whisper package at all by its id, so it is judged as a transcription package of unknown
      // provenance - the shape a Parakeet package from a Mac has, which a phone cannot run.
      expect(() =>
        receive(
          whisperManifest('someone-else/base.en', 'ggml-base.en.bin'),
          0,
          WHISPER_BYTES,
          whisperService.getModelsDir(),
        ),
      ).toThrow('this model only transfers between two devices of the same kind');
    });
  });

  describe('a package this build cannot use', () => {
    it.each([
      [
        'it is an image model',
        {
          id: 'off-grid/mobile-image',
          name: 'Mobile Image',
          kind: 'image' as const,
          source: 'downloaded' as const,
          files: [{ name: 'mobile-image.safetensors', sizeBytes: 1024, role: 'primary' as const }],
        },
      ],
      [
        'it carries two models at once',
        {
          ...TEXT_MANIFEST,
          files: [
            { name: 'one-Q4_K_M.gguf', sizeBytes: 1024, role: 'primary' as const },
            { name: 'two-Q4_K_M.gguf', sizeBytes: 1024, role: 'primary' as const },
          ],
        },
      ],
      [
        'it is a text model shipping a projector',
        {
          ...TEXT_MANIFEST,
          files: [
            { name: 'mobile-text-Q4_K_M.gguf', sizeBytes: 1024, role: 'primary' as const },
            { name: 'mmproj-F16.gguf', sizeBytes: 1024, role: 'projector' as const },
          ],
        },
      ],
    ])('is refused before a single byte is written when %s', (_label, manifest) => {
      // Refused at construction, not at the first chunk: an unusable package must not get as far as reserving
      // a file name or creating a staging directory on the user's phone.
      expect(() => receive(manifest as TransferredModelManifest, 0, TEXT_BYTES)).toThrow();
    });
  });

  describe('a package sent by an older build', () => {
    it('stages under the request it arrived on, because it has no package identity', async () => {
      const bytes = modelBytes(CHUNK_SIZE, 0x3d);
      const manifest: TransferredModelManifest = {
        ...TEXT_MANIFEST,
        id: 'off-grid/legacy-text',
        files: [{ name: 'legacy-Q4_K_M.gguf', sizeBytes: bytes.length, role: 'primary' }],
      };
      const message = request('legacy-Q4_K_M.gguf', bytes);
      const sink = new MobileModelPackageSink({
        deviceId: DEVICE,
        request: message,
        // Version 1 named no package: every file request stood alone, so the request's own id is the only
        // identity available to group its parts under.
        metadata: { type: 'offgrid-model', version: 1, manifest },
        releaseReservation: () => undefined,
      });

      expect(await sink.blobDestination()).toBe(
        `${modelManager.getModelsDirectory()}/.sync-packages/${encodeURIComponent(
          DEVICE,
        )}--${message.id}/legacy-Q4_K_M.gguf.part`,
      );
      await sink.prepare();
      await stream(sink, bytes);
      await expect(sink.finalize()).resolves.toBe(true);
      await expect(modelManager.getDownloadedModels()).resolves.toEqual([
        expect.objectContaining({
          id: 'off-grid/legacy-text/legacy-Q4_K_M.gguf',
        }),
      ]);
    });

    it('takes the first file as the model when the sender marked no roles', async () => {
      // Version 1 senders described a package as a list of files with no roles at all, so the first file is
      // taken as the model. Worth knowing what that costs: the renaming rule keys on the DECLARED role, so a
      // projector that arrives without one keeps the sender's name - and `mmproj-F16.gguf` is exactly the
      // generic name several repositories ship, which is the collision the rule exists to prevent. Pinned as
      // it behaves, because a build old enough to send roleless manifests predates grouped packages.
      const primary = modelBytes(CHUNK_SIZE, 0x3f);
      const manifest: TransferredModelManifest = {
        id: 'off-grid/unroled-vision',
        name: 'Unroled Vision',
        kind: 'vision',
        source: 'downloaded',
        files: [
          { name: 'unroled-vision-Q4_K_M.gguf', sizeBytes: primary.length },
          { name: 'mmproj-F16.gguf', sizeBytes: VISION_PROJECTOR.length },
        ],
      };

      for (const [index, bytes] of [primary, VISION_PROJECTOR].entries()) {
        const receiver = receive(manifest, index, bytes);
        await receiver.sink.prepare();
        await stream(receiver.sink, bytes);
        await expect(receiver.sink.finalize()).resolves.toBe(true);
      }

      const present = (await RNFS.readDir(modelManager.getModelsDirectory()))
        .filter(entry => entry.isFile())
        .map(entry => entry.name);
      expect(present.sort()).toEqual([
        'mmproj-F16.gguf',
        'unroled-vision-Q4_K_M.gguf',
      ]);
    });

    it('finishes without a caller that wants to be told', async () => {
      const bytes = modelBytes(CHUNK_SIZE, 0x3e);
      const manifest: TransferredModelManifest = {
        ...TEXT_MANIFEST,
        id: 'off-grid/unwatched',
        files: [{ name: 'unwatched-Q4_K_M.gguf', sizeBytes: bytes.length, role: 'primary' }],
      };
      const sink = new MobileModelPackageSink({
        deviceId: DEVICE,
        request: request('unwatched-Q4_K_M.gguf', bytes),
        metadata: packageOf(manifest, 0),
        releaseReservation: () => undefined,
      });

      await sink.prepare();
      await stream(sink, bytes);
      await expect(sink.finalize()).resolves.toBe(true);
    });
  });
});
