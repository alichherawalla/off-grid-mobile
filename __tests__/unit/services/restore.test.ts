import type {PersistedModelDownload} from '@offgrid/models';
import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';
import {installNativeBoundary, MB} from '../../harness/nativeBoundary';

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

function record(
  id: string,
  fileName: string,
  phase: PersistedModelDownload['phase'] = 'downloading',
  bytesDownloaded = 0,
  totalBytes = 1_000 * MB,
): PersistedModelDownload {
  return {
    manifest: {
      id,
      modelId: id,
      kind: 'text',
      revision: 'main',
      artifacts: [{
        id: 'primary',
        name: fileName,
        role: 'primary',
        required: true,
        localName: fileName,
        url: `https://example.test/${encodeURIComponent(fileName)}`,
      }],
    },
    phase,
    artifacts: [{
      artifactId: 'primary',
      phase,
      ...(phase === 'downloading' ? {transferId: `transfer-${id}`} : {}),
      bytesDownloaded,
      totalBytes,
    }],
    createdAt: 1,
    updatedAt: 1,
    attempt: 1,
  };
}

async function restore(records: readonly PersistedModelDownload[]): Promise<void> {
  const {seedMobileDownloadJournal, startMobileApplicationFixture} =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  await seedMobileDownloadJournal(records);
  fixture = await startMobileApplicationFixture();
  await fixture.refreshModels();
}

function projectedDownloads() {
  const {useDownloadStore} = require('../../../src/stores/downloadStore') as typeof import('../../../src/stores/downloadStore');
  return Object.values(useDownloadStore.getState().downloads);
}

describe('Shared download restoration through the Mobile composition root', () => {
  it('projects no downloads when neither durable nor native state has work', async () => {
    installNativeBoundary({download: true, fs: true});
    await restore([]);
    expect(projectedDownloads()).toEqual([]);
  });

  it('restores an active native transfer with its durable progress', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    boundary.download!.seedActive({
      downloadId: 'transfer-author/model', modelId: 'author/model', fileName: 'model.gguf',
      modelType: 'text', status: 'running', bytesDownloaded: 400 * MB, totalBytes: 1_000 * MB,
    });
    await restore([record('author/model', 'model.gguf', 'downloading', 400 * MB)]);
    expect(projectedDownloads()).toEqual([expect.objectContaining({
      downloadId: 'author/model', fileName: 'model.gguf', status: 'downloading',
      bytesDownloaded: 400 * MB, progress: 0.4,
    })]);
  });

  it('marks durable work as interrupted when its iOS native transfer disappeared', async () => {
    installNativeBoundary({
      download: true,
      fs: true,
      ram: {platform: 'ios', totalBytes: 8 * 1024 ** 3, availBytes: 4 * 1024 ** 3},
    });
    await restore([record('author/missing', 'missing.gguf', 'downloading', 200 * MB)]);
    expect(projectedDownloads()).toEqual([expect.objectContaining({
      downloadId: 'author/missing', fileName: 'missing.gguf', status: 'interrupted',
    })]);
  });

  it('restores multiple native transfers as independent Shared projections', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    boundary.download!.seedActive({
      downloadId: 'transfer-author/a', modelId: 'author/a', fileName: 'a.gguf',
      modelType: 'text', status: 'running', bytesDownloaded: 100 * MB, totalBytes: 1_000 * MB,
    });
    boundary.download!.seedActive({
      downloadId: 'transfer-author/b', modelId: 'author/b', fileName: 'b.gguf',
      modelType: 'text', status: 'running', bytesDownloaded: 700 * MB, totalBytes: 1_000 * MB,
    });
    await restore([
      record('author/a', 'a.gguf', 'downloading', 100 * MB),
      record('author/b', 'b.gguf', 'downloading', 700 * MB),
    ]);
    expect(projectedDownloads()).toEqual(expect.arrayContaining([
      expect.objectContaining({downloadId: 'author/a', progress: 0.1}),
      expect.objectContaining({downloadId: 'author/b', progress: 0.7}),
    ]));
    expect(projectedDownloads()).toHaveLength(2);
  });

  it('keeps recoverable terminal states in the Shared projection', async () => {
    installNativeBoundary({download: true, fs: true});
    await restore([
      record('author/failed', 'failed.gguf', 'failed', 300 * MB),
      record('author/cancelled', 'cancelled.gguf', 'cancelled'),
    ]);
    expect(projectedDownloads()).toEqual(expect.arrayContaining([
      expect.objectContaining({downloadId: 'author/failed', status: 'failed'}),
      expect.objectContaining({downloadId: 'author/cancelled', status: 'cancelled'}),
    ]));
  });
});
