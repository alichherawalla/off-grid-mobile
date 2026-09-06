import type { PersistedModelDownload } from '@offgrid/models';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { installNativeBoundary } from '../../harness/nativeBoundary';

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

const record = (
  model: 'tiny.en' | 'base.en',
  options: {
    phase?: PersistedModelDownload['phase'];
    transferId?: string;
    updatedAt?: number;
  } = {},
): PersistedModelDownload => {
  const fileName = `ggml-${model}.bin`;
  return {
    manifest: {
      id: `whisper-${model}/${fileName}`,
      modelId: model,
      kind: 'transcription',
      revision: 'main',
      artifacts: [
        {
          id: 'primary',
          name: fileName,
          role: 'primary',
          required: true,
          localName: fileName,
          url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${fileName}`,
          sizeBytes: 100,
        },
      ],
    },
    phase: options.phase ?? 'downloading',
    artifacts: [
      {
        artifactId: 'primary',
        phase: options.phase ?? 'downloading',
        ...(options.transferId ? { transferId: options.transferId } : {}),
        bytesDownloaded: 50,
        totalBytes: 100,
      },
    ],
    createdAt: 1,
    updatedAt: options.updatedAt ?? 1,
    attempt: options.updatedAt ?? 1,
  };
};

async function start(
  records: readonly PersistedModelDownload[],
): Promise<void> {
  const { seedMobileDownloadJournal, startMobileApplicationFixture } =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  await seedMobileDownloadJournal(records);
  fixture = await startMobileApplicationFixture();
  await fixture.refreshModels();
}

const downloads = () =>
  fixture!.application.models.snapshot().control.downloads;

describe('Shared Whisper download ownership', () => {
  it('cancels one transcription download without disturbing another', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'tiny-native',
      modelId: 'tiny.en',
      fileName: 'ggml-tiny.en.bin',
      modelType: 'stt',
      status: 'running',
      bytesDownloaded: 50,
      totalBytes: 100,
    });
    boundary.download!.seedActive({
      downloadId: 'base-native',
      modelId: 'base.en',
      fileName: 'ggml-base.en.bin',
      modelType: 'stt',
      status: 'running',
      bytesDownloaded: 50,
      totalBytes: 100,
    });
    await start([
      record('tiny.en', { transferId: 'tiny-native' }),
      record('base.en', { transferId: 'base-native' }),
    ]);

    const outcome = await fixture!.application.models.cancelDownload({
      downloadId: 'whisper-tiny.en/ggml-tiny.en.bin',
    });

    expect(outcome).toEqual(expect.objectContaining({ ok: true, value: true }));
    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(
      'tiny-native',
      false,
    );
    expect(boundary.download!.module.stopDownload).not.toHaveBeenCalledWith(
      'base-native',
      false,
    );
    expect(boundary.download!.active().map(row => row.downloadId)).toEqual([
      'base-native',
    ]);
  });

  it('removes an installed transcription model without cancelling another model download', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'base-native',
      modelId: 'base.en',
      fileName: 'ggml-base.en.bin',
      modelType: 'stt',
      status: 'running',
      bytesDownloaded: 50,
      totalBytes: 100,
    });
    boundary.fs!.seedFile('/docs/whisper-models/ggml-small.en.bin', 100);
    await start([record('base.en', { transferId: 'base-native' })]);

    const outcome = await fixture!.application.models.remove('small.en');

    expect(outcome).toEqual(expect.objectContaining({ ok: true }));
    expect(boundary.download!.module.stopDownload).not.toHaveBeenCalledWith(
      'base-native',
      false,
    );
    expect(boundary.download!.active().map(row => row.downloadId)).toEqual([
      'base-native',
    ]);
  });

  it('keeps only the newest same-model durable owner', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'new-native',
      modelId: 'tiny.en',
      fileName: 'ggml-tiny.en.bin',
      modelType: 'stt',
      status: 'running',
      bytesDownloaded: 50,
      totalBytes: 100,
    });
    await start([
      record('tiny.en', { phase: 'failed', updatedAt: 1 }),
      record('tiny.en', { transferId: 'new-native', updatedAt: 2 }),
    ]);
    expect(downloads()).toHaveLength(1);
    expect(downloads()[0]).toEqual(
      expect.objectContaining({ modelId: 'tiny.en', status: 'downloading' }),
    );
  });

  it('cancels queued work by its exact logical download id', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    await start([record('tiny.en', { phase: 'queued' })]);

    const outcome = await fixture!.application.models.cancelDownload({
      downloadId: 'whisper-tiny.en/ggml-tiny.en.bin',
    });

    expect(outcome).toEqual(expect.objectContaining({ ok: true, value: true }));
    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(
      'dl-1',
      false,
    );
    expect(downloads()).toEqual([
      expect.objectContaining({ modelId: 'tiny.en', status: 'cancelled' }),
    ]);
  });

  it('does not let an older native failure replace the current owner', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'old-native',
      modelId: 'tiny.en',
      fileName: 'ggml-tiny.en.bin',
      modelType: 'stt',
      status: 'running',
      bytesDownloaded: 10,
      totalBytes: 100,
    });
    boundary.download!.seedActive({
      downloadId: 'new-native',
      modelId: 'tiny.en',
      fileName: 'ggml-tiny.en.bin',
      modelType: 'stt',
      status: 'running',
      bytesDownloaded: 50,
      totalBytes: 100,
    });
    await start([
      record('tiny.en', { transferId: 'new-native', updatedAt: 2 }),
    ]);

    boundary.download!.events.emit('DownloadError', {
      downloadId: 'old-native',
      reason: 'old owner failed',
    });
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(downloads()).toEqual([
      expect.objectContaining({ modelId: 'tiny.en', status: 'downloading' }),
    ]);
  });

  it('keeps replacement ownership when a stale completion arrives', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'new-native',
      modelId: 'tiny.en',
      fileName: 'ggml-tiny.en.bin',
      modelType: 'stt',
      status: 'running',
      bytesDownloaded: 50,
      totalBytes: 100,
    });
    await start([
      record('tiny.en', { transferId: 'new-native', updatedAt: 2 }),
    ]);

    boundary.download!.events.emit('DownloadComplete', {
      downloadId: 'old-native',
    });
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(downloads()).toEqual([
      expect.objectContaining({ modelId: 'tiny.en', status: 'downloading' }),
    ]);
    expect(boundary.download!.active().map(row => row.downloadId)).toEqual([
      'new-native',
    ]);
  });

  it('projects the current owner failure as retriable without erasing its identity', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'current-native',
      modelId: 'tiny.en',
      fileName: 'ggml-tiny.en.bin',
      modelType: 'stt',
      status: 'running',
      bytesDownloaded: 50,
      totalBytes: 100,
    });
    await start([record('tiny.en', { transferId: 'current-native' })]);

    boundary.download!.events.emit('DownloadError', {
      downloadId: 'current-native',
      reason: 'Current download failed',
    });
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(downloads()).toEqual([
      expect.objectContaining({
        modelId: 'tiny.en',
        status: 'failed',
        reason: 'Current download failed',
      }),
    ]);
  });
});
