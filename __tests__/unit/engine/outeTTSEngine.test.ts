/**
 * OuteTTSEngine download tests
 *
 * Covers the move onto the shared background download engine + the partial-file
 * fix: downloads route through backgroundDownloadService.downloadFileTo, and a
 * present-but-truncated file is treated as NOT downloaded (instead of being
 * reported complete as the old RNFS-exists check did).
 */
jest.mock('react-native-fs', () => {
  const { defaultNativeFileSystemBoundary: boundary } = require('../../harness/nativeFileSystem');
  return { __esModule: true, default: boundary.module, ...boundary.module };
});

const mockIsAvailable = jest.fn(() => true);
const mockDownloadFileTo = jest.fn();
jest.mock('@offgrid/core/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    isAvailable: () => mockIsAvailable(),
    downloadFileTo: (...a: any[]) => mockDownloadFileTo(...a),
  },
}));

import { OuteTTSEngine } from '../../../pro/audio/engine/tts/engines/outetts/OuteTTSEngine';
import { OUTETTS_BACKBONE, OUTETTS_VOCODER } from '../../../pro/audio/engine/tts/engines/outetts/models';
import { defaultNativeFileSystemBoundary } from '../../harness/nativeFileSystem';

const pathFor = (filename: string) =>
  `${defaultNativeFileSystemBoundary.DocumentDirectoryPath}/tts-models/${filename}`;

describe('OuteTTSEngine downloads', () => {
  beforeEach(() => {
    defaultNativeFileSystemBoundary.reset();
    // Default: a successful full-size download lands the file on disk.
    mockIsAvailable.mockReturnValue(true);
    mockDownloadFileTo.mockImplementation(({ destPath, params }: any) => {
      defaultNativeFileSystemBoundary.seedFile(destPath, params.totalBytes);
      return { downloadIdPromise: Promise.resolve('1'), promise: Promise.resolve() };
    });
  });

  it('treats a truncated file on disk as not-downloaded', async () => {
    defaultNativeFileSystemBoundary.seedFile(
      pathFor(OUTETTS_BACKBONE.filename),
      1000,
    );
    defaultNativeFileSystemBoundary.seedFile(
      pathFor(OUTETTS_VOCODER.filename),
      OUTETTS_VOCODER.sizeBytes,
    );

    const states = await new OuteTTSEngine().checkAssetStatus();
    const backbone = states.find(s => s.asset.id === 'backbone');
    const vocoder = states.find(s => s.asset.id === 'vocoder');
    expect(backbone?.status).toBe('not-downloaded');
    expect(vocoder?.status).toBe('downloaded');
  });

  it('downloads through the shared background download engine', async () => {
    const engine = new OuteTTSEngine();
    await engine.downloadAssets(['backbone']);

    expect(mockDownloadFileTo).toHaveBeenCalledTimes(1);
    const arg = mockDownloadFileTo.mock.calls[0][0];
    expect(arg.params.url).toBe(OUTETTS_BACKBONE.url);
    expect(arg.destPath).toBe(pathFor(OUTETTS_BACKBONE.filename));
    expect(arg.params.modelId).toBe('tts-outetts-backbone');
  });

  it('falls back to RNFS when the native downloader is unavailable', async () => {
    mockIsAvailable.mockReturnValue(false);
    const RNFS = require('react-native-fs');
    RNFS.downloadFile.mockImplementation(({ toFile }: any) => {
      defaultNativeFileSystemBoundary.seedFile(
        toFile,
        OUTETTS_BACKBONE.sizeBytes,
      );
      return { promise: Promise.resolve({ statusCode: 200 }) };
    });

    await new OuteTTSEngine().downloadAssets(['backbone']);

    expect(RNFS.downloadFile).toHaveBeenCalled();
    expect(mockDownloadFileTo).not.toHaveBeenCalled();
  });

  it('rejects and cleans up when the downloaded file is incomplete', async () => {
    mockDownloadFileTo.mockImplementation(({ destPath }: any) => {
      defaultNativeFileSystemBoundary.seedFile(destPath, 1000);
      return { downloadIdPromise: Promise.resolve('1'), promise: Promise.resolve() };
    });

    await expect(new OuteTTSEngine().downloadAssets(['backbone'])).rejects.toThrow(/incomplete/i);
    expect(
      await defaultNativeFileSystemBoundary.exists(
        pathFor(OUTETTS_BACKBONE.filename),
      ),
    ).toBe(false);
  });
});
