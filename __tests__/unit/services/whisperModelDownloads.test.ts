import RNFS from 'react-native-fs';
import { backgroundDownloadService } from '../../../src/services/backgroundDownloadService';
import { WhisperModelDownloads } from '../../../src/services/whisperModelDownloads';
import * as whisperModelFiles from '../../../src/services/whisperModelFiles';

jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    downloadFileTo: jest.fn(),
    cancelDownload: jest.fn(async () => {}),
  },
}));

const mockAdd = jest.fn();
const mockRemove = jest.fn();
const mockRetryEntry = jest.fn();
jest.mock('../../../src/stores/downloadStore', () => ({
  useDownloadStore: {
    getState: () => ({
      add: mockAdd,
      remove: mockRemove,
      retryEntry: mockRetryEntry,
    }),
  },
}));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('WhisperModelDownloads concurrent ownership', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it('cancels the deleted model without disturbing another active download', async () => {
    const first = deferred();
    const second = deferred();
    jest.spyOn(whisperModelFiles, 'ensureModelsDirExists').mockResolvedValue();
    jest.spyOn(whisperModelFiles, 'validateModelFile').mockResolvedValue();
    jest.spyOn(RNFS, 'exists').mockResolvedValue(false);
    const downloadFileTo =
      backgroundDownloadService.downloadFileTo as jest.Mock;
    downloadFileTo
      .mockReturnValueOnce({
        downloadIdPromise: Promise.resolve(11),
        promise: first.promise,
      })
      .mockReturnValueOnce({
        downloadIdPromise: Promise.resolve(22),
        promise: second.promise,
      });

    const downloads = new WhisperModelDownloads();
    const tiny = downloads.downloadModel('tiny.en');
    const base = downloads.downloadModel('base.en');
    await new Promise<void>(resolve => setImmediate(resolve));

    await downloads.deleteModel('tiny.en');
    expect(backgroundDownloadService.cancelDownload).toHaveBeenCalledWith(11);
    expect(backgroundDownloadService.cancelDownload).not.toHaveBeenCalledWith(
      22,
    );

    first.resolve();
    second.resolve();
    await Promise.all([tiny, base]);
    await downloads.deleteModel('base.en');
    expect(backgroundDownloadService.cancelDownload).not.toHaveBeenCalledWith(
      22,
    );
  });

  it('does not let an older same-model completion erase the newer download owner', async () => {
    const older = deferred();
    const newer = deferred();
    jest.spyOn(whisperModelFiles, 'ensureModelsDirExists').mockResolvedValue();
    jest.spyOn(whisperModelFiles, 'validateModelFile').mockResolvedValue();
    jest.spyOn(RNFS, 'exists').mockResolvedValue(false);
    const downloadFileTo =
      backgroundDownloadService.downloadFileTo as jest.Mock;
    downloadFileTo
      .mockReturnValueOnce({
        downloadIdPromise: Promise.resolve(31),
        promise: older.promise,
      })
      .mockReturnValueOnce({
        downloadIdPromise: Promise.resolve(32),
        promise: newer.promise,
      });

    const downloads = new WhisperModelDownloads();
    const first = downloads.downloadModel('tiny.en');
    const second = downloads.downloadModel('tiny.en');
    await new Promise<void>(resolve => setImmediate(resolve));
    older.resolve();
    await first;

    await downloads.deleteModel('tiny.en');
    expect(backgroundDownloadService.cancelDownload).toHaveBeenCalledWith(32);
    expect(backgroundDownloadService.cancelDownload).not.toHaveBeenCalledWith(
      31,
    );
    newer.resolve();
    await second;
  });
});
