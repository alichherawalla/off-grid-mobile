import {
  reconcileNativeDownloadSnapshot,
  type NativeDownloadRow,
} from '@offgrid/models';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { installNativeBoundary } from '../../harness/nativeBoundary';

const reconcile = (
  rows: readonly NativeDownloadRow[],
  onMalformedRow?: (row: NativeDownloadRow, error: unknown) => void,
) =>
  reconcileNativeDownloadSnapshot({
    rows,
    persistedPrior: [],
    inMemoryPrior: [],
    keyFor: row => row.modelKey ?? `${row.modelId ?? ''}::${row.fileName}`,
    onMalformedRow,
  });

describe('Shared native download status policy', () => {
  it("maps 'retrying' to 'downloading'", () => {
    expect(
      reconcile([
        {
          downloadId: 'r',
          modelId: 'a/b',
          fileName: 'b.gguf',
          status: 'retrying',
          bytesDownloaded: 1,
          totalBytes: 10,
        },
      ])[0].status,
    ).toBe('downloading');
  });

  it("maps 'waiting_for_network' to 'paused'", () => {
    expect(
      reconcile([
        {
          downloadId: 'w',
          modelId: 'a/b',
          fileName: 'b.gguf',
          status: 'waiting_for_network',
          bytesDownloaded: 0,
          totalBytes: 10,
        },
      ])[0].status,
    ).toBe('paused');
  });

  it('maps an unknown native status to failed', () => {
    expect(
      reconcile([
        {
          downloadId: 'p',
          modelId: 'a/b',
          fileName: 'b.gguf',
          status: 'bogus',
          bytesDownloaded: 0,
          totalBytes: 10,
        },
      ])[0].status,
    ).toBe('failed');
  });
});

describe('Shared image completion policy', () => {
  it('surfaces a completed image row as processing', () => {
    const entry = reconcile([
      {
        downloadId: 'img',
        modelId: 'image:foo',
        modelType: 'image',
        fileName: 'foo.zip',
        status: 'completed',
        bytesDownloaded: 100,
        totalBytes: 100,
      },
    ])[0];
    expect(entry.status).toBe('processing');
    expect(entry.modelType).toBe('image');
  });

  it("recognises the legacy 'image:' identity when modelType is absent", () => {
    expect(
      reconcile([
        {
          downloadId: 'img2',
          modelId: 'image:bar',
          fileName: 'bar.zip',
          status: 'completed',
          bytesDownloaded: 50,
          totalBytes: 100,
        },
      ])[0].status,
    ).toBe('processing');
  });
});

describe('Shared progress and fallback policy', () => {
  it('returns zero progress when the denominator is zero', () => {
    expect(
      reconcile([
        {
          downloadId: 'z',
          modelId: 'a/b',
          fileName: 'b.gguf',
          status: 'running',
          bytesDownloaded: 0,
          totalBytes: 0,
          combinedTotalBytes: 0,
        },
      ])[0].progress,
    ).toBe(0);
  });

  it('uses the combined total and stable field fallbacks', () => {
    const entry = reconcile([
      {
        downloadId: 'c',
        modelKey: 'k',
        fileName: 'b.gguf',
        status: 'running',
        totalBytes: 200,
        combinedTotalBytes: 400,
      },
    ])[0];
    expect(entry).toEqual(
      expect.objectContaining({
        modelId: '',
        quantization: 'Unknown',
        modelType: 'text',
        bytesDownloaded: 0,
        combinedTotalBytes: 400,
        createdAt: 0,
      }),
    );
  });

  it('folds projector bytes and status into the parent progress', () => {
    const entry = reconcile([
      {
        downloadId: 'par',
        modelId: 'a/b',
        fileName: 'b.gguf',
        status: 'running',
        bytesDownloaded: 300,
        totalBytes: 1000,
        combinedTotalBytes: 1500,
        mmProjDownloadId: 'mm',
      },
      {
        downloadId: 'mm',
        modelId: 'a/b',
        fileName: 'b-mmproj.gguf',
        status: 'completed',
        bytesDownloaded: 200,
        totalBytes: 500,
      },
    ])[0];
    expect(entry).toEqual(
      expect.objectContaining({
        mmProjDownloadId: 'mm',
        mmProjBytesDownloaded: 200,
        mmProjStatus: 'completed',
      }),
    );
    expect(entry.progress).toBeCloseTo(500 / 1500);
  });
});

describe('Shared malformed-row isolation', () => {
  it('skips a malformed row and keeps valid rows', () => {
    const failures: unknown[] = [];
    const bad: NativeDownloadRow = {
      downloadId: 'bad',
      modelId: 'a/bad',
      modelKey: 'a/bad/x.gguf',
      fileName: 'x.gguf',
      status: 'running',
      get quantization(): never {
        throw new Error('corrupt row');
      },
    };
    const entries = reconcile(
      [
        {
          downloadId: 'good',
          modelId: 'a/good',
          modelKey: 'a/good/y.gguf',
          fileName: 'y.gguf',
          status: 'running',
          bytesDownloaded: 10,
          totalBytes: 100,
        },
        bad,
      ],
      (_row, error) => failures.push(error),
    );
    expect(entries.map(entry => entry.modelKey)).toEqual(['a/good/y.gguf']);
    expect(failures).toEqual([
      expect.objectContaining({ message: 'corrupt row' }),
    ]);
  });

  it('preserves a non-Error malformed-row reason at the reporting boundary', () => {
    const failures: unknown[] = [];
    const bad: NativeDownloadRow = {
      downloadId: 'bad2',
      modelId: 'a/bad2',
      modelKey: 'a/bad2/z.gguf',
      fileName: 'z.gguf',
      status: 'running',
      get quantization(): never {
        throw 'plain string failure';
      },
    };
    expect(reconcile([bad], (_row, error) => failures.push(error))).toEqual([]);
    expect(failures).toEqual(['plain string failure']);
  });
});

describe('production Mobile projection wiring', () => {
  let fixture: MobileApplicationFixture | null = null;

  afterEach(async () => {
    await fixture?.dispose();
    fixture = null;
  });

  it('projects a durable native download through the public Shared application facade', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: 'transfer-a/b',
      modelId: 'a/b',
      fileName: 'b.gguf',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 25,
      totalBytes: 100,
    });
    const { seedMobileDownloadJournal, startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    await seedMobileDownloadJournal([
      {
        manifest: {
          id: 'a/b',
          modelId: 'a/b',
          kind: 'text',
          revision: 'main',
          artifacts: [
            {
              id: 'primary',
              name: 'b.gguf',
              role: 'primary',
              required: true,
              localName: 'b.gguf',
              url: 'https://example.test/b.gguf',
            },
          ],
        },
        phase: 'downloading',
        artifacts: [
          {
            artifactId: 'primary',
            phase: 'downloading',
            transferId: 'transfer-a/b',
            bytesDownloaded: 25,
            totalBytes: 100,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
        attempt: 1,
      },
    ]);
    fixture = await startMobileApplicationFixture();
    await fixture.refreshModels();
    const { useDownloadStore } =
      require('../../../src/stores/downloadStore') as typeof import('../../../src/stores/downloadStore');
    expect(Object.values(useDownloadStore.getState().downloads)).toEqual([
      expect.objectContaining({
        fileName: 'b.gguf',
        status: 'downloading',
        progress: 0.25,
      }),
    ]);
  });
});
