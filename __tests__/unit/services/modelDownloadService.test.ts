import type { ModelKind, PersistedModelDownload } from '@offgrid/models';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { installNativeBoundary } from '../../harness/nativeBoundary';

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

const record = (
  id: string,
  fileName: string,
  kind: ModelKind = 'text',
  options: {
    phase?: PersistedModelDownload['phase'];
    transferId?: string;
    updatedAt?: number;
  } = {},
): PersistedModelDownload => ({
  manifest: {
    id,
    modelId: id,
    kind,
    revision: 'main',
    artifacts: [
      {
        id: 'primary',
        name: fileName,
        role: 'primary',
        required: true,
        localName: fileName,
        url: `https://example.test/${fileName}`,
      },
    ],
  },
  phase: options.phase ?? 'downloading',
  artifacts: [
    {
      artifactId: 'primary',
      phase: options.phase ?? 'downloading',
      ...(options.transferId ? { transferId: options.transferId } : {}),
      bytesDownloaded: 25,
      totalBytes: 100,
    },
  ],
  createdAt: 1,
  updatedAt: options.updatedAt ?? 1,
  attempt: options.updatedAt ?? 1,
});

async function start(
  records: readonly PersistedModelDownload[],
): Promise<void> {
  const { seedMobileDownloadJournal, startMobileApplicationFixture } =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  await seedMobileDownloadJournal(records);
  fixture = await startMobileApplicationFixture();
  await fixture.refreshModels();
}

const rows = () => fixture!.application.models.snapshot().control.downloads;

describe('public Shared model-download owner', () => {
  it('merges durable downloads across model kinds', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'text-transfer',
      modelId: 'text:a',
      fileName: 'a.gguf',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 25,
      totalBytes: 100,
    });
    boundary.download!.seedActive({
      downloadId: 'stt-transfer',
      modelId: 'stt:b',
      fileName: 'b.bin',
      modelType: 'stt',
      status: 'running',
      bytesDownloaded: 25,
      totalBytes: 100,
    });
    await start([
      record('text:a', 'a.gguf', 'text', { transferId: 'text-transfer' }),
      record('stt:b', 'b.bin', 'transcription', { transferId: 'stt-transfer' }),
    ]);
    expect(
      rows()
        .map(item => item.modelId)
        .sort(),
    ).toEqual(['stt:b', 'text:a']);
  });

  it('cancels the exact Shared-owned transfer and removes the native task', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'native-a',
      modelId: 'm/a',
      fileName: 'a.gguf',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 25,
      totalBytes: 100,
    });
    await start([
      record('m/a/a.gguf', 'a.gguf', 'text', { transferId: 'native-a' }),
    ]);
    const outcome = await fixture!.application.models.cancelDownload({
      downloadId: rows()[0].downloadId,
    });
    expect(outcome).toEqual(expect.objectContaining({ ok: true, value: true }));
    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(
      'native-a',
      false,
    );
    expect(boundary.download!.active()).toEqual([]);
  });

  it('does not confuse a bare repository id with a file-specific download id', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'native-a',
      modelId: 'm/a',
      fileName: 'a.gguf',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 25,
      totalBytes: 100,
    });
    await start([
      record('m/a/a.gguf', 'a.gguf', 'text', { transferId: 'native-a' }),
    ]);
    const outcome = await fixture!.application.models.cancelDownload({
      downloadId: 'm/a',
    });
    expect(outcome).toEqual(
      expect.objectContaining({ ok: true, value: false }),
    );
    expect(boundary.download!.module.stopDownload).not.toHaveBeenCalled();
    expect(boundary.download!.active()).toHaveLength(1);
  });

  it('refuses retry when no durable download owns the id', async () => {
    installNativeBoundary({ download: true, fs: true });
    await start([]);
    await expect(
      fixture!.application.models.retryDownload({
        downloadId: 'image:unknown',
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: false }));
  });

  it('retains an interrupted record when its native transfer is gone', async () => {
    installNativeBoundary({
      download: true,
      fs: true,
      ram: {
        platform: 'ios',
        totalBytes: 8 * 1024 ** 3,
        availBytes: 4 * 1024 ** 3,
      },
    });
    await start([
      record('stt:base', 'base.bin', 'transcription', {
        transferId: 'missing-native',
      }),
    ]);
    expect(rows()).toEqual([
      expect.objectContaining({ modelId: 'stt:base', status: 'interrupted' }),
    ]);
  });

  it('keeps the newest durable attempt for one logical model', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'new-native',
      modelId: 'text:a',
      fileName: 'a.gguf',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 25,
      totalBytes: 100,
    });
    await start([
      record('text:a', 'a.gguf', 'text', { phase: 'failed', updatedAt: 1 }),
      record('text:a', 'a.gguf', 'text', {
        transferId: 'new-native',
        updatedAt: 2,
      }),
    ]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toEqual(
      expect.objectContaining({ modelId: 'text:a', status: 'downloading' }),
    );
  });

  it('publishes lifecycle changes to application subscribers', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'native-a',
      modelId: 'text:a',
      fileName: 'a.gguf',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 25,
      totalBytes: 100,
    });
    await start([
      record('text:a', 'a.gguf', 'text', { transferId: 'native-a' }),
    ]);
    const listener = jest.fn();
    const unsubscribe = fixture!.application.models.subscribe(listener);
    await fixture!.application.models.cancelDownload({
      downloadId: rows()[0].downloadId,
    });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});
