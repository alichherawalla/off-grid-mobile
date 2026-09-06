import type {PersistedModelDownload} from '@offgrid/models';
import type {MobileApplicationFixture} from '../../../../../harness/mobileApplicationFixture';
import {installNativeBoundary} from '../../../../../harness/nativeBoundary';

const MODEL_ID = 'image:recovery-model';
const DOWNLOAD_ID = `${MODEL_ID}/unet.bin`;
const PRIMARY_TRANSFER = 'native-recovery-primary';
const AUX_TRANSFER = 'native-recovery-aux';

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

function record(phase: PersistedModelDownload['phase']): PersistedModelDownload {
  const artifact = (id: string, fileName: string, transferId: string) => ({
    artifactId: id,
    phase,
    ...(phase === 'downloading' ? {transferId} : {}),
    bytesDownloaded: phase === 'failed' ? 0 : 50,
    totalBytes: 100,
  });
  return {
    manifest: {
      id: DOWNLOAD_ID,
      modelId: MODEL_ID,
      kind: 'image',
      revision: 'main',
      artifacts: [
        {
          id: 'primary', name: 'unet.bin', role: 'primary', required: true,
          localName: 'unet.bin', url: 'https://example.com/unet.bin', sizeBytes: 100,
        },
        {
          id: 'aux', name: 'vae.bin', role: 'aux', required: true,
          localName: 'vae.bin', url: 'https://example.com/vae.bin', sizeBytes: 100,
        },
      ],
      metadata: {
        displayName: 'Recovery model',
        catalogEntry: true,
        publicMetadataJson: JSON.stringify({
          imageDownloadType: 'multifile',
          imageModelName: 'Recovery model',
          imageModelDescription: 'A recovered multi-file image model',
          imageModelSize: 200,
          imageModelBackend: 'mnn',
          imageModelRepo: 'offgrid/recovery-model',
          imageModelHuggingFaceFiles: [
            {path: 'unet.bin', size: 100, relativePath: 'unet.bin'},
            {path: 'vae.bin', size: 100, relativePath: 'vae.bin'},
          ],
        }),
      },
    },
    phase,
    artifacts: [
      artifact('primary', 'unet.bin', PRIMARY_TRANSFER),
      artifact('aux', 'vae.bin', AUX_TRANSFER),
    ],
    createdAt: 1,
    updatedAt: 1,
    attempt: 1,
  };
}

async function start(records: readonly PersistedModelDownload[]): Promise<void> {
  const {seedMobileDownloadJournal, startMobileApplicationFixture} =
    require('../../../../../harness/mobileApplicationFixture') as typeof import('../../../../../harness/mobileApplicationFixture');
  await seedMobileDownloadJournal(records);
  fixture = await startMobileApplicationFixture();
  await fixture.refreshModels();
}

function projected() {
  const {useDownloadStore} = require('../../../../../../src/stores/downloadStore') as typeof import('../../../../../../src/stores/downloadStore');
  return Object.values(useDownloadStore.getState().downloads);
}

function seedTransfers(boundary: ReturnType<typeof installNativeBoundary>): void {
  boundary.download!.seedActive({
    downloadId: PRIMARY_TRANSFER, modelId: MODEL_ID, fileName: 'unet.bin', modelType: 'image',
    status: 'running', bytesDownloaded: 50, totalBytes: 100,
  });
  boundary.download!.seedActive({
    downloadId: AUX_TRANSFER, modelId: MODEL_ID, fileName: 'vae.bin', modelType: 'image',
    status: 'running', bytesDownloaded: 50, totalBytes: 100,
  });
}

describe('Shared image download recovery through Mobile composition', () => {
  it('projects no recovery work when the durable journal is empty', async () => {
    installNativeBoundary({download: true, fs: true});
    await start([]);
    expect(projected()).toEqual([]);
  });

  it('restores one aggregate projection for a multi-file image download', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    seedTransfers(boundary);
    await start([record('downloading')]);
    expect(projected()).toEqual([expect.objectContaining({
      downloadId: DOWNLOAD_ID,
      modelId: MODEL_ID,
      modelType: 'image',
      status: 'downloading',
      bytesDownloaded: 100,
      totalBytes: 200,
      progress: 0.5,
    })]);
  });

  it('cancels every recovered native artifact through the public Shared command', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    seedTransfers(boundary);
    await start([record('downloading')]);
    const outcome = await fixture!.application.models.cancelDownload({downloadId: DOWNLOAD_ID});
    expect(outcome).toEqual(expect.objectContaining({ok: true, value: true}));
    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(PRIMARY_TRANSFER, false);
    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(AUX_TRANSFER, false);
    expect(projected()).toEqual([expect.objectContaining({status: 'cancelled'})]);
  });

});
