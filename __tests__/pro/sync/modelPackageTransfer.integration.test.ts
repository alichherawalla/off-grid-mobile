import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import TcpSocket from 'react-native-tcp-socket';
import { NO_COMPRESSION, unzip, zip } from 'react-native-zip-archive';
import {
  FileTransferManager,
  IncrementalChecksum,
  MODEL_TRANSFER_MIME,
  type DeviceInfo,
  type ModelPackageTransferMetadata,
  type TransferFileSource,
  type TransferredModelManifest,
} from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import { modelManager } from '../../../src/services/modelManager';
import { useAppStore } from '../../../src/stores/appStore';
import { buildSyncEngine } from '../../../src/services/sync/engine';
import { whisperService } from '../../../src/services/whisperService';
import { useWhisperStore } from '../../../src/stores/whisperStore';
import { modelTransferService } from '../../../pro/sync/modelTransferService';
import { modelTransferJobs } from '../../../pro/sync/modelTransferJobs';
import { syncService } from '../../../pro/sync/syncService';
import { useSyncStore } from '../../../pro/sync/syncStore';
import {
  getDiscoveryBoundaries,
  resetDiscoveryBoundaries,
} from '../../utils/nativeSyncBoundaries';
import { modelTransferFsBoundary } from '../../utils/modelTransferFsBoundary';
import { createPeerEntitlement } from '../../harness/peerEntitlement';
import { createKeygenFake } from '../../harness/keygenFake';
import { transferredImageManifest } from '../../../src/services/modelManager/imageTransfer';

jest.mock('react-native-tcp-socket', () => {
  const {
    createNativeTcpBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const {
    createNativeDiscoveryBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

jest.mock('react-native-fs', () => {
  const {
    modelTransferFsBoundary: boundary,
  } = require('../../utils/modelTransferFsBoundary');
  return {
    __esModule: true,
    default: boundary.module,
    ...boundary.module,
  };
});

const nativeTcpBoundary = TcpSocket as unknown as RnTcpModule;

/**
 * The licence both devices end up on. The peer sponsors the phone into it, and the phone then
 * registers its own installation for real - against an in-memory Keygen, because the provider's HTTP
 * endpoint is the only part of that path that is not ours.
 */
const LICENCE_KEY = 'OFFGRID-TEST-LICENCE';
const keygen = createKeygenFake();
/** The provider's id for that licence, which is what a credential carries as its entitlement. */
let licenceId = '';

async function waitForState(
  condition: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for model transfer state');
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function packageSource(
  bytes: Buffer,
  metadata: ModelPackageTransferMetadata,
): TransferFileSource {
  const file = metadata.manifest.files[metadata.fileIndex];
  if (!file) throw new Error('Package source has no selected file');
  const checksum = new IncrementalChecksum();
  checksum.update(bytes);
  return {
    fileName: file.name,
    fileSize: bytes.length,
    mimeType: MODEL_TRANSFER_MIME,
    metadata,
    checksum: async () => checksum.digest(),
    read: async (offset, length) =>
      new Uint8Array(bytes.subarray(offset, offset + length)),
  };
}

function modelBytes(size: number, fill: number): Buffer {
  const bytes = Buffer.alloc(size, fill);
  bytes.write('GGUF', 0, 'ascii');
  return bytes;
}

function packageMetadata(
  packageId: string,
  manifest: TransferredModelManifest,
  fileIndex: number,
): ModelPackageTransferMetadata {
  return {
    type: 'offgrid-model',
    version: 2,
    packageId,
    fileIndex,
    manifest,
  };
}

/**
 * The pairing code this phone is showing. A peer proves it is the device the user is looking at by
 * presenting this code, which is why nothing has to be accepted afterwards.
 */
function phonePairingCode(): string {
  const code = useSyncStore.getState().pairingCode.code;
  if (!code) throw new Error('the phone has not issued a pairing code yet');
  return code;
}

describe('Pro mobile model package receiver', () => {
  let remote: ReturnType<typeof buildSyncEngine> | undefined;
  let remoteTransfers: FileTransferManager | undefined;

  beforeEach(async () => {
    modelTransferFsBoundary.reset();
    keygen.reset();
    keygen.install();
    licenceId = keygen.addLicence({ key: LICENCE_KEY, seats: 3 });
    await AsyncStorage.clear();
    resetDiscoveryBoundaries();
    useSyncStore.getState().reset();
    // Pairing is a Pro capability, so a receiver that is not Pro refuses the Mac before any model is
    // offered. The rest of this suite is about what happens AFTER two devices are paired.
    useAppStore.getState().setProActive(true);
    useAppStore.getState().setDownloadedImageModels([]);
    (unzip as jest.Mock).mockImplementation(
      async (_archive: string, target: string) => {
        for (const component of [
          'TextEncoder.mlmodelc',
          'VAEDecoder.mlmodelc',
          'Unet.mlmodelc',
        ]) {
          modelTransferFsBoundary.seedDir(`${target}/${component}`);
        }
        modelTransferFsBoundary.seedTextFile(`${target}/merges.txt`, 'merge');
        modelTransferFsBoundary.seedTextFile(
          `${target}/vocab.json`,
          '{"token":1}',
        );
        return target;
      },
    );
    await useWhisperStore.getState().refreshPresentModels();
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
  });

  afterEach(async () => {
    keygen.restore();
    await remoteTransfers?.dispose();
    await remote?.engine.stop();
    await syncService.stop();
    await modelTransferService.stop();
  });

  /**
   * A paired, connected Mac, arrived at the way a user does: it presents the code this phone is
   * showing, and the phone admits it without anything else to accept.
   */
  async function connectDesktop(): Promise<{
    mobile: DeviceInfo;
    transfers: FileTransferManager;
  }> {
    const remoteDevice: DeviceInfo = {
      id: 'desktop-package-source',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    remote = buildSyncEngine({
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      // Pairing is a licensed transaction. A stand-in peer with no entitlement cannot pair at all, so
      // it carries one - and the phone under test uses its own real adapter throughout.
      pairingEntitlement: createPeerEntitlement({
        licensed: true,
        entitlementId: licenceId,
        secret: LICENCE_KEY,
      }),
      onMessage: (deviceId, message) => {
        remoteTransfers?.handleMessage(deviceId, message);
      },
    });
    const transfers = new FileTransferManager({
      send: (deviceId, message) => remote!.engine.send(deviceId, message),
      createSink: async () => null,
    });
    remoteTransfers = transfers;

    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    modelTransferService.start();
    await syncService.start();

    const mobile = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) {
      throw new Error('Sync did not publish the mobile device');
    }
    const pairing = remote.engine.pair(
      {
        ...mobile,
        host: '127.0.0.1',
        port: discovery.publishedPort,
      },
      phonePairingCode(),
    );
    await waitForState(() =>
      useSyncStore
        .getState()
        .pairingAttempts.some(
          attempt =>
            attempt.device.id === remoteDevice.id &&
            attempt.direction === 'incoming' &&
            attempt.stage === 'waiting_for_confirmation',
        ),
    );
    await pairing;
    await waitForState(() =>
      useSyncStore
        .getState()
        .knownDevices.some(
          device =>
            device.id === remoteDevice.id && device.status === 'connected',
        ),
    );
    return { mobile, transfers };
  }

  it('admits vision, Whisper, and same-runtime Core ML packages while rejecting incompatible runtimes', async () => {
    const { mobile, transfers } = await connectDesktop();

    const primary = modelBytes(96 * 1024 + 4, 0x31);
    const projector = modelBytes(64 * 1024 + 4, 0x32);
    const visionManifest: TransferredModelManifest = {
      id: 'off-grid/mobile-vision',
      name: 'Mobile Vision',
      kind: 'vision',
      source: 'downloaded',
      files: [
        {
          name: 'mobile-vision-Q4_K_M.gguf',
          sizeBytes: primary.length,
          role: 'primary',
        },
        {
          name: 'mmproj-mobile-vision-F16.gguf',
          sizeBytes: projector.length,
          role: 'projector',
        },
      ],
    };
    await transfers.sendFile(
      mobile.id,
      packageSource(
        primary,
        packageMetadata('vision-package', visionManifest, 0),
      ),
    );
    const primaryJob = modelTransferJobs.activeFor(
      'desktop-package-source',
      visionManifest.id,
    );
    expect(primaryJob).toEqual(
      expect.objectContaining({
        bytesTransferred: primary.length,
        bytesTotal: primary.length + projector.length,
      }),
    );

    const modelsDirectory = modelManager.getModelsDirectory();
    await expect(
      modelTransferFsBoundary.exists(
        `${modelsDirectory}/${visionManifest.files[0].name}`,
      ),
    ).resolves.toBe(false);
    await expect(modelManager.getDownloadedModels()).resolves.toHaveLength(0);

    await transfers.sendFile(
      mobile.id,
      packageSource(
        projector,
        packageMetadata('vision-package', visionManifest, 1),
      ),
    );
    const completedVisionJob = modelTransferJobs
      .list()
      .find(job => job.packageId === 'vision-package');
    expect(completedVisionJob).toEqual(
      expect.objectContaining({
        phase: 'completed',
        bytesTransferred: primary.length + projector.length,
        bytesTotal: primary.length + projector.length,
      }),
    );
    // The projector lands under the name THIS device gives a projector - the model's own stem, the same
    // rule a download uses - not the name the sender happened to have for it. That is what keeps the
    // vision link alive, and what stops two models colliding on a shared `mmproj-F16.gguf`.
    const projectorHere = 'mobile-vision-mmproj-F16.gguf';
    await expect(modelManager.getDownloadedModels()).resolves.toEqual([
      expect.objectContaining({
        id: `off-grid/mobile-vision/${visionManifest.files[0].name}`,
        name: 'Mobile Vision',
        engine: 'llama',
        isVisionModel: true,
        mmProjFileName: projectorHere,
        mmProjPath: `${modelsDirectory}/${projectorHere}`,
      }),
    ]);

    const whisper = Buffer.alloc(10 * 1024 * 1024 + 4, 0x44);
    const whisperManifest: TransferredModelManifest = {
      id: 'ggerganov/whisper.cpp/base.en',
      name: 'Whisper Base English',
      kind: 'transcription',
      source: 'catalog',
      files: [
        {
          name: 'ggml-base.en.bin',
          sizeBytes: whisper.length,
          role: 'primary',
        },
      ],
    };
    await transfers.sendFile(
      mobile.id,
      packageSource(
        whisper,
        packageMetadata('whisper-package', whisperManifest, 0),
      ),
    );
    await expect(whisperService.listDownloadedModels()).resolves.toEqual([
      expect.objectContaining({
        modelId: 'base.en',
        fileName: 'ggml-base.en.bin',
        sizeBytes: whisper.length,
      }),
    ]);
    expect(useWhisperStore.getState().presentModelIds).toContain('base.en');

    const imageArchive = Buffer.alloc(48 * 1024, 0x49);
    imageArchive.write('PK\u0003\u0004', 0, 'binary');
    const coreMLManifest = transferredImageManifest(
      {
        id: 'mobile-coreml-image',
        name: 'Mobile Core ML Image',
        description: 'A received Core ML image model',
        modelPath: '/sender/image_models/mobile-coreml-image',
        downloadedAt: '2026-08-20T00:00:00.000Z',
        size: 128 * 1024,
        backend: 'coreml',
        attentionVariant: 'split_einsum',
      },
      'ios',
      imageArchive.length,
    );
    await transfers.sendFile(
      mobile.id,
      packageSource(
        imageArchive,
        packageMetadata('coreml-image-package', coreMLManifest, 0),
      ),
    );
    const imageRoot = `${modelManager.getImageModelsDirectory()}/mobile-coreml-image`;
    await expect(modelManager.getDownloadedImageModels()).resolves.toEqual([
      expect.objectContaining({
        id: 'mobile-coreml-image',
        name: 'Mobile Core ML Image',
        backend: 'coreml',
        modelPath: imageRoot,
        attentionVariant: 'split_einsum',
      }),
    ]);
    expect(useAppStore.getState().downloadedImageModels).toEqual([
      expect.objectContaining({ id: 'mobile-coreml-image' }),
    ]);
    await expect(
      modelTransferFsBoundary.exists(`${imageRoot}/Unet.mlmodelc`),
    ).resolves.toBe(true);
    await expect(
      modelTransferFsBoundary.exists(
        `${modelManager.getImageModelsDirectory()}/.sync-install-${
          coreMLManifest.files[0].name
        }`,
      ),
    ).resolves.toBe(false);

    const lowSpaceManifest = transferredImageManifest(
      {
        id: 'too-large-coreml-image',
        name: 'Too Large Core ML Image',
        description: '',
        modelPath: '/sender/image_models/too-large-coreml-image',
        downloadedAt: '2026-08-20T00:00:00.000Z',
        size: 8_000_000_000,
        backend: 'coreml',
      },
      'ios',
      imageArchive.length,
    );
    modelTransferFsBoundary.module.getFSInfo.mockResolvedValueOnce({
      freeSpace: 2_000_000_000,
      totalSpace: 128_000_000_000,
    });
    await expect(
      transfers.sendFile(
        mobile.id,
        packageSource(
          imageArchive,
          packageMetadata('low-space-image-package', lowSpaceManifest, 0),
        ),
      ),
    ).rejects.toThrow('not enough storage to receive and install');
    await expect(
      modelTransferFsBoundary.exists(
        `${modelManager.getImageModelsDirectory()}/too-large-coreml-image`,
      ),
    ).resolves.toBe(false);

    const incompleteManifest = transferredImageManifest(
      {
        id: 'incomplete-coreml-image',
        name: 'Incomplete Core ML Image',
        description: '',
        modelPath: '/sender/image_models/incomplete-coreml-image',
        downloadedAt: '2026-08-20T00:00:00.000Z',
        size: 128 * 1024,
        backend: 'coreml',
      },
      'ios',
      imageArchive.length,
    );
    (unzip as jest.Mock).mockImplementationOnce(
      async (_archive: string, target: string) => {
        for (const component of [
          'TextEncoder.mlmodelc',
          'VAEDecoder.mlmodelc',
          'Unet.mlmodelc',
        ]) {
          modelTransferFsBoundary.seedDir(`${target}/${component}`);
        }
        modelTransferFsBoundary.seedTextFile(`${target}/merges.txt`, 'merge');
        return target;
      },
    );
    await expect(
      transfers.sendFile(
        mobile.id,
        packageSource(
          imageArchive,
          packageMetadata('incomplete-image-package', incompleteManifest, 0),
        ),
      ),
    ).rejects.toThrow('missing vocab.json');
    await expect(
      modelTransferFsBoundary.exists(
        `${modelManager.getImageModelsDirectory()}/incomplete-coreml-image`,
      ),
    ).resolves.toBe(false);

    const imageManifest: TransferredModelManifest = {
      id: 'off-grid/mobile-image',
      name: 'Mobile Image',
      kind: 'image',
      source: 'downloaded',
      // A sender states where a non-portable model came from, which is what makes the refusal
      // specific instead of "one of you did not say".
      platform: 'macos',
      files: [
        {
          name: 'mobile-image.gguf',
          sizeBytes: primary.length,
          role: 'primary',
        },
      ],
    };
    await expect(
      transfers.sendFile(
        mobile.id,
        packageSource(
          primary,
          packageMetadata('image-package', imageManifest, 0),
        ),
      ),
    ).rejects.toThrow(
      'this model runs only on Mac, so it cannot be sent to iPhone or iPad',
    );

    const parakeet = Buffer.alloc(4096, 0x50);
    const parakeetManifest: TransferredModelManifest = {
      id: 'nvidia/parakeet',
      name: 'Parakeet',
      // A sender states where a non-portable model came from. Parakeet transcription exists only on the
      // Mac, so a phone is told which device it belongs to rather than a vague "one of you did not say".
      platform: 'macos',
      kind: 'transcription',
      source: 'catalog',
      files: [
        {
          name: 'parakeet-encoder.onnx',
          sizeBytes: parakeet.length,
          role: 'primary',
        },
      ],
    };
    await expect(
      transfers.sendFile(
        mobile.id,
        packageSource(
          parakeet,
          packageMetadata('parakeet-package', parakeetManifest, 0),
        ),
      ),
    ).rejects.toThrow(
      'this model runs only on Mac, so it cannot be sent to iPhone or iPad',
    );
  }, 30_000);

  it('stages image archives natively and removes them after a failed send', async () => {
    await connectDesktop();
    const modelRoot = `${modelManager.getImageModelsDirectory()}/sendable-coreml`;
    modelTransferFsBoundary.seedDir(modelRoot);
    for (const component of [
      'TextEncoder.mlmodelc',
      'VAEDecoder.mlmodelc',
      'Unet.mlmodelc',
    ]) {
      modelTransferFsBoundary.seedDir(`${modelRoot}/${component}`);
    }
    modelTransferFsBoundary.seedTextFile(`${modelRoot}/merges.txt`, 'merge');
    modelTransferFsBoundary.seedTextFile(
      `${modelRoot}/vocab.json`,
      '{"token":1}',
    );
    await modelManager.addDownloadedImageModel({
      id: 'sendable-coreml',
      name: 'Sendable Core ML',
      description: '',
      modelPath: modelRoot,
      downloadedAt: '2026-08-20T00:00:00.000Z',
      size: 64 * 1024,
      backend: 'coreml',
    });

    (zip as jest.Mock).mockImplementation(
      async (source: string, target: string, compression: number) => {
        expect(source).toBe(modelRoot);
        expect(compression).toBe(NO_COMPRESSION);
        await modelTransferFsBoundary.module.writeFile(
          target,
          Buffer.from('PK\u0003\u0004native archive').toString('base64'),
          'base64',
        );
        return target;
      },
    );
    const jsReadsBefore = modelTransferFsBoundary.module.read.mock.calls.length;

    modelTransferFsBoundary.module.getFSInfo.mockResolvedValueOnce({
      freeSpace: 1_000_000,
      totalSpace: 128_000_000_000,
    });
    await expect(
      modelTransferService.sendModel(
        'desktop-package-source',
        'image:sendable-coreml',
        'ios',
      ),
    ).rejects.toThrow('not enough storage to prepare this image model');
    expect(zip).not.toHaveBeenCalled();

    // The stand-in peer has no model sink. The send fails after staging, which exercises the same
    // finally-cleanup used when a person cancels an active transfer.
    await expect(
      modelTransferService.sendModel(
        'desktop-package-source',
        'image:sendable-coreml',
        'ios',
      ),
    ).rejects.toThrow();
    expect(modelTransferFsBoundary.module.read.mock.calls.length).toBe(
      jsReadsBefore,
    );
    await expect(
      modelTransferFsBoundary.module.readDir(
        `${modelTransferFsBoundary.module.CachesDirectoryPath}/model-transfer-staging`,
      ),
    ).resolves.toEqual([]);
  }, 30_000);
});
