import type {PersistedModelDownload} from '@offgrid/models';
import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';
import {installNativeBoundary} from '../../harness/nativeBoundary';

const MODEL_ID = 'whisper-base.en';
const FILE_NAME = 'ggml-base.en.bin';
const DOWNLOAD_ID = 'whisper-base.en/ggml-base.en.bin';
const TRANSFER_ID = 'native-stt';

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

const record = (
  phase: PersistedModelDownload['phase'] = 'downloading',
  options: {transferId?: string; bytes?: number; updatedAt?: number} = {},
): PersistedModelDownload => ({
  manifest: {
    id: DOWNLOAD_ID,
    modelId: MODEL_ID,
    kind: 'transcription',
    revision: 'main',
    artifacts: [{
      id: 'primary',
      name: FILE_NAME,
      role: 'primary',
      required: true,
      localName: FILE_NAME,
      url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${FILE_NAME}`,
      sizeBytes: 100,
    }],
  },
  phase,
  artifacts: [{
    artifactId: 'primary',
    phase,
    ...(options.transferId ? {transferId: options.transferId} : {}),
    bytesDownloaded: options.bytes ?? 50,
    totalBytes: 100,
  }],
  createdAt: 1,
  updatedAt: options.updatedAt ?? 1,
  attempt: options.updatedAt ?? 1,
});

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

describe('Shared transcription download lifecycle', () => {
  it('reactively projects an active transcription download with determinate progress', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    boundary.download!.seedActive({downloadId: TRANSFER_ID, modelId: MODEL_ID, fileName: FILE_NAME, modelType: 'stt', status: 'running', bytesDownloaded: 50, totalBytes: 100});
    await start([record('downloading', {transferId: TRANSFER_ID})]);
    expect(projected()).toEqual([expect.objectContaining({
      modelId: MODEL_ID,
      modelType: 'stt',
      status: 'downloading',
      progress: 0.5,
    })]);
  });

  it('keeps one projection for the newest durable attempt', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    boundary.download!.seedActive({downloadId: TRANSFER_ID, modelId: MODEL_ID, fileName: FILE_NAME, modelType: 'stt', status: 'running', bytesDownloaded: 70, totalBytes: 100});
    await start([
      record('failed', {bytes: 10, updatedAt: 1}),
      record('downloading', {transferId: TRANSFER_ID, bytes: 70, updatedAt: 2}),
    ]);
    expect(projected()).toHaveLength(1);
    expect(projected()[0]).toEqual(expect.objectContaining({modelId: MODEL_ID, status: 'downloading'}));
  });

  it('cancels the native transcription transfer and keeps a clearable cancelled projection', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    boundary.download!.seedActive({downloadId: TRANSFER_ID, modelId: MODEL_ID, fileName: FILE_NAME, modelType: 'stt', status: 'running', bytesDownloaded: 50, totalBytes: 100});
    await start([record('downloading', {transferId: TRANSFER_ID})]);
    const outcome = await fixture!.application.models.cancelDownload({downloadId: DOWNLOAD_ID});
    expect(outcome).toEqual(expect.objectContaining({ok: true, value: true}));
    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(TRANSFER_ID, false);
    expect(projected()).toEqual([expect.objectContaining({modelId: MODEL_ID, status: 'cancelled'})]);
  });

  it('retries a failed transcription download through the native transfer port', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    await start([record('failed')]);
    const outcome = await fixture!.application.models.retryDownload({downloadId: DOWNLOAD_ID});
    expect(outcome).toEqual(expect.objectContaining({ok: true}));
    expect(boundary.download!.module.startDownload).toHaveBeenCalledTimes(1);
    expect(projected()).toEqual([expect.objectContaining({modelId: MODEL_ID, status: 'downloading'})]);
  });

  it('restores a retriable failure when the retry transfer errors', async () => {
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

  it('removes a failed transcription download from durable and reactive state', async () => {
    installNativeBoundary({download: true, fs: true});
    await start([record('failed')]);
    const outcome = await fixture!.application.models.removeDownload({downloadId: DOWNLOAD_ID});
    expect(outcome).toEqual(expect.objectContaining({ok: true, value: true}));
    expect(projected()).toEqual([]);
  });

  it('retains a missing native transcription transfer as interrupted and retriable', async () => {
    installNativeBoundary({download: true, fs: true, ram: {platform: 'ios', totalBytes: 8 * 1024 ** 3, availBytes: 4 * 1024 ** 3}});
    await start([record('downloading', {transferId: TRANSFER_ID})]);
    expect(projected()).toEqual([expect.objectContaining({modelId: MODEL_ID, status: 'interrupted'})]);
  });
});
