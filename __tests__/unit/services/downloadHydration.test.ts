import { isMMProjFile, type PersistedModelDownload } from '@offgrid/models';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { installNativeBoundary, MB } from '../../harness/nativeBoundary';

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

const record = (
  id: string,
  fileName: string,
  phase: PersistedModelDownload['phase'] = 'downloading',
  bytesDownloaded = 500 * MB,
  totalBytes = 1000 * MB,
): PersistedModelDownload => ({
  manifest: {
    id,
    modelId: id,
    kind: 'text',
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
  phase,
  artifacts: [
    {
      artifactId: 'primary',
      phase,
      ...(phase === 'downloading' ? { transferId: `transfer-${id}` } : {}),
      bytesDownloaded,
      totalBytes,
    },
  ],
  createdAt: 1,
  updatedAt: 1,
  attempt: 1,
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

function downloads() {
  const { useDownloadStore } =
    require('../../../src/stores/downloadStore') as typeof import('../../../src/stores/downloadStore');
  return Object.values(useDownloadStore.getState().downloads);
}

describe('Shared projector policy', () => {
  it('recognises projector filenames', () => {
    expect(isMMProjFile('llava-v1.5-mmproj.gguf')).toBe(true);
    expect(isMMProjFile('model-projector.gguf')).toBe(true);
  });

  it('does not classify model weights as projectors', () => {
    expect(isMMProjFile('model-Q4_K_M.gguf')).toBe(false);
    expect(isMMProjFile('plain-model.gguf')).toBe(false);
  });
});

describe('public Shared download recovery and Mobile projection', () => {
  it('projects no downloads when the native service has no rows', async () => {
    installNativeBoundary({ download: true, fs: true });
    await start([]);
    expect(downloads()).toEqual([]);
  });

  it('projects an active text download with progress', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'transfer-author/model',
      modelId: 'author/model',
      fileName: 'model.gguf',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 500 * MB,
      totalBytes: 1000 * MB,
    });
    await start([record('author/model', 'model.gguf')]);
    expect(downloads()).toEqual([
      expect.objectContaining({
        fileName: 'model.gguf',
        status: 'downloading',
        progress: 0.5,
      }),
    ]);
  });

  it('folds a projector artifact into one vision-model projection', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'transfer-author/vision',
      modelId: 'author/vision',
      fileName: 'vision.gguf',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 500 * MB,
      totalBytes: 1000 * MB,
    });
    boundary.download!.seedActive({
      downloadId: 'transfer-projector',
      modelId: 'author/vision',
      fileName: 'vision-mmproj.gguf',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 100 * MB,
      totalBytes: 200 * MB,
    });
    const vision = record('author/vision', 'vision.gguf');
    vision.manifest.artifacts.push({
      id: 'projector',
      name: 'vision-mmproj.gguf',
      role: 'mmproj',
      required: true,
      localName: 'vision-mmproj.gguf',
      url: 'https://example.test/vision-mmproj.gguf',
    });
    vision.artifacts.push({
      artifactId: 'projector',
      phase: 'downloading',
      transferId: 'transfer-projector',
      bytesDownloaded: 100 * MB,
      totalBytes: 200 * MB,
    });
    await start([vision]);
    expect(downloads().map(item => item.fileName)).toEqual(['vision.gguf']);
  });

  it('preserves recoverable terminal records in the Shared projection', async () => {
    installNativeBoundary({ download: true, fs: true });
    await start([
      record('done', 'done.gguf', 'completed', 1000 * MB),
      record('cancelled', 'cancelled.gguf', 'cancelled', 0),
    ]);
    expect(downloads()).toEqual([
      expect.objectContaining({ fileName: 'done.gguf', status: 'interrupted' }),
      expect.objectContaining({
        fileName: 'cancelled.gguf',
        status: 'cancelled',
      }),
    ]);
  });

  it('keeps the newest durable attempt for one model', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'transfer-author/model',
      modelId: 'author/model',
      fileName: 'model.gguf',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 700 * MB,
      totalBytes: 1000 * MB,
    });
    const old = record('author/model', 'model.gguf', 'failed', 100 * MB);
    const latest = {
      ...record('author/model', 'model.gguf', 'downloading', 700 * MB),
      createdAt: 2,
      updatedAt: 2,
      attempt: 2,
    };
    await start([old, latest]);
    expect(downloads()).toEqual([
      expect.objectContaining({ bytesDownloaded: 700 * MB }),
    ]);
  });

  it('retains an interrupted entry when an iOS native transfer disappears', async () => {
    installNativeBoundary({
      download: true,
      fs: true,
      ram: {
        platform: 'ios',
        totalBytes: 8 * 1024 ** 3,
        availBytes: 4 * 1024 ** 3,
      },
    });
    await start([record('author/model', 'model.gguf')]);
    expect(downloads()).toEqual([
      expect.objectContaining({
        fileName: 'model.gguf',
        status: 'interrupted',
      }),
    ]);
  });

  it('keeps a surviving Android native transfer active', async () => {
    const boundary = installNativeBoundary({
      download: true,
      fs: true,
      ram: {
        platform: 'android',
        totalBytes: 8 * 1024 ** 3,
        availBytes: 4 * 1024 ** 3,
      },
    });
    boundary.download!.seedActive({
      downloadId: 'transfer-author/model',
      modelId: 'author/model',
      fileName: 'model.gguf',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 700 * MB,
      totalBytes: 1000 * MB,
    });
    await start([record('author/model', 'model.gguf')]);
    expect(downloads()).toEqual([
      expect.objectContaining({ status: 'downloading' }),
    ]);
  });
});
