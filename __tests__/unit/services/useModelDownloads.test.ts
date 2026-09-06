/**
 * The Pro TTS hook is a thin consumer of the Shared model-download projection.
 * Native transfer state and the durable journal are the only test boundaries.
 */
import type {PersistedModelDownload} from '@offgrid/models';
import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';
import {installNativeBoundary, requireRTL} from '../../harness/nativeBoundary';

const MODEL_ID = 'software-mansion/executorch-kokoro';
const FILE_NAME = 'kokoro.onnx';
const DOWNLOAD_ID = `${MODEL_ID}/${FILE_NAME}`;
const TRANSFER_ID = 'native-kokoro-transfer';

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

function record(kind: 'voice' | 'text' = 'voice'): PersistedModelDownload {
  const modelId = kind === 'voice' ? MODEL_ID : 'owner/text-model';
  const fileName = kind === 'voice' ? FILE_NAME : 'model.gguf';
  return {
    manifest: {
      id: `${modelId}/${fileName}`,
      modelId,
      kind,
      revision: 'main',
      artifacts: [{
        id: 'primary',
        name: fileName,
        role: 'primary',
        required: true,
        localName: fileName,
        url: `https://example.test/${fileName}`,
        sizeBytes: 100,
      }],
    },
    phase: 'downloading',
    artifacts: [{
      artifactId: 'primary',
      phase: 'downloading',
      transferId: kind === 'voice' ? TRANSFER_ID : 'native-text-transfer',
      bytesDownloaded: 20,
      totalBytes: 100,
    }],
    createdAt: 1,
    updatedAt: 1,
    attempt: 1,
  };
}

async function start(records: readonly PersistedModelDownload[]) {
  const boundary = installNativeBoundary({download: true, fs: true});
  boundary.download!.seedActive({
    downloadId: TRANSFER_ID,
    modelId: MODEL_ID,
    fileName: FILE_NAME,
    modelType: 'tts',
    status: 'running',
    bytesDownloaded: 20,
    totalBytes: 100,
  });
  const {seedMobileDownloadJournal, startMobileApplicationFixture} =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  await seedMobileDownloadJournal(records);
  fixture = await startMobileApplicationFixture();
  await fixture.refreshModels();
  return boundary;
}

describe('useModelDownloads', () => {
  it('projects only TTS downloads from the Shared application snapshot', async () => {
    await start([record(), record('text')]);
    const {renderHook} = requireRTL();
    const {useModelDownloads} = require('../../../src/hooks/useModelDownloads') as typeof import('../../../src/hooks/useModelDownloads');
    const {result} = renderHook(() => useModelDownloads());

    expect(result.current).toEqual([expect.objectContaining({
      downloadId: DOWNLOAD_ID,
      modelId: MODEL_ID,
      modelType: 'tts',
      status: 'downloading',
    })]);
  });

  it('reactively projects progress published by the Shared owner', async () => {
    const boundary = await start([record()]);
    const {act, renderHook, waitFor} = requireRTL();
    const {useModelDownloads} = require('../../../src/hooks/useModelDownloads') as typeof import('../../../src/hooks/useModelDownloads');
    const {result} = renderHook(() => useModelDownloads());

    await act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: TRANSFER_ID,
        bytesDownloaded: 75,
        totalBytes: 100,
      });
      await new Promise<void>(resolve => setImmediate(resolve));
    });

    await waitFor(() => expect(result.current[0]).toEqual(expect.objectContaining({
      downloadId: DOWNLOAD_ID,
      bytesDownloaded: 75,
      totalBytes: 100,
    })));
  });

  it('stops observing the Shared projection after unmount', async () => {
    const boundary = await start([record()]);
    const React = require('react') as typeof import('react');
    const {act, renderHook} = requireRTL();
    const {useModelDownloads} = require('../../../src/hooks/useModelDownloads') as typeof import('../../../src/hooks/useModelDownloads');
    const observed = jest.fn();
    const {unmount} = renderHook(() => {
      const downloads = useModelDownloads();
      React.useEffect(() => observed(downloads), [downloads]);
      return downloads;
    });
    const observationsAtUnmount = observed.mock.calls.length;

    unmount();
    await act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: TRANSFER_ID,
        bytesDownloaded: 90,
        totalBytes: 100,
      });
      await new Promise<void>(resolve => setImmediate(resolve));
    });

    expect(observed).toHaveBeenCalledTimes(observationsAtUnmount);
  });
});
