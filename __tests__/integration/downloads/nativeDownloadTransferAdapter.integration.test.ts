import { installNativeBoundary } from '../../harness/nativeBoundary';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

describe('native download transfer terminal ownership', () => {
  it('uses the in-flight move as the one terminal operation when abort races completion', async () => {
    const boundary = installNativeBoundary({ download: true });
    const nativeDownload = boundary.download!;
    const move = deferred<string>();
    nativeDownload.module.moveCompletedDownload.mockReturnValueOnce(move.promise);
    nativeDownload.seedActive({ downloadId: 'transfer-1', status: 'running' });
    const { NativeDownloadTransferAdapter } = require(
      '../../../src/services/adapters/downloads/nativeDownloadTransferAdapter'
    );
    const adapter = new NativeDownloadTransferAdapter();
    const abort = new AbortController();

    const attached = adapter.attach({
      transferId: 'transfer-1',
      destination: '/staging/model.bin',
      signal: abort.signal,
      onProgress: jest.fn(),
    });
    nativeDownload.events.emit('DownloadComplete', { downloadId: 'transfer-1' });
    await Promise.resolve();
    expect(nativeDownload.module.moveCompletedDownload).toHaveBeenCalledTimes(1);

    abort.abort();
    const cancelled = adapter.cancel('transfer-1');
    expect(nativeDownload.module.cancelDownload).not.toHaveBeenCalled();

    move.resolve('/staging/model.bin');
    await expect(cancelled).resolves.toBeUndefined();
    await expect(attached).rejects.toThrow('Download cancelled');
    expect(nativeDownload.module.moveCompletedDownload).toHaveBeenCalledTimes(1);
    expect(nativeDownload.module.cancelDownload).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it('does not start a move after native cancellation owns terminal settlement', async () => {
    const boundary = installNativeBoundary({ download: true });
    const nativeDownload = boundary.download!;
    const cancellation = deferred<void>();
    nativeDownload.module.cancelDownload.mockReturnValueOnce(cancellation.promise);
    const { NativeDownloadTransferAdapter } = require(
      '../../../src/services/adapters/downloads/nativeDownloadTransferAdapter'
    );
    const adapter = new NativeDownloadTransferAdapter();
    const abort = new AbortController();
    const attached = adapter.attach({
      transferId: 'transfer-cancel-first',
      destination: '/staging/model.bin',
      signal: abort.signal,
      onProgress: jest.fn(),
    });

    const cancelled = adapter.cancel('transfer-cancel-first');
    nativeDownload.events.emit('DownloadComplete', {
      downloadId: 'transfer-cancel-first',
    });
    abort.abort();
    await Promise.resolve();
    expect(nativeDownload.module.cancelDownload).toHaveBeenCalledTimes(1);
    expect(nativeDownload.module.moveCompletedDownload).not.toHaveBeenCalled();

    cancellation.resolve();
    await expect(cancelled).resolves.toBeUndefined();
    await expect(attached).rejects.toThrow('Download cancelled');
    expect(nativeDownload.module.cancelDownload).toHaveBeenCalledTimes(1);
    expect(nativeDownload.module.moveCompletedDownload).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it('removes native listeners when progress polling setup throws', async () => {
    const boundary = installNativeBoundary({ download: true });
    const nativeDownload = boundary.download!;
    nativeDownload.module.startProgressPolling.mockImplementationOnce(() => {
      throw new Error('poll setup failed');
    });
    const { NativeDownloadTransferAdapter } = require(
      '../../../src/services/adapters/downloads/nativeDownloadTransferAdapter'
    );
    const adapter = new NativeDownloadTransferAdapter();

    await expect(adapter.attach({
      transferId: 'transfer-2',
      destination: '/staging/model.bin',
      signal: new AbortController().signal,
      onProgress: jest.fn(),
    })).rejects.toThrow('poll setup failed');

    nativeDownload.events.emit('DownloadComplete', { downloadId: 'transfer-2' });
    await Promise.resolve();
    expect(nativeDownload.module.moveCompletedDownload).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it('removes native listeners when the initial transfer query rejects', async () => {
    const boundary = installNativeBoundary({ download: true });
    const nativeDownload = boundary.download!;
    nativeDownload.module.getActiveDownloads.mockRejectedValueOnce(
      new Error('download query failed'),
    );
    const { NativeDownloadTransferAdapter } = require(
      '../../../src/services/adapters/downloads/nativeDownloadTransferAdapter'
    );
    const adapter = new NativeDownloadTransferAdapter();

    await expect(adapter.attach({
      transferId: 'transfer-3',
      destination: '/staging/model.bin',
      signal: new AbortController().signal,
      onProgress: jest.fn(),
    })).rejects.toThrow('download query failed');

    nativeDownload.events.emit('DownloadComplete', { downloadId: 'transfer-3' });
    await Promise.resolve();
    expect(nativeDownload.module.moveCompletedDownload).not.toHaveBeenCalled();
    adapter.dispose();
  });
});
