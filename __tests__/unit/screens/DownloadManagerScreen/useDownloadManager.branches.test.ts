import type { ModelsSnapshot } from '@offgrid/application';
import type { PersistedModelDownload } from '@offgrid/models';
import type { MobileApplicationFixture } from '../../../harness/mobileApplicationFixture';
import { installNativeBoundary } from '../../../harness/nativeBoundary';
import { facadeDownloadToActiveItem } from '../../../../src/screens/DownloadManagerScreen/downloadItemMapping';

const MODEL_ID = 'org/repo';
const FILE_NAME = 'model-q4.gguf';
const DOWNLOAD_ID = `${MODEL_ID}/${FILE_NAME}`;
const TRANSFER_ID = 'native-download-1';
type DownloadRow = ModelsSnapshot['control']['downloads'][number];

let fixture: MobileApplicationFixture | null = null;
const mounted: Array<{ unmount(): void }> = [];

afterEach(async () => {
  for (const root of mounted.splice(0)) root.unmount();
  await fixture?.dispose();
  fixture = null;
});

function persistedDownload(): PersistedModelDownload {
  return {
    manifest: {
      id: DOWNLOAD_ID,
      modelId: MODEL_ID,
      kind: 'text',
      revision: 'main',
      artifacts: [
        {
          id: 'primary',
          name: FILE_NAME,
          role: 'primary',
          required: true,
          localName: FILE_NAME,
          url: `https://example.test/${FILE_NAME}`,
          sizeBytes: 100,
        },
      ],
    },
    phase: 'downloading',
    artifacts: [
      {
        artifactId: 'primary',
        phase: 'downloading',
        transferId: TRANSFER_ID,
        bytesDownloaded: 25,
        totalBytes: 100,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    attempt: 1,
  };
}

function projectionRow(overrides: Partial<DownloadRow> = {}): DownloadRow {
  return {
    downloadId: DOWNLOAD_ID,
    modelKey: `${MODEL_ID}/${FILE_NAME}`,
    modelId: MODEL_ID,
    fileName: FILE_NAME,
    modelType: 'text',
    status: 'downloading',
    bytesDownloaded: 25,
    totalBytes: 100,
    ...overrides,
  } as DownloadRow;
}

function renderCurrent<T>(hook: () => T): {
  readonly current: T;
  act(work: () => void | Promise<void>): Promise<void>;
} {
  const React = require('react') as typeof import('react');
  const renderer =
    require('react-test-renderer') as typeof import('react-test-renderer');
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
    get current() {
      return value!;
    },
    async act(work) {
      await renderer.act(async () => {
        await work();
      });
    },
  };
}

async function start() {
  const boundary = installNativeBoundary({ download: true, fs: true });
  boundary.download!.seedActive({
    downloadId: TRANSFER_ID,
    modelId: MODEL_ID,
    fileName: FILE_NAME,
    modelType: 'text',
    status: 'running',
    bytesDownloaded: 25,
    totalBytes: 100,
  });
  const { seedMobileDownloadJournal, startMobileApplicationFixture } =
    require('../../../harness/mobileApplicationFixture') as typeof import('../../../harness/mobileApplicationFixture');
  await seedMobileDownloadJournal([persistedDownload()]);
  fixture = await startMobileApplicationFixture();
  await fixture.refreshModels();
  const { useDownloadManager } =
    require('../../../../src/screens/DownloadManagerScreen/useDownloadManager') as typeof import('../../../../src/screens/DownloadManagerScreen/useDownloadManager');
  return { boundary, result: renderCurrent(() => useDownloadManager()) };
}

describe('Download Manager public application journey', () => {
  it('renders native progress from the real Shared application projection', async () => {
    const { boundary, result } = await start();
    expect(result.current.activeItems).toEqual([
      expect.objectContaining({
        downloadId: DOWNLOAD_ID,
        modelId: MODEL_ID,
        progress: 0.25,
        status: 'downloading',
      }),
    ]);

    await result.act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: TRANSFER_ID,
        bytesDownloaded: 75,
        totalBytes: 100,
      });
      await new Promise<void>(resolve => setImmediate(resolve));
    });

    expect(result.current.activeItems[0]).toEqual(
      expect.objectContaining({
        downloadId: DOWNLOAD_ID,
        progress: 0.75,
      }),
    );
  });

  it('confirms cancellation through the public application command', async () => {
    const { boundary, result } = await start();
    await result.act(() => {
      result.current.handleRemoveDownload(result.current.activeItems[0]);
    });
    const confirm = result.current.alertState.buttons?.find(
      button => button.text === 'Yes',
    );
    expect(confirm).toBeDefined();

    await result.act(async () => {
      confirm!.onPress?.();
      await new Promise<void>(resolve => setImmediate(resolve));
    });

    expect(boundary.download!.module.stopDownload).toHaveBeenCalledWith(
      TRANSFER_ID,
      false,
    );
    expect(result.current.activeItems).toEqual([]);
  });
});

describe('Download Manager projection invariants', () => {
  it('does not trust incomplete image metadata as display data', () => {
    expect(
      facadeDownloadToActiveItem(
        projectionRow({
          modelKey: 'image:sd',
          modelId: 'sd',
          modelType: 'image',
          metadataJson: JSON.stringify({
            imageModelName: 'Stable Diffusion',
            imageModelBackend: 'coreml',
          }),
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        modelId: 'sd',
        fileName: FILE_NAME,
        author: 'sd',
        quantization: '',
      }),
    );
  });

  it('does not invent progress when the transfer total is not known', () => {
    expect(
      facadeDownloadToActiveItem(
        projectionRow({
          status: 'preparing',
          bytesDownloaded: 0,
          totalBytes: 0,
        }),
      ).progress,
    ).toBe(0);
  });

  it('rejects an invalid model type instead of rendering a false row', () => {
    expect(() =>
      facadeDownloadToActiveItem(
        projectionRow({
          modelType: 'embedding',
        } as unknown as Partial<DownloadRow>),
      ),
    ).toThrow('Download has an invalid model type: embedding');
  });
});
