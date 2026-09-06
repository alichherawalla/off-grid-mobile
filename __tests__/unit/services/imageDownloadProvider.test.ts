/**
 * Shared image download lifecycle as projected on Mobile. Mirrors sttDownloadProvider.test.ts:
 * the durable journal is seeded at the native boundary, the REAL Mobile composition root runs,
 * commands go through the public Shared facade, and the assertion lands on the reactive projection
 * (Shared `models.watch` -> Mobile downloadStore). Multi-file (huggingface) image downloads are the
 * interesting case: two artifacts, one aggregated projection.
 */
import type {PersistedModelDownload} from '@offgrid/models';
import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';
import {installNativeBoundary} from '../../harness/nativeBoundary';

const MODEL_ID = 'image:sdxl';
const REPO = 'acme/sdxl-mobile';
const PRIMARY_FILE = 'unet.bin';
const AUX_FILE = 'vae.bin';
const DOWNLOAD_ID = `${MODEL_ID}/${PRIMARY_FILE}`;
const PRIMARY_TRANSFER = 'native-image-primary';
const AUX_TRANSFER = 'native-image-aux';
const IMAGE_METADATA = {
  imageDownloadType: 'multifile',
  imageModelName: 'SDXL Mobile',
  imageModelDescription: 'Two-file diffusion model',
  imageModelSize: 200,
  imageModelRepo: REPO,
  imageModelHuggingFaceFiles: [
    {path: PRIMARY_FILE, size: 100, relativePath: PRIMARY_FILE},
    {path: AUX_FILE, size: 100, relativePath: AUX_FILE},
  ],
};

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

interface ArtifactSeed {
  transferId?: string;
  bytes?: number;
  phase?: PersistedModelDownload['phase'];
}

const record = (
  phase: PersistedModelDownload['phase'] = 'downloading',
  options: {primary?: ArtifactSeed; aux?: ArtifactSeed; updatedAt?: number} = {},
): PersistedModelDownload => {
  const artifact = (id: string, seed: ArtifactSeed = {}) => ({
    artifactId: id,
    phase: seed.phase ?? phase,
    ...(seed.transferId ? {transferId: seed.transferId} : {}),
    bytesDownloaded: seed.bytes ?? 50,
    totalBytes: 100,
  });
  return {
    manifest: {
      id: DOWNLOAD_ID,
      modelId: MODEL_ID,
      kind: 'image',
      revision: 'main',
      artifacts: [
        {id: 'primary', name: PRIMARY_FILE, role: 'primary', required: true, localName: PRIMARY_FILE,
          url: `https://huggingface.co/${REPO}/resolve/main/${PRIMARY_FILE}`, sizeBytes: 100},
        {id: 'aux', name: AUX_FILE, role: 'aux', required: true, localName: AUX_FILE,
          url: `https://huggingface.co/${REPO}/resolve/main/${AUX_FILE}`, sizeBytes: 100},
      ],
      // The catalog facts a real image download journals; retry rebuilds its request from them.
      metadata: {displayName: 'SDXL Mobile', catalogEntry: true, publicMetadataJson: JSON.stringify(IMAGE_METADATA)},
    },
    phase,
    artifacts: [artifact('primary', options.primary), artifact('aux', options.aux)],
    createdAt: 1,
    updatedAt: options.updatedAt ?? 1,
    attempt: options.updatedAt ?? 1,
  };
};

async function start(records: readonly PersistedModelDownload[]): Promise<void> {
  const {seedMobileDownloadJournal, startMobileApplicationFixture} =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  await seedMobileDownloadJournal(records);
  fixture = await startMobileApplicationFixture();
  await fixture.refreshModels();
}

function projected() {
  const {useDownloadStore} = require('../../../src/stores/downloadStore') as typeof import('../../../src/stores/downloadStore');
  return Object.values(useDownloadStore.getState().downloads);
}

function seedBothTransfers(boundary: ReturnType<typeof installNativeBoundary>, bytes: {primary: number; aux: number}) {
  boundary.download!.seedActive({downloadId: PRIMARY_TRANSFER, modelId: MODEL_ID, fileName: PRIMARY_FILE, modelType: 'image', status: 'running', bytesDownloaded: bytes.primary, totalBytes: 100});
  boundary.download!.seedActive({downloadId: AUX_TRANSFER, modelId: MODEL_ID, fileName: AUX_FILE, modelType: 'image', status: 'running', bytesDownloaded: bytes.aux, totalBytes: 100});
}

describe('Shared image download lifecycle', () => {
  it('reactively projects one multi-file image download with aggregated determinate progress', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    seedBothTransfers(boundary, {primary: 100, aux: 20});
    await start([record('downloading', {
      primary: {transferId: PRIMARY_TRANSFER, bytes: 100, phase: 'completed'},
      aux: {transferId: AUX_TRANSFER, bytes: 20},
    })]);
    expect(projected()).toEqual([expect.objectContaining({
      modelId: MODEL_ID,
      modelType: 'image',
      status: 'downloading',
      bytesDownloaded: 120,
      totalBytes: 200,
      progress: 0.6,
    })]);
  });

  it('keeps one projection for the newest durable attempt', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    seedBothTransfers(boundary, {primary: 70, aux: 0});
    await start([
      record('failed', {primary: {bytes: 10}, aux: {bytes: 0}, updatedAt: 1}),
      record('downloading', {primary: {transferId: PRIMARY_TRANSFER, bytes: 70}, aux: {transferId: AUX_TRANSFER, bytes: 0}, updatedAt: 2}),
    ]);
    expect(projected()).toHaveLength(1);
    expect(projected()[0]).toEqual(expect.objectContaining({modelId: MODEL_ID, status: 'downloading'}));
  });

  it('cancels every native transfer of the image download and keeps a clearable cancelled projection', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    seedBothTransfers(boundary, {primary: 50, aux: 50});
    await start([record('downloading', {primary: {transferId: PRIMARY_TRANSFER}, aux: {transferId: AUX_TRANSFER}})]);
    const outcome = await fixture!.application.models.cancelDownload({downloadId: DOWNLOAD_ID});
    expect(outcome).toEqual(expect.objectContaining({ok: true, value: true}));
    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(PRIMARY_TRANSFER, false);
    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(AUX_TRANSFER, false);
    expect(projected()).toEqual([expect.objectContaining({modelId: MODEL_ID, status: 'cancelled'})]);
  });

  it('retries a failed image download through the native transfer port', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    await start([record('failed')]);
    const outcome = await fixture!.application.models.retryDownload({downloadId: DOWNLOAD_ID});
    expect(outcome).toEqual(expect.objectContaining({ok: true}));
    expect(boundary.download!.module.startDownload).toHaveBeenCalled();
    expect(projected()).toEqual([expect.objectContaining({modelId: MODEL_ID, modelType: 'image', status: 'downloading'})]);
  });

  it('restores a retriable failure when a retry transfer errors', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    await start([record('failed')]);
    await fixture!.application.models.retryDownload({downloadId: DOWNLOAD_ID});
    const transferId = boundary.download!.active()[0].downloadId;
    boundary.download!.events.emit('DownloadError', {downloadId: transferId, reason: 'network down'});
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(projected()).toEqual([expect.objectContaining({
      modelId: MODEL_ID,
      status: 'failed',
      errorMessage: 'network down',
    })]);
  });

  it('removes a failed image download from durable and reactive state', async () => {
    installNativeBoundary({download: true, fs: true});
    await start([record('failed')]);
    const outcome = await fixture!.application.models.removeDownload({downloadId: DOWNLOAD_ID});
    expect(outcome).toEqual(expect.objectContaining({ok: true, value: true}));
    expect(projected()).toEqual([]);
  });

  it('retains an image download whose native transfers vanished as interrupted and retriable', async () => {
    installNativeBoundary({download: true, fs: true, ram: {platform: 'ios', totalBytes: 8 * 1024 ** 3, availBytes: 4 * 1024 ** 3}});
    await start([record('downloading', {primary: {transferId: PRIMARY_TRANSFER}, aux: {transferId: AUX_TRANSFER}})]);
    expect(projected()).toEqual([expect.objectContaining({modelId: MODEL_ID, modelType: 'image', status: 'interrupted'})]);
  });
});
