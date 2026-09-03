import { selectedLocalModelId } from '../utils/testHelpers';
/**
 * BATCH 4 (Image Generation) — hardening.
 *
 * device case 37: confirming the delete removes the model from the downloaded
 * list. The delete-confirmation ALERT (cases 35/36) is a thin on-device UI
 * interaction (device-owned), but the removal CHAIN that fires on confirm is
 * real, testable logic and was NOT covered by the existing imageProvider suite
 * (its docstring claims "remove" but no test drives it).
 *
 * This drives the REAL `imageProvider.remove` and asserts the full teardown:
 * cancel the native download row (if any) + drop the store entry + unload the
 * resident image model + delete the model files + remove it from the app store
 * (which also clears activeImageModelId when it was the active model — so image
 * generation is disabled after uninstall, matching case 29/38). Only genuine
 * boundaries are mocked (modelLibrary fs delete, native cancel, model unload).
 * Deleting `imageProvider.remove` would fail every assertion here.
 */
jest.mock('../../src/services/modelServices/bootstrap/modelLibraryBootstrap', () => ({
  modelLibrary: { deleteImageModel: jest.fn(async () => {}) },
}));
jest.mock('../../src/services/modelServices/modelLifecycleBootstrap', () => ({
  unloadImageModel: jest.fn(async () => {}),
}));
jest.mock('../../src/services/modelServices/coordinatedDownloadBridge', () => ({
  coordinatedDownloads: {
    cancelDownload: jest.fn(async () => {}),
    cancelQueued: jest.fn(() => false),
    getActiveDownloads: jest.fn(async () => []),
    retryDownload: jest.fn(async () => {}),
    startProgressPolling: jest.fn(),
  },
}));
jest.mock('../../src/utils/logger', () => ({
  __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { imageProvider } from '../../src/services/adapters/downloads/imageDownloadAdapter';
import { useDownloadStore } from '../../src/stores/downloadStore';
import { useAppStore } from '../../src/stores';
import { modelLibrary } from '../../src/services/modelServices/bootstrap/modelLibraryBootstrap';
import { unloadImageModel } from '../../src/services/modelServices/modelLifecycleBootstrap';
import { coordinatedDownloads as backgroundDownloadService } from '../../src/services/modelServices/coordinatedDownloadBridge';

const mockDelete = modelLibrary.deleteImageModel as jest.Mock;
const mockUnload = unloadImageModel as jest.Mock;
const mockCancel = backgroundDownloadService.cancelDownload as jest.Mock;

const downloadedModel = (id: string) => ({ id, name: id.toUpperCase(), size: 500, modelPath: `/models/${id}` }) as any;

beforeEach(() => {
  jest.clearAllMocks();
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} } as any);
  useAppStore.setState({ downloadedImageModels: [], activeImageModelId: null } as any);
});

describe('imageProvider.remove — uninstall chain (case 37)', () => {
  it('removes a fully-downloaded model from the store and deletes its files', async () => {
    useAppStore.setState({ downloadedImageModels: [downloadedModel('sdxl')] } as any);

    await imageProvider.remove('image:sdxl');

    expect(mockDelete).toHaveBeenCalledWith('sdxl');
    expect(useAppStore.getState().downloadedImageModels.find((m: any) => m.id === 'sdxl')).toBeUndefined();
    // No in-flight row existed, so no native cancel needed.
    expect(mockCancel).not.toHaveBeenCalled();
    // A package that is not selected has no resident runtime to release.
    expect(mockUnload).not.toHaveBeenCalled();
  });

  it('uninstalling the ACTIVE model clears activeImageModelId (disables image gen — cases 29/38)', async () => {
    useAppStore.setState({
      downloadedImageModels: [downloadedModel('sdxl')],
      activeImageModelId: 'sdxl',
    } as any);

    await imageProvider.remove('image:sdxl');

    expect(selectedLocalModelId('image')).toBeNull();
    expect(mockUnload).toHaveBeenCalled();
  });

  it('cancels the native download row and drops the store entry when a download is still in-flight', async () => {
    useDownloadStore.getState().add({
      modelKey: 'image:sdxl/m', downloadId: 'dl-9', modelId: 'image:sdxl', fileName: 'SDXL',
      quantization: '', modelType: 'image', status: 'running', bytesDownloaded: 30, totalBytes: 100,
      combinedTotalBytes: 100, progress: 0.3, createdAt: 1,
    } as any);

    await imageProvider.remove('image:sdxl');

    expect(mockCancel).toHaveBeenCalledWith('dl-9');
    expect(useDownloadStore.getState().downloads['image:sdxl/m']).toBeUndefined();
    // There is no durable package yet, so cancellation must not invoke package deletion.
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('still deletes files and removes from store even when the native unload fails (best-effort teardown)', async () => {
    useAppStore.setState({ downloadedImageModels: [downloadedModel('sdxl')], activeImageModelId: 'sdxl' } as any);
    mockUnload.mockRejectedValueOnce(new Error('unload boom'));

    // Must not throw — the removal completes despite the unload failure.
    await expect(imageProvider.remove('image:sdxl')).resolves.toBeUndefined();

    expect(mockDelete).toHaveBeenCalledWith('sdxl');
    expect(useAppStore.getState().downloadedImageModels).toHaveLength(0);
    expect(selectedLocalModelId('image')).toBeNull();
  });
});
