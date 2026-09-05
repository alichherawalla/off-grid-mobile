import type { PersistedModelDownload } from '@offgrid/models';
import type { MobileApplicationFixture } from '../../../harness/mobileApplicationFixture';
import { installNativeBoundary } from '../../../harness/nativeBoundary';

const MODEL_ID = 'image:test-model';
const FILE_NAME = 'test-model.zip';
const DOWNLOAD_ID = `${MODEL_ID}/${FILE_NAME}`;
const TRANSFER_ID = 'native-image-download';
const METADATA = {
  imageDownloadType: 'zip',
  imageModelName: 'Test Model',
  imageModelDescription: 'A local image model',
  imageModelSize: 1_000,
  imageModelBackend: 'mnn',
};

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

function record(
  phase: PersistedModelDownload['phase'],
  bytesDownloaded: number,
  transferId?: string,
): PersistedModelDownload {
  return {
    manifest: {
      id: DOWNLOAD_ID,
      modelId: MODEL_ID,
      kind: 'image',
      revision: 'main',
      artifacts: [
        {
          id: 'primary',
          name: FILE_NAME,
          role: 'primary',
          required: true,
          localName: FILE_NAME,
          url: `https://example.test/${FILE_NAME}`,
          sizeBytes: 1_000,
        },
      ],
      metadata: {
        displayName: 'Test Model',
        catalogEntry: true,
        publicMetadataJson: JSON.stringify(METADATA),
      },
    },
    phase,
    artifacts: [
      {
        artifactId: 'primary',
        phase,
        ...(transferId ? { transferId } : {}),
        bytesDownloaded,
        totalBytes: 1_000,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    attempt: 1,
  };
}

async function launch(
  records: readonly PersistedModelDownload[],
): Promise<void> {
  const { seedMobileDownloadJournal, startMobileApplicationFixture } =
    require('../../../harness/mobileApplicationFixture') as typeof import('../../../harness/mobileApplicationFixture');
  await seedMobileDownloadJournal(records);
  fixture = await startMobileApplicationFixture();
  await fixture.refreshModels();
}

function projected() {
  const { useDownloadStore } =
    require('../../../../src/stores/downloadStore') as typeof import('../../../../src/stores/downloadStore');
  return Object.values(useDownloadStore.getState().downloads);
}

describe('image download relaunch through Shared application state', () => {
  it('keeps completed image metadata retriable when its bytes are missing on relaunch', async () => {
    installNativeBoundary({ download: true, fs: true });

    await launch([record('completed', 1_000)]);

    const projection = projected();
    expect(projection).toEqual([
      expect.objectContaining({
        downloadId: DOWNLOAD_ID,
        modelId: MODEL_ID,
        modelType: 'image',
        fileName: FILE_NAME,
        status: 'interrupted',
        bytesDownloaded: 1_000,
        totalBytes: 1_000,
        errorMessage: undefined,
      }),
    ]);
    expect(JSON.parse(projection[0].metadataJson!)).toEqual(
      expect.objectContaining({
        publicMetadataJson: JSON.stringify(METADATA),
      }),
    );
  });

  it('restores a surviving native image transfer with reactive progress', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.download!.seedActive({
      downloadId: TRANSFER_ID,
      modelId: MODEL_ID,
      fileName: FILE_NAME,
      modelType: 'image',
      status: 'running',
      bytesDownloaded: 250,
      totalBytes: 1_000,
    });

    await launch([record('downloading', 250, TRANSFER_ID)]);

    expect(projected()).toEqual([
      expect.objectContaining({
        downloadId: DOWNLOAD_ID,
        modelId: MODEL_ID,
        status: 'downloading',
        progress: 0.25,
      }),
    ]);
  });

  it('keeps a vanished iOS image transfer as an interrupted retry target', async () => {
    installNativeBoundary({
      download: true,
      fs: true,
      ram: {
        platform: 'ios',
        totalBytes: 8 * 1024 ** 3,
        availBytes: 4 * 1024 ** 3,
      },
    });

    await launch([record('downloading', 250, TRANSFER_ID)]);

    expect(projected()).toEqual([
      expect.objectContaining({
        downloadId: DOWNLOAD_ID,
        modelId: MODEL_ID,
        modelType: 'image',
        status: 'interrupted',
      }),
    ]);
  });
});
