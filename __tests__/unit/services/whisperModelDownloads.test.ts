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

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve = () => {};
  let reject = (_error: Error) => {};
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function deferredDownloadId(): {
  promise: Promise<string>;
  resolve: (id: string) => void;
  reject: (error: Error) => void;
} {
  let resolve = (_id: string) => {};
  let reject = (_error: Error) => {};
  const promise = new Promise<string>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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

  it('cancels a queued model deleted before its native download id resolves', async () => {
    const id = deferredDownloadId();
    const file = deferred();
    jest.spyOn(whisperModelFiles, 'ensureModelsDirExists').mockResolvedValue();
    jest.spyOn(whisperModelFiles, 'validateModelFile').mockResolvedValue();
    jest.spyOn(RNFS, 'exists').mockResolvedValue(false);
    (backgroundDownloadService.downloadFileTo as jest.Mock).mockReturnValueOnce(
      { downloadIdPromise: id.promise, promise: file.promise },
    );

    const downloads = new WhisperModelDownloads();
    const downloading = downloads.downloadModel('tiny.en');
    await new Promise<void>(resolve => setImmediate(resolve));

    const cancelled = new Error('Download cancelled') as Error & {
      cancelled?: boolean;
    };
    cancelled.cancelled = true;
    (
      backgroundDownloadService.cancelDownload as jest.Mock
    ).mockImplementationOnce(async downloadId => {
      expect(downloadId).toBe('queued:whisper-tiny.en/ggml-tiny.en.bin');
      id.reject(cancelled);
    });
    const deleting = downloads.deleteModel('tiny.en');
    await deleting;

    expect(backgroundDownloadService.cancelDownload).toHaveBeenCalledWith(
      'queued:whisper-tiny.en/ggml-tiny.en.bin',
    );
    await expect(downloading).rejects.toMatchObject({ cancelled: true });
    expect(mockRemove).toHaveBeenCalledWith('whisper-tiny.en/ggml-tiny.en.bin');
  });

  it('keeps replacement ownership when an older queued delete settles', async () => {
    const olderId = deferredDownloadId();
    const olderFile = deferred();
    const newerFile = deferred();
    jest.spyOn(whisperModelFiles, 'ensureModelsDirExists').mockResolvedValue();
    jest.spyOn(whisperModelFiles, 'validateModelFile').mockResolvedValue();
    jest.spyOn(RNFS, 'exists').mockResolvedValue(false);
    const downloadFileTo =
      backgroundDownloadService.downloadFileTo as jest.Mock;
    downloadFileTo
      .mockReturnValueOnce({
        downloadIdPromise: olderId.promise,
        promise: olderFile.promise,
      })
      .mockReturnValueOnce({
        downloadIdPromise: Promise.resolve('replacement-52'),
        promise: newerFile.promise,
      });

    const downloads = new WhisperModelDownloads();
    const older = downloads.downloadModel('tiny.en');
    await new Promise<void>(resolve => setImmediate(resolve));
    const staleDelete = downloads.deleteModel('tiny.en');
    const replacement = downloads.downloadModel('tiny.en');
    await new Promise<void>(resolve => setImmediate(resolve));

    olderId.resolve('older-51');
    await staleDelete;
    expect(backgroundDownloadService.cancelDownload).toHaveBeenCalledWith(
      'older-51',
    );
    expect(backgroundDownloadService.cancelDownload).not.toHaveBeenCalledWith(
      'replacement-52',
    );

    olderFile.resolve();
    await older;
    expect(mockRemove).not.toHaveBeenCalled();

    await downloads.deleteModel('tiny.en');
    expect(backgroundDownloadService.cancelDownload).toHaveBeenCalledWith(
      'replacement-52',
    );
    newerFile.resolve();
    await replacement;
  });

  it('does not let an older failed owner unlink a replacement file', async () => {
    const olderFile = deferred();
    const replacementFile = deferred();
    jest.spyOn(whisperModelFiles, 'ensureModelsDirExists').mockResolvedValue();
    jest.spyOn(whisperModelFiles, 'validateModelFile').mockResolvedValue();
    jest.spyOn(RNFS, 'exists').mockResolvedValue(false);
    const unlink = jest.spyOn(RNFS, 'unlink').mockResolvedValue();
    const downloadFileTo =
      backgroundDownloadService.downloadFileTo as jest.Mock;
    downloadFileTo
      .mockReturnValueOnce({
        downloadIdPromise: Promise.resolve('older-61'),
        promise: olderFile.promise,
      })
      .mockReturnValueOnce({
        downloadIdPromise: Promise.resolve('replacement-62'),
        promise: replacementFile.promise,
      });

    const downloads = new WhisperModelDownloads();
    const older = downloads.downloadModel('tiny.en');
    const replacement = downloads.downloadModel('tiny.en');
    await new Promise<void>(resolve => setImmediate(resolve));

    olderFile.reject(new Error('Older download failed'));
    await expect(older).rejects.toThrow('Older download failed');
    expect(unlink).not.toHaveBeenCalled();

    replacementFile.resolve();
    await replacement;
  });

  it('removes a failed partial file when the failing download still owns it', async () => {
    const file = deferred();
    jest.spyOn(whisperModelFiles, 'ensureModelsDirExists').mockResolvedValue();
    jest.spyOn(whisperModelFiles, 'validateModelFile').mockResolvedValue();
    jest.spyOn(RNFS, 'exists').mockResolvedValue(false);
    const unlink = jest.spyOn(RNFS, 'unlink').mockResolvedValue();
    (backgroundDownloadService.downloadFileTo as jest.Mock).mockReturnValueOnce(
      {
        downloadIdPromise: Promise.resolve('current-71'),
        promise: file.promise,
      },
    );

    const downloads = new WhisperModelDownloads();
    const downloading = downloads.downloadModel('tiny.en');
    await new Promise<void>(resolve => setImmediate(resolve));
    file.reject(new Error('Current download failed'));

    await expect(downloading).rejects.toThrow('Current download failed');
    expect(unlink).toHaveBeenCalledWith(
      whisperModelFiles.getModelPath('tiny.en'),
    );
  });
});
