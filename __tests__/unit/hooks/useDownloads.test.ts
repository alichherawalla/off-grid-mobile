import { renderHook, act } from '@testing-library/react-native';

type ProgressCb = (event: { downloadId: string; bytesDownloaded: number; totalBytes: number; status?: string }) => void;
type CompleteCb = (event: { downloadId: string; bytesDownloaded: number; totalBytes: number }) => void;
type ErrorCb = (event: { downloadId: string; reason: string; reasonCode?: string }) => void;

let onAnyProgressCb: ProgressCb | null = null;
let onAnyCompleteCb: CompleteCb | null = null;
let onAnyErrorCb: ErrorCb | null = null;

jest.mock('../../../src/services/modelServices/coordinatedDownloadBridge', () => ({
  coordinatedDownloads: {
    isAvailable: jest.fn(() => true),
    onAnyProgress: jest.fn(),
    onAnyComplete: jest.fn(),
    onAnyError: jest.fn(),
    cancelDownload: jest.fn(() => Promise.resolve()),
  },
}));

const mockUnsubProgress = jest.fn();
const mockUnsubComplete = jest.fn();
const mockUnsubError = jest.fn();
let mockCancelDownload: jest.Mock;

const mockGetState = jest.fn();
const mockUpdateProgress = jest.fn();
const mockUpdateMmProjProgress = jest.fn();
const mockSetStatus = jest.fn();
const mockSetProcessing = jest.fn();
const mockSetCompleted = jest.fn();
const mockSetMmProjCompleted = jest.fn();
const mockRemove = jest.fn();
const mockRetryEntry = jest.fn();

const mockDownloads: Record<string, any> = {};

jest.mock('../../../src/stores/downloadStore', () => ({
  useDownloadStore: Object.assign(
    jest.fn((selector?: any) => selector ? selector({ downloads: mockDownloads }) : mockDownloads),
    {
      getState: () => mockGetState(),
    },
  ),
  isActiveStatus: (s: string) => ['pending', 'running', 'retrying', 'waiting_for_network', 'processing'].includes(s),
}));

jest.mock('../../../src/utils/downloadErrors', () => ({
  toUserMessage: jest.fn((reason: string) => reason),
}));

import { useDownloads, useDownloadListeners } from '../../../src/hooks/useDownloads';

function fireProgress(event: Parameters<ProgressCb>[0]) {
  if (!onAnyProgressCb) throw new Error('onAnyProgressCb not set');
  onAnyProgressCb(event);
}
function fireComplete(event: Parameters<CompleteCb>[0]) {
  if (!onAnyCompleteCb) throw new Error('onAnyCompleteCb not set');
  onAnyCompleteCb(event);
}
function fireError(event: Parameters<ErrorCb>[0]) {
  if (!onAnyErrorCb) throw new Error('onAnyErrorCb not set');
  onAnyErrorCb(event);
}

function makeStoreState(overrides: Partial<any> = {}) {
  return {
    downloadIdIndex: {},
    downloads: mockDownloads,
    updateProgress: mockUpdateProgress,
    updateMmProjProgress: mockUpdateMmProjProgress,
    setStatus: mockSetStatus,
    setProcessing: mockSetProcessing,
    setCompleted: mockSetCompleted,
    setMmProjCompleted: mockSetMmProjCompleted,
    remove: mockRemove,
    retryEntry: mockRetryEntry,
    ...overrides,
  };
}

function withSingleTextEntry(downloadId = 'dl-1', extra: Record<string, any> = {}) {
  mockGetState.mockReturnValue(makeStoreState({
    downloadIdIndex: { [downloadId]: 'llm:model' },
    downloads: { 'llm:model': { downloadId, modelType: 'text', ...extra } },
  }));
}

describe('useDownloads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    onAnyProgressCb = null;
    onAnyCompleteCb = null;
    onAnyErrorCb = null;
    Object.keys(mockDownloads).forEach(k => delete mockDownloads[k]);
    mockGetState.mockReturnValue(makeStoreState());

    const { coordinatedDownloads: svc } = jest.requireMock('../../../src/services/modelServices/coordinatedDownloadBridge');
    mockCancelDownload = svc.cancelDownload as jest.Mock;
    mockCancelDownload.mockResolvedValue(undefined);
    (svc.onAnyProgress as jest.Mock).mockImplementation((cb: ProgressCb) => { onAnyProgressCb = cb; return mockUnsubProgress; });
    (svc.onAnyComplete as jest.Mock).mockImplementation((cb: CompleteCb) => { onAnyCompleteCb = cb; return mockUnsubComplete; });
    (svc.onAnyError as jest.Mock).mockImplementation((cb: ErrorCb) => { onAnyErrorCb = cb; return mockUnsubError; });
  });

  it('subscribes to all three event channels on mount', () => {
    const { coordinatedDownloads: svc } = jest.requireMock('../../../src/services/modelServices/coordinatedDownloadBridge');
    renderHook(() => useDownloadListeners());
    expect(svc.onAnyProgress).toHaveBeenCalled();
    expect(svc.onAnyComplete).toHaveBeenCalled();
    expect(svc.onAnyError).toHaveBeenCalled();
  });

  it('unsubscribes all listeners on unmount', () => {
    const { unmount } = renderHook(() => useDownloadListeners());
    unmount();
    expect(mockUnsubProgress).toHaveBeenCalled();
    expect(mockUnsubComplete).toHaveBeenCalled();
    expect(mockUnsubError).toHaveBeenCalled();
  });

  it('skips subscription when service is unavailable', () => {
    const { coordinatedDownloads: svc } = jest.requireMock('../../../src/services/modelServices/coordinatedDownloadBridge');
    (svc.isAvailable as jest.Mock).mockReturnValueOnce(false);
    renderHook(() => useDownloadListeners());
    expect(svc.onAnyProgress).not.toHaveBeenCalled();
  });

  it('ignores progress event when downloadId not in index', () => {
    renderHook(() => useDownloadListeners());
    act(() => { fireProgress({ downloadId: 'unknown', bytesDownloaded: 100, totalBytes: 1000 }); });
    expect(mockUpdateProgress).not.toHaveBeenCalled();
  });

  it('routes retrying status through setStatus instead of updateProgress', () => {
    withSingleTextEntry();
    renderHook(() => useDownloadListeners());
    act(() => { fireProgress({ downloadId: 'dl-1', bytesDownloaded: 0, totalBytes: 0, status: 'retrying' }); });
    expect(mockSetStatus).toHaveBeenCalledWith('dl-1', 'retrying');
    expect(mockUpdateProgress).not.toHaveBeenCalled();
  });

  it('routes waiting_for_network status through setStatus', () => {
    withSingleTextEntry();
    renderHook(() => useDownloadListeners());
    act(() => { fireProgress({ downloadId: 'dl-1', bytesDownloaded: 0, totalBytes: 0, status: 'waiting_for_network' }); });
    expect(mockSetStatus).toHaveBeenCalledWith('dl-1', 'waiting_for_network');
  });

  it('calls updateProgress for main download progress event', () => {
    withSingleTextEntry();
    renderHook(() => useDownloadListeners());
    act(() => { fireProgress({ downloadId: 'dl-1', bytesDownloaded: 500, totalBytes: 1000 }); });
    expect(mockUpdateProgress).toHaveBeenCalledWith('dl-1', 500, 1000);
  });

  it('routes mmproj progress to updateMmProjProgress', () => {
    mockGetState.mockReturnValue(makeStoreState({
      downloadIdIndex: { 'mmproj-1': 'llm:model' },
      downloads: { 'llm:model': { downloadId: 'dl-1', mmProjDownloadId: 'mmproj-1', modelType: 'text' } },
    }));
    renderHook(() => useDownloadListeners());
    act(() => { fireProgress({ downloadId: 'mmproj-1', bytesDownloaded: 200, totalBytes: 400 }); });
    expect(mockUpdateMmProjProgress).toHaveBeenCalledWith('mmproj-1', 200);
  });

  it('warns and does nothing when downloadId matches neither main nor mmproj', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetState.mockReturnValue(makeStoreState({
      downloadIdIndex: { 'other': 'llm:model' },
      downloads: { 'llm:model': { downloadId: 'dl-1', mmProjDownloadId: 'mmproj-1', modelType: 'text' } },
    }));
    renderHook(() => useDownloadListeners());
    act(() => { fireProgress({ downloadId: 'other', bytesDownloaded: 100, totalBytes: 200 }); });
    expect(mockUpdateProgress).not.toHaveBeenCalled();
    expect(mockUpdateMmProjProgress).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('ignores complete event when downloadId not in index', () => {
    renderHook(() => useDownloadListeners());
    act(() => { fireComplete({ downloadId: 'unknown', bytesDownloaded: 100, totalBytes: 100 }); });
    expect(mockSetCompleted).not.toHaveBeenCalled();
  });

  it('calls setMmProjCompleted and then setCompleted when mmproj finishes and main is done', () => {
    const updatedEntry = { downloadId: 'dl-1', mmProjDownloadId: 'mmproj-1', mmProjStatus: 'completed', status: 'completed', modelType: 'text' };
    const storeState = makeStoreState({
      downloadIdIndex: { 'mmproj-1': 'llm:model' },
      downloads: { 'llm:model': { downloadId: 'dl-1', mmProjDownloadId: 'mmproj-1', modelType: 'text' } },
    });
    storeState.setMmProjCompleted = jest.fn(() => {
      storeState.downloads['llm:model'] = updatedEntry;
    });
    mockGetState.mockReturnValue(storeState);
    renderHook(() => useDownloadListeners());
    act(() => { fireComplete({ downloadId: 'mmproj-1', bytesDownloaded: 400, totalBytes: 400 }); });
    expect(storeState.setMmProjCompleted).toHaveBeenCalledWith('mmproj-1', 400);
    expect(mockSetCompleted).toHaveBeenCalledWith('dl-1');
  });

  it('calls setMmProjCompleted but not setCompleted when main model not yet done', () => {
    const storeState = makeStoreState({
      downloadIdIndex: { 'mmproj-1': 'llm:model' },
      downloads: { 'llm:model': { downloadId: 'dl-1', mmProjDownloadId: 'mmproj-1', status: 'running', modelType: 'text' } },
    });
    mockGetState.mockReturnValue(storeState);
    renderHook(() => useDownloadListeners());
    act(() => { fireComplete({ downloadId: 'mmproj-1', bytesDownloaded: 400, totalBytes: 400 }); });
    expect(mockSetMmProjCompleted).toHaveBeenCalled();
    expect(mockSetCompleted).not.toHaveBeenCalled();
  });

  it('calls updateProgress when main gguf finishes but mmproj not yet done', () => {
    withSingleTextEntry('dl-1', { mmProjDownloadId: 'mmproj-1', mmProjStatus: 'running' });
    renderHook(() => useDownloadListeners());
    act(() => { fireComplete({ downloadId: 'dl-1', bytesDownloaded: 1000, totalBytes: 1000 }); });
    expect(mockUpdateProgress).toHaveBeenCalled();
    expect(mockSetCompleted).not.toHaveBeenCalled();
  });

  it('calls setProcessing for image model on complete', () => {
    mockGetState.mockReturnValue(makeStoreState({
      downloadIdIndex: { 'dl-1': 'image:model' },
      downloads: { 'image:model': { downloadId: 'dl-1', modelType: 'image' } },
    }));
    renderHook(() => useDownloadListeners());
    act(() => { fireComplete({ downloadId: 'dl-1', bytesDownloaded: 500, totalBytes: 500 }); });
    expect(mockSetProcessing).toHaveBeenCalledWith('dl-1');
    expect(mockSetCompleted).not.toHaveBeenCalled();
  });

  it('calls updateProgress for text model on complete (finalization handled elsewhere)', () => {
    withSingleTextEntry();
    renderHook(() => useDownloadListeners());
    act(() => { fireComplete({ downloadId: 'dl-1', bytesDownloaded: 1000, totalBytes: 1000 }); });
    expect(mockUpdateProgress).toHaveBeenCalled();
    expect(mockSetCompleted).not.toHaveBeenCalled();
  });

  it('calls setCompleted for unknown model type on complete', () => {
    mockGetState.mockReturnValue(makeStoreState({
      downloadIdIndex: { 'dl-1': 'other:model' },
      downloads: { 'other:model': { downloadId: 'dl-1', modelType: 'other' } },
    }));
    renderHook(() => useDownloadListeners());
    act(() => { fireComplete({ downloadId: 'dl-1', bytesDownloaded: 500, totalBytes: 500 }); });
    expect(mockSetCompleted).toHaveBeenCalledWith('dl-1');
  });

  it('ignores error event when downloadId not in index', () => {
    renderHook(() => useDownloadListeners());
    act(() => { fireError({ downloadId: 'unknown', reason: 'oops' }); });
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it('calls setStatus with failed on error event', () => {
    withSingleTextEntry();
    renderHook(() => useDownloadListeners());
    act(() => { fireError({ downloadId: 'dl-1', reason: 'timeout', reasonCode: 'E_TIMEOUT' }); });
    expect(mockSetStatus).toHaveBeenCalledWith('dl-1', 'failed', expect.objectContaining({ message: 'timeout' }));
  });

  it('cancel removes from store and cancels native download', async () => {
    const entry = { downloadId: 'dl-1', modelType: 'text' };
    mockGetState.mockReturnValue(makeStoreState({
      downloads: { 'llm:model': entry },
    }));
    const { result } = renderHook(() => useDownloads());
    await act(async () => { await result.current.cancel('llm:model'); });
    expect(mockRemove).toHaveBeenCalledWith('llm:model');
    expect(mockCancelDownload).toHaveBeenCalledWith('dl-1');
  });

  it('cancel also cancels mmproj download when present', async () => {
    const entry = { downloadId: 'dl-1', mmProjDownloadId: 'mmproj-1', modelType: 'text' };
    mockGetState.mockReturnValue(makeStoreState({
      downloads: { 'llm:model': entry },
    }));
    const { result } = renderHook(() => useDownloads());
    await act(async () => { await result.current.cancel('llm:model'); });
    expect(mockCancelDownload).toHaveBeenCalledWith('mmproj-1');
  });

  it('cancel does nothing when entry not found', async () => {
    mockGetState.mockReturnValue(makeStoreState({ downloads: {} }));
    const { result } = renderHook(() => useDownloads());
    await act(async () => { await result.current.cancel('llm:missing'); });
    expect(mockCancelDownload).not.toHaveBeenCalled();
  });

  it('retry cancels old download, calls startDownload, and calls retryEntry', async () => {
    const entry = { downloadId: 'dl-old', modelType: 'text' };
    mockGetState.mockReturnValue(makeStoreState({
      downloads: { 'llm:model': entry },
    }));
    const startDownload = jest.fn(() => Promise.resolve('dl-new'));
    const { result } = renderHook(() => useDownloads());
    await act(async () => { await result.current.retry('llm:model', startDownload); });
    expect(mockCancelDownload).toHaveBeenCalledWith('dl-old');
    expect(startDownload).toHaveBeenCalled();
    expect(mockRetryEntry).toHaveBeenCalledWith('llm:model', 'dl-new');
  });

  it('retry does nothing when entry not found', async () => {
    mockGetState.mockReturnValue(makeStoreState({ downloads: {} }));
    const startDownload = jest.fn(() => Promise.resolve('dl-new'));
    const { result } = renderHook(() => useDownloads());
    await act(async () => { await result.current.retry('llm:missing', startDownload); });
    expect(startDownload).not.toHaveBeenCalled();
  });
});
