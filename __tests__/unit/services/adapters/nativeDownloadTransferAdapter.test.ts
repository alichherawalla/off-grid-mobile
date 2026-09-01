const mockNative = {
  startDownload: jest.fn(),
  cancelDownload: jest.fn(),
  getActiveDownloads: jest.fn(),
  moveCompletedDownload: jest.fn(),
  startProgressPolling: jest.fn(),
  requestNotificationPermission: jest.fn(),
  excludePathFromBackup: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
const mockHandlers: Record<string, (event: any) => void> = {};
const mockRemove = jest.fn();
const mockMkdir = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: { DownloadManagerModule: mockNative },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: (name: string, handler: (event: any) => void) => {
      mockHandlers[name] = handler;
      return { remove: mockRemove };
    },
  })),
  Platform: { OS: 'android' },
}));

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: { mkdir: mockMkdir },
}));

function freshAdapter(): any {
  let adapter: any;
  jest.isolateModules(() => {
    const singleton = require('../../../../src/services/adapters/downloads/nativeDownloadTransferAdapter')
      .nativeDownloadTransferAdapter;
    adapter = new singleton.constructor();
  });
  return adapter;
}

describe('nativeDownloadTransferAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockHandlers)) delete mockHandlers[key];
    mockNative.startDownload.mockResolvedValue({ downloadId: 42 });
    mockNative.getActiveDownloads.mockResolvedValue([]);
    mockNative.moveCompletedDownload.mockResolvedValue(undefined);
    mockNative.cancelDownload.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  it('starts one native artifact transfer, forwards progress, moves completion, and settles', async () => {
    const adapter = freshAdapter();
    const controller = new AbortController();
    const onStarted = jest.fn();
    const onProgress = jest.fn();

    const completion = adapter.start({
      id: 'artifact-1',
      url: 'https://models.test/model.gguf',
      destination: '/models/model.gguf',
      expectedBytes: 8,
      signal: controller.signal,
      onStarted,
      onProgress,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockMkdir).toHaveBeenCalledWith('/models');
    expect(mockNative.startDownload).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://models.test/model.gguf',
      fileName: 'model.gguf',
      modelId: 'artifact-1',
      modelKey: 'artifact-1',
      modelType: 'artifact',
      totalBytes: 8,
    }));
    expect(onStarted).toHaveBeenCalledWith('42');

    mockHandlers.DownloadProgress({ downloadId: '42', bytesDownloaded: 3, totalBytes: 8 });
    expect(onProgress).toHaveBeenCalledWith({ bytesDownloaded: 3, totalBytes: 8 });
    mockHandlers.DownloadComplete({ downloadId: '42' });

    await expect(completion).resolves.toEqual({ transferId: '42' });
    expect(mockNative.moveCompletedDownload).toHaveBeenCalledWith('42', '/models/model.gguf');
  });

  it('rejects errors from the native event and does not wait forever', async () => {
    const adapter = freshAdapter();
    const completion = adapter.start({
      id: 'artifact-2',
      url: 'https://models.test/model.gguf',
      destination: '/models/model.gguf',
      signal: new AbortController().signal,
      onProgress: jest.fn(),
    });
    await Promise.resolve();
    await Promise.resolve();
    mockHandlers.DownloadError({ downloadId: '42', reason: 'network lost' });
    await expect(completion).rejects.toThrow('network lost');
  });

  it('cancels the native transfer when the admitted handle is aborted', async () => {
    const adapter = freshAdapter();
    const controller = new AbortController();
    const completion = adapter.start({
      id: 'artifact-3',
      url: 'https://models.test/model.gguf',
      destination: '/models/model.gguf',
      signal: controller.signal,
      onProgress: jest.fn(),
    });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(completion).rejects.toThrow('Download cancelled');
    expect(mockNative.cancelDownload).toHaveBeenCalledWith('42');
  });

  it('attaches to a transfer that completed while JavaScript was stopped', async () => {
    mockNative.getActiveDownloads.mockResolvedValue([{ downloadId: 'survivor', status: 'completed' }]);
    const adapter = freshAdapter();
    await adapter.attach({
      transferId: 'survivor',
      destination: '/models/recovered.gguf',
      signal: new AbortController().signal,
      onProgress: jest.fn(),
    });
    expect(mockNative.moveCompletedDownload).toHaveBeenCalledWith('survivor', '/models/recovered.gguf');
  });

  it('reports only non-failed native rows as active and keeps platform helpers bounded', async () => {
    mockNative.getActiveDownloads.mockResolvedValue([
      { downloadId: 'live', status: 'running' },
      { downloadId: 'dead', status: 'failed' },
    ]);
    mockNative.excludePathFromBackup.mockResolvedValue(true);
    const adapter = freshAdapter();
    await expect(adapter.isActive('live')).resolves.toBe(true);
    await expect(adapter.isActive('dead')).resolves.toBe(false);
    await expect(adapter.excludeFromBackup('/models')).resolves.toBe(true);
    adapter.dispose();
    expect(mockRemove).toHaveBeenCalledTimes(3);
  });
});
