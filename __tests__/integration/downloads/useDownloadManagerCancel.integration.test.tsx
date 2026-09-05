import type { PersistedModelDownload } from '@offgrid/models';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

const MODEL_ID = 'whisper-small.en';
const FILE_NAME = 'ggml-small.en.bin';
const DOWNLOAD_ID = `${MODEL_ID}/${FILE_NAME}`;
const TRANSFER_ID = 'native-whisper-small';
let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

const persistedDownload: PersistedModelDownload = {
  manifest: {
    id: DOWNLOAD_ID,
    modelId: MODEL_ID,
    kind: 'transcription',
    revision: 'main',
    artifacts: [
      {
        id: 'primary',
        name: FILE_NAME,
        role: 'primary',
        required: true,
        localName: FILE_NAME,
        url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${FILE_NAME}`,
        sizeBytes: 1_000,
      },
    ],
  },
  phase: 'downloading',
  artifacts: [
    {
      artifactId: 'primary',
      phase: 'downloading',
      transferId: TRANSFER_ID,
      bytesDownloaded: 400,
      totalBytes: 1_000,
    },
  ],
  createdAt: 1,
  updatedAt: 1,
  attempt: 1,
};

describe('Download Manager cancellation through the real application', () => {
  it('removes the visible in-flight row and stops its native transfer after confirmation', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: TRANSFER_ID,
      modelId: MODEL_ID,
      fileName: FILE_NAME,
      modelType: 'stt',
      status: 'running',
      bytesDownloaded: 400,
      totalBytes: 1_000,
    });
    const { seedMobileDownloadJournal, startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    await seedMobileDownloadJournal([persistedDownload]);
    fixture = await startMobileApplicationFixture();
    await fixture.refreshModels();

    const { renderHook, act, waitFor } = requireRTL();
    const { useDownloadManager } =
      require('../../../src/screens/DownloadManagerScreen/useDownloadManager') as typeof import('../../../src/screens/DownloadManagerScreen/useDownloadManager');
    const view = renderHook(() => useDownloadManager());

    await waitFor(() =>
      expect(view.result.current.activeItems).toEqual([
        expect.objectContaining({
          downloadId: DOWNLOAD_ID,
          modelId: MODEL_ID,
          status: 'downloading',
        }),
      ]),
    );
    act(() => view.result.current.handleRemoveDownload(view.result.current.activeItems[0]!));
    const confirm = (view.result.current.alertState.buttons ?? []).find(
      button => button.text === 'Yes',
    );
    expect(confirm).toBeDefined();
    await act(async () => confirm!.onPress?.());

    await waitFor(() => expect(view.result.current.activeItems).toEqual([]));
    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(
      TRANSFER_ID,
      false,
    );
    expect(boundary.download!.active()).toEqual([]);
    expect(fixture.application.models.snapshot().control.downloads).toEqual([
      expect.objectContaining({ downloadId: DOWNLOAD_ID, status: 'cancelled' }),
    ]);
  });
});
