/**
 * Image download provider coverage for list, retry, cancellation, removal, and
 * interrupted multi-file recovery. The UI supplies only its alert sink.
 */
jest.mock('../../../src/services/modelServices/bootstrap/modelLibraryBootstrap', () => ({ modelLibrary: { deleteImageModel: jest.fn(async () => {}) } }));
jest.mock('../../harness/activeModelLifecycle', () => ({ activeModelService: {
    // The model-selection seam, from the one place it is defined.
    ...require('../../utils/activeModelServiceStub').activeModelSelectionStub(), unloadImageModel: jest.fn(async () => {}) } }));
jest.mock('../../../src/services/modelServices/coordinatedDownloadBridge', () => ({ coordinatedDownloads: { cancelDownload: jest.fn(async () => {}), retryDownload: jest.fn(async () => {}), startProgressPolling: jest.fn(), getActiveDownloads: jest.fn(async () => []) } }));
const mockRetryImageDownload = jest.fn(async (_entry: any, _sink: any) => {});
jest.mock('../../../src/services/imageDownloadRetry', () => ({ retryImageDownload: (entry: any, sink: any) => mockRetryImageDownload(entry, sink) }));
jest.mock('../../../src/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { Platform } from 'react-native';
import { imageProvider, setImageDownloadAlertSink } from '../../../src/services/adapters/downloads/imageDownloadAdapter';
import { useDownloadStore } from '../../../src/stores/downloadStore';
import { useAppStore } from '../../../src/stores';
import { coordinatedDownloads as backgroundDownloadService } from '../../../src/services/modelServices/coordinatedDownloadBridge';

const mockBg = backgroundDownloadService as unknown as { cancelDownload: jest.Mock; retryDownload: jest.Mock; startProgressPolling: jest.Mock };
const setPlatform = (os: 'ios' | 'android') => { (Platform as any).OS = os; };

const entry = (over: any = {}) => ({
  modelKey: 'image:sdxl/m', downloadId: 'dl-img', modelId: 'image:sdxl', fileName: 'SDXL',
  quantization: '', modelType: 'image', status: 'running', bytesDownloaded: 30, totalBytes: 100,
  combinedTotalBytes: 100, progress: 0.3, createdAt: 1, ...over,
});

const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  setPlatform(originalOS as 'ios' | 'android');
  setImageDownloadAlertSink();
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} } as any);
  useAppStore.setState({ downloadedImageModels: [] } as any);
  useDownloadStore.getState().add(entry());
});
afterAll(() => { setPlatform(originalOS as 'ios' | 'android'); });

describe('imageProvider', () => {
  it('lists an in-flight image download (downloading), id without the image: prefix dup', async () => {
    const d = (await imageProvider.list()).find(x => x.id === 'image:sdxl');
    expect(d?.status).toBe('downloading');
    expect(d?.progress).toBe(0.3);
  });

  it('lists completed image models from appStore', async () => {
    useAppStore.setState({ downloadedImageModels: [{ id: 'other', name: 'Other', size: 500, modelPath: '/p' }] } as any);
    const done = (await imageProvider.list()).find(d => d.id === 'image:other');
    expect(done?.status).toBe('completed');
  });

  it('cancels a synthetic multi-file transfer in the service layer', async () => {
    useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} } as any);
    useDownloadStore.getState().add(entry({ downloadId: 'image-multi:sdxl' }));
    await imageProvider.cancel('image:sdxl');
    expect(useDownloadStore.getState().downloads['image:sdxl/m']).toBeUndefined();
    expect(mockBg.cancelDownload).not.toHaveBeenCalled();
  });

  it('falls back to a native cancel when no UI op is registered', async () => {
    await imageProvider.cancel('image:sdxl');
    expect(mockBg.cancelDownload).toHaveBeenCalledWith('dl-img');
  });

  it('iOS retry delegates to the service-level recovery flow', async () => {
    setPlatform('ios');
    await imageProvider.retry('image:sdxl');
    expect(mockRetryImageDownload).toHaveBeenCalledWith(expect.objectContaining({ downloadId: 'dl-img' }), expect.any(Function));
    expect(mockBg.retryDownload).not.toHaveBeenCalled();
  });

  it('Android retry: resumes the native row directly, no UI op needed', async () => {
    setPlatform('android');
    await imageProvider.retry('image:sdxl');
    expect(mockRetryImageDownload).not.toHaveBeenCalled();
    expect(mockBg.retryDownload).toHaveBeenCalledWith('dl-img');
    expect(useDownloadStore.getState().downloads['image:sdxl/m'].status).toBe('pending');
  });

  // B6: bytes finished then EXTRACTION failed (missing model files) → the native row is gone, so
  // retryDownload throws "Download not found". Retry must FALL BACK to the full re-download op, not
  // die every tap.
  it('Android retry: falls back to the full re-download op when the native row is gone', async () => {
    setPlatform('android');
    mockBg.retryDownload.mockRejectedValueOnce(new Error('Download not found'));
    await imageProvider.retry('image:sdxl');
    expect(mockBg.retryDownload).toHaveBeenCalledWith('dl-img'); // tried native resume first
    expect(mockRetryImageDownload).toHaveBeenCalledWith(expect.objectContaining({ downloadId: 'dl-img' }), expect.any(Function));
  });

  // A multi-file (synthetic `image-multi:` row) download has no resumable native row — go straight
  // to the full re-download op instead of a doomed retryDownload.
  it('Android retry: a multi-file download skips native resume and re-downloads', async () => {
    setPlatform('android');
    useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} } as any);
    useDownloadStore.getState().add(entry({ downloadId: 'image-multi:sdxl' }));
    await imageProvider.retry('image:sdxl');
    expect(mockBg.retryDownload).not.toHaveBeenCalled();
    expect(mockRetryImageDownload).toHaveBeenCalled();
  });

  it('capability.retry is a STABLE constant (does not depend on injected ops)', async () => {
    // No ops injected at all — capability must still advertise retry: true on both
    // platforms (the flag must not flap when the UI injects ops in a later effect).
    const d1 = (await imageProvider.list()).find(x => x.id === 'image:sdxl');
    expect(d1?.capabilities.retry).toBe(true);
    setImageDownloadAlertSink(jest.fn());
    const d2 = (await imageProvider.list()).find(x => x.id === 'image:sdxl');
    expect(d2?.capabilities.retry).toBe(true);
  });

  it('reconcile strands an interrupted multi-file download (no native row) as failed', async () => {
    useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} } as any);
    useDownloadStore.getState().add(entry({ downloadId: 'image-multi:sdxl', status: 'processing' }));
    await imageProvider.reconcile!();
    expect(useDownloadStore.getState().downloads['image:sdxl/m'].status).toBe('failed');
  });
});
