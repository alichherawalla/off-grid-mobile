import { act, renderHook } from '@testing-library/react-native';
import type {
  DownloadCompleteEvent,
  DownloadErrorEvent,
  DownloadProgressEvent,
} from '../../../src/services/backgroundDownloadTypes';

let mockProgressListener: ((event: DownloadProgressEvent) => void) | undefined;
let mockCompleteListener: ((event: DownloadCompleteEvent) => void) | undefined;
let mockErrorListener: ((event: DownloadErrorEvent) => void) | undefined;
const mockUnsubscribeProgress = jest.fn();
const mockUnsubscribeComplete = jest.fn();
const mockUnsubscribeError = jest.fn();

jest.mock('../../../src/services/modelServices/coordinatedDownloadBridge', () => ({
  coordinatedDownloads: {
    isAvailable: jest.fn(() => true),
    onAnyProgress: jest.fn((listener: (event: DownloadProgressEvent) => void) => {
      mockProgressListener = listener;
      return mockUnsubscribeProgress;
    }),
    onAnyComplete: jest.fn((listener: (event: DownloadCompleteEvent) => void) => {
      mockCompleteListener = listener;
      return mockUnsubscribeComplete;
    }),
    onAnyError: jest.fn((listener: (event: DownloadErrorEvent) => void) => {
      mockErrorListener = listener;
      return mockUnsubscribeError;
    }),
    cancelDownload: jest.fn(async () => undefined),
  },
}));

import { useDownloads, useDownloadListeners } from '../../../src/hooks/useDownloads';
import { useDownloadStore, type DownloadEntry } from '../../../src/stores/downloadStore';

function entry(overrides: Partial<DownloadEntry> = {}): DownloadEntry {
  return {
    modelKey: 'llm:model/model.gguf',
    downloadId: 'main',
    modelId: 'llm:model',
    fileName: 'model.gguf',
    quantization: 'Q4',
    modelType: 'text',
    status: 'pending',
    bytesDownloaded: 0,
    totalBytes: 100,
    combinedTotalBytes: 120,
    progress: 0,
    createdAt: 1,
    ...overrides,
  };
}

describe('useDownloads Shared projection integration', () => {
  const cancelDownload = () => (
    jest.requireMock('../../../src/services/modelServices/coordinatedDownloadBridge')
      .coordinatedDownloads.cancelDownload as jest.Mock
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockProgressListener = undefined;
    mockCompleteListener = undefined;
    mockErrorListener = undefined;
    useDownloadStore.getState().setAll([]);
  });

  it('subscribes and removes all native event listeners', () => {
    const { unmount } = renderHook(() => useDownloadListeners());
    expect(mockProgressListener).toBeDefined();
    expect(mockCompleteListener).toBeDefined();
    expect(mockErrorListener).toBeDefined();
    unmount();
    expect(mockUnsubscribeProgress).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribeComplete).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribeError).toHaveBeenCalledTimes(1);
  });

  it('projects progress, retry wait, and failure through the real Shared controller', () => {
    useDownloadStore.getState().add(entry());
    renderHook(() => useDownloadListeners());

    act(() => mockProgressListener?.({
      downloadId: 'main', fileName: 'model.gguf', modelId: 'llm:model',
      status: 'running', bytesDownloaded: 40, totalBytes: 100,
    }));
    expect(useDownloadStore.getState().downloads['llm:model/model.gguf']).toMatchObject({
      status: 'running', bytesDownloaded: 40,
    });

    act(() => mockProgressListener?.({
      downloadId: 'main', fileName: 'model.gguf', modelId: 'llm:model',
      status: 'waiting_for_network', bytesDownloaded: 40, totalBytes: 100,
    }));
    expect(useDownloadStore.getState().downloads['llm:model/model.gguf'].status)
      .toBe('waiting_for_network');

    act(() => mockErrorListener?.({
      downloadId: 'main', fileName: 'model.gguf', modelId: 'llm:model',
      status: 'failed', reason: 'network timeout', reasonCode: 'network_timeout',
    }));
    expect(useDownloadStore.getState().downloads['llm:model/model.gguf']).toMatchObject({
      status: 'failed', errorMessage: expect.any(String), errorCode: 'network_timeout',
    });
  });

  it('keeps main and projector completion ordered by Shared policy', () => {
    useDownloadStore.getState().add(entry({
      status: 'completed',
      mmProjDownloadId: 'projector',
      mmProjStatus: 'running',
    }));
    renderHook(() => useDownloadListeners());

    act(() => mockCompleteListener?.({
      downloadId: 'projector', fileName: 'mmproj.gguf', modelId: 'llm:model',
      status: 'completed', bytesDownloaded: 20, totalBytes: 20, localUri: '/mmproj.gguf',
    }));
    expect(useDownloadStore.getState().downloads['llm:model/model.gguf']).toMatchObject({
      status: 'completed', mmProjStatus: 'completed', mmProjBytesDownloaded: 20,
    });
  });

  it('moves image completion to processing and completes transcription', () => {
    useDownloadStore.getState().add(entry({ modelType: 'image' }));
    useDownloadStore.getState().add(entry({
      modelKey: 'whisper-tiny.en/ggml-tiny.en.bin',
      downloadId: 'speech',
      modelId: 'whisper-tiny.en',
      fileName: 'ggml-tiny.en.bin',
      modelType: 'stt',
    }));
    renderHook(() => useDownloadListeners());

    act(() => mockCompleteListener?.({
      downloadId: 'main', fileName: 'model.gguf', modelId: 'llm:model',
      status: 'completed', bytesDownloaded: 100, totalBytes: 100, localUri: '/model.gguf',
    }));
    act(() => mockCompleteListener?.({
      downloadId: 'speech', fileName: 'ggml-tiny.en.bin', modelId: 'whisper-tiny.en',
      status: 'completed', bytesDownloaded: 100, totalBytes: 100, localUri: '/tiny.bin',
    }));
    expect(useDownloadStore.getState().downloads['llm:model/model.gguf'].status).toBe('processing');
    expect(useDownloadStore.getState().downloads['whisper-tiny.en/ggml-tiny.en.bin'].status)
      .toBe('completed');
  });

  it('cancels both artifacts and removes the projection', async () => {
    useDownloadStore.getState().add(entry({ mmProjDownloadId: 'projector' }));
    const { result } = renderHook(() => useDownloads());
    await act(() => result.current.cancel('llm:model/model.gguf'));
    expect(cancelDownload()).toHaveBeenCalledWith('main');
    expect(cancelDownload()).toHaveBeenCalledWith('projector');
    expect(useDownloadStore.getState().downloads['llm:model/model.gguf']).toBeUndefined();
  });

  it('retries through the native boundary and updates the canonical identity', async () => {
    useDownloadStore.getState().add(entry({ status: 'failed' }));
    const { result } = renderHook(() => useDownloads());
    await act(() => result.current.retry(
      'llm:model/model.gguf',
      async () => 'replacement',
    ));
    expect(cancelDownload()).toHaveBeenCalledWith('main');
    expect(useDownloadStore.getState().downloads['llm:model/model.gguf']).toMatchObject({
      downloadId: 'replacement', status: 'pending',
    });
  });
});
