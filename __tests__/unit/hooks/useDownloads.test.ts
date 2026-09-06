import type {PersistedModelDownload} from '@offgrid/models';
import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';
import {installNativeBoundary} from '../../harness/nativeBoundary';

const MODEL_ID = 'owner/model';
const DOWNLOAD_ID = `${MODEL_ID}/model.gguf`;
const TRANSFER_ID = 'native-model-transfer';

let fixture: MobileApplicationFixture | null = null;
const mounted: Array<{unmount(): void}> = [];

afterEach(async () => {
  for (const root of mounted.splice(0)) root.unmount();
  await fixture?.dispose();
  fixture = null;
});

function record(
  modelId = MODEL_ID,
  fileName = 'model.gguf',
  transferId = TRANSFER_ID,
): PersistedModelDownload {
  const id = `${modelId}/${fileName}`;
  return {
    manifest: {
      id,
      modelId,
      kind: 'text',
      revision: 'main',
      artifacts: [{
        id: 'primary',
        name: fileName,
        role: 'primary',
        required: true,
        localName: fileName,
        url: `https://example.test/${encodeURIComponent(fileName)}`,
        sizeBytes: 100,
      }],
    },
    phase: 'downloading',
    artifacts: [{
      artifactId: 'primary',
      phase: 'downloading',
      transferId,
      bytesDownloaded: 20,
      totalBytes: 100,
    }],
    createdAt: 1,
    updatedAt: 1,
    attempt: 1,
  };
}

function renderCurrent<T>(hook: () => T): {readonly current: T; act: (work: () => void | Promise<void>) => Promise<void>} {
  const React = require('react') as typeof import('react');
  const renderer = require('react-test-renderer') as typeof import('react-test-renderer');
  let value: T;
  function Probe() {
    value = hook();
    return null;
  }
  let root: ReturnType<typeof renderer.create>;
  renderer.act(() => {
    root = renderer.create(React.createElement(Probe));
  });
  mounted.push(root!);
  return {
    get current() { return value!; },
    async act(work) {
      await renderer.act(async () => {
        await work();
      });
    },
  };
}

function seedTransfer(
  boundary: ReturnType<typeof installNativeBoundary>,
  modelId = MODEL_ID,
  fileName = 'model.gguf',
  transferId = TRANSFER_ID,
): void {
  boundary.download!.seedActive({
    downloadId: transferId,
    modelId,
    fileName,
    modelType: 'text',
    status: 'running',
    bytesDownloaded: 20,
    totalBytes: 100,
  });
}

async function start(records: readonly PersistedModelDownload[]): Promise<void> {
  const {seedMobileDownloadJournal, startMobileApplicationFixture} =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  await seedMobileDownloadJournal(records);
  fixture = await startMobileApplicationFixture();
  await fixture.refreshModels();
}

describe('useModelDownloadsProjection', () => {
  it('reads the current Shared download projection', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    seedTransfer(boundary);
    await start([record()]);

    const {useModelDownloadsProjection} = require('../../../src/hooks/useModelDownloadsProjection') as typeof import('../../../src/hooks/useModelDownloadsProjection');
    const result = renderCurrent(() => useModelDownloadsProjection());

    expect(result.current).toEqual([expect.objectContaining({
      downloadId: DOWNLOAD_ID,
      modelId: MODEL_ID,
      status: 'downloading',
      bytesDownloaded: 20,
      totalBytes: 100,
    })]);
  });

  it('reactively renders native progress published by the Shared owner', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    seedTransfer(boundary);
    await start([record()]);
    const {useModelDownloadsProjection} = require('../../../src/hooks/useModelDownloadsProjection') as typeof import('../../../src/hooks/useModelDownloadsProjection');
    const result = renderCurrent(() => useModelDownloadsProjection());

    await result.act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: TRANSFER_ID,
        bytesDownloaded: 75,
        totalBytes: 100,
      });
      await new Promise<void>(resolve => setImmediate(resolve));
    });

    expect(result.current).toEqual([expect.objectContaining({
      downloadId: DOWNLOAD_ID,
      bytesDownloaded: 75,
      totalBytes: 100,
    })]);
  });

  it('selects only the requested model entry', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    seedTransfer(boundary);
    seedTransfer(boundary, 'owner/other', 'other.gguf', 'native-other');
    await start([
      record(),
      record('owner/other', 'other.gguf', 'native-other'),
    ]);

    const {useModelDownloadEntry} = require('../../../src/hooks/useModelDownloadsProjection') as typeof import('../../../src/hooks/useModelDownloadsProjection');
    const result = renderCurrent(() => useModelDownloadEntry('text', MODEL_ID));

    expect(result.current).toEqual(expect.objectContaining({
      downloadId: DOWNLOAD_ID,
      modelId: MODEL_ID,
    }));
  });

  it('reactively renders cancellation requested through the public application command', async () => {
    const boundary = installNativeBoundary({download: true, fs: true});
    seedTransfer(boundary);
    await start([record()]);
    const {useModelDownloadsProjection} = require('../../../src/hooks/useModelDownloadsProjection') as typeof import('../../../src/hooks/useModelDownloadsProjection');
    const result = renderCurrent(() => useModelDownloadsProjection());

    await result.act(async () => {
      const outcome = await fixture!.application.models.cancelDownload({downloadId: DOWNLOAD_ID});
      expect(outcome).toEqual(expect.objectContaining({ok: true, value: true}));
    });

    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(TRANSFER_ID, false);
    expect(result.current).toEqual([expect.objectContaining({status: 'cancelled'})]);
  });
});
