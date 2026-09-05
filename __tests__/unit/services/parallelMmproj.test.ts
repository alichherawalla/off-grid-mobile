import type {PersistedModelDownload} from '@offgrid/models';
import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';
import {installNativeBoundary} from '../../harness/nativeBoundary';

const MODEL_ID = 'owner/model';
const DOWNLOAD_ID = `${MODEL_ID}/model-Q4.gguf`;
const PRIMARY_TRANSFER = 'native-primary';
const PROJECTOR_TRANSFER = 'native-projector';

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

function record(): PersistedModelDownload {
  return {
    manifest: {
      id: DOWNLOAD_ID,
      modelId: MODEL_ID,
      kind: 'text',
      revision: 'main',
      artifacts: [
        {
          id: 'primary', name: 'model-Q4.gguf', role: 'primary', required: true,
          localName: 'model-Q4.gguf', url: 'https://example.com/model-Q4.gguf', sizeBytes: 1_024,
        },
        {
          id: 'projector', name: 'mmproj-F16.gguf', role: 'mmproj', required: true,
          localName: 'model-mmproj-F16.gguf', url: 'https://example.com/mmproj-F16.gguf', sizeBytes: 1_024,
        },
      ],
    },
    phase: 'downloading',
    artifacts: [
      {
        artifactId: 'primary', phase: 'downloading', transferId: PRIMARY_TRANSFER,
        bytesDownloaded: 256, totalBytes: 1_024,
      },
      {
        artifactId: 'projector', phase: 'downloading', transferId: PROJECTOR_TRANSFER,
        bytesDownloaded: 512, totalBytes: 1_024,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    attempt: 1,
  };
}

function seedTransfers(boundary: ReturnType<typeof installNativeBoundary>): void {
  boundary.download!.seedActive({
    downloadId: PRIMARY_TRANSFER,
    modelId: MODEL_ID,
    fileName: 'model-Q4.gguf',
    modelType: 'text',
    status: 'running',
    bytesDownloaded: 256,
    totalBytes: 1_024,
  });
  boundary.download!.seedActive({
    downloadId: PROJECTOR_TRANSFER,
    modelId: MODEL_ID,
    fileName: 'mmproj-F16.gguf',
    modelType: 'text',
    status: 'running',
    bytesDownloaded: 512,
    totalBytes: 1_024,
  });
}

async function start(): Promise<void> {
  const {seedMobileDownloadJournal, startMobileApplicationFixture} =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  await seedMobileDownloadJournal([record()]);
  fixture = await startMobileApplicationFixture();
  await fixture.refreshModels();
}

function projected() {
  const {useDownloadStore} = require('../../../src/stores/downloadStore') as typeof import('../../../src/stores/downloadStore');
  return Object.values(useDownloadStore.getState().downloads);
}

describe('Shared parallel projector download ownership', () => {
  it('folds the primary model and projector into one aggregate Mobile projection', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    seedTransfers(boundary);
    await start();
    expect(projected()).toEqual([expect.objectContaining({
      downloadId: DOWNLOAD_ID,
      modelId: MODEL_ID,
      fileName: 'model-Q4.gguf',
      modelType: 'text',
      bytesDownloaded: 768,
      totalBytes: 2_048,
      progress: 0.375,
      status: 'downloading',
    })]);
  });

  it('reactively updates the active artifact while retaining projector progress', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    seedTransfers(boundary);
    await start();
    boundary.download!.events.emit('DownloadProgress', {
      downloadId: PRIMARY_TRANSFER, bytesDownloaded: 1_024, totalBytes: 1_024,
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(projected()).toEqual([expect.objectContaining({
      bytesDownloaded: 1_536,
      totalBytes: 2_048,
      progress: 0.75,
    })]);
  });

  it('cancels both native artifacts through one public Shared command', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    seedTransfers(boundary);
    await start();
    const outcome = await fixture!.application.models.cancelDownload({downloadId: DOWNLOAD_ID});
    expect(outcome).toEqual(expect.objectContaining({ok: true, value: true}));
    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(PRIMARY_TRANSFER, false);
    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(PROJECTOR_TRANSFER, false);
    expect(projected()).toEqual([expect.objectContaining({status: 'cancelled'})]);
  });
});
