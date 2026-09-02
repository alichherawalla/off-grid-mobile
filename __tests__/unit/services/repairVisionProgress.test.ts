/**
 * Repair-Vision Progress Tests
 *
 * BUG OD2: the "Repair Vision" action re-downloads a model's missing mmproj
 * (~900MB) but showed only an indeterminate spinner. It must drive the SAME
 * determinate-progress store the normal download uses, so the existing
 * progress-bar UI (ActiveDownloadCard) lights up.
 *
 * These tests drive the REAL useDownloadStore and assert the store entry's
 * `progress` advances incrementally (0 -> mid -> complete), mocking only the
 * boundaries (backgroundDownloadService + RNFS). The onProgress callback is
 * captured DYNAMICALLY so we can fire per-byte events and prove the store
 * updates between them, not just a terminal done.
 */

import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { coordinatedDownloads as backgroundDownloadService } from '../../../src/services/modelServices/coordinatedDownloadBridge';
import { useDownloadStore } from '../../../src/stores/downloadStore';
import { createModelFileWithMmProj } from '../../utils/factories';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

let mockManifestListener: ((event: any) => void) | null = null;
let mockResolveManifest: ((result: { success: boolean; error?: string }) => void) | null = null;
let mockManifestCompletion: Promise<{ success: boolean; error?: string }>;

jest.mock('../../../src/services/modelServices/coordinatedDownloadBridge', () => ({
  coordinatedDownloads: {
    isAvailable: jest.fn(() => true),
    startManifest: jest.fn((manifest: any) => ({
      downloadId: 'repair-1',
      handle: {
        id: manifest.id,
        admitted: Promise.resolve(null),
        completion: mockManifestCompletion,
        subscribe: (listener: (event: any) => void) => {
          mockManifestListener = listener;
          return jest.fn();
        },
        cancel: jest.fn(async () => true),
      },
    })),
    startDownload: jest.fn(),
    cancelDownload: jest.fn(() => Promise.resolve()),
    moveCompletedDownload: jest.fn(),
    startProgressPolling: jest.fn(),
    stopProgressPolling: jest.fn(),
    onProgress: jest.fn(() => jest.fn()),
    onComplete: jest.fn(() => jest.fn()),
    onError: jest.fn(() => jest.fn()),
    excludeFromBackup: jest.fn(() => Promise.resolve(true)),
  },
}));

const mockService = backgroundDownloadService as jest.Mocked<
  typeof backgroundDownloadService
>;

const REPO = 'test/model';
const MODEL_NAME = 'vision-Q4_K_M.gguf';
const MMPROJ_SIZE = 900_000_000; // ~900MB, the OD2 case

function visionFile() {
  return createModelFileWithMmProj({
    name: MODEL_NAME,
    size: 4_000_000_000,
    quantization: 'Q4_K_M',
    mmProjName: 'mmproj-model-f16.gguf',
    mmProjSize: MMPROJ_SIZE,
    mmProjDownloadUrl:
      'https://huggingface.co/test/model/resolve/main/mmproj-model-f16.gguf',
  });
}

describe('repairMmProj — determinate progress (BUG OD2)', () => {
  // The modelKey the completed model carries and the store keys on.
  const MODEL_KEY = `${REPO}/${MODEL_NAME}`;

  beforeEach(() => {
    jest.clearAllMocks();
    mockManifestListener = null;
    mockManifestCompletion = new Promise(resolve => {
      mockResolveManifest = resolve;
    });
    // Fresh store between tests.
    useDownloadStore.setState({
      downloads: {},
      downloadIdIndex: {},
      repairingVisionIds: {},
    });

    // The repair path preserves the installed primary model and replaces only
    // its missing projector. Model the filesystem boundary with that real
    // precondition instead of reporting that every artifact is absent.
    mockedRNFS.exists.mockImplementation(path =>
      Promise.resolve(String(path).endsWith(`/${MODEL_NAME}`)),
    );
    mockedRNFS.stat.mockResolvedValue({ size: MMPROJ_SIZE } as any);
    mockedRNFS.unlink.mockResolvedValue(undefined as any);
    mockedAsyncStorage.getItem.mockResolvedValue(
      JSON.stringify([
        { id: MODEL_KEY, engine: 'llama', fileName: MODEL_NAME },
      ]),
    );
    mockedAsyncStorage.setItem.mockResolvedValue(undefined as any);

    mockService.startDownload.mockResolvedValue({
      downloadId: 'repair-1',
      fileName: 'mmproj-model-f16.gguf',
      modelId: REPO,
      status: 'pending',
      bytesDownloaded: 0,
      totalBytes: MMPROJ_SIZE,
      startedAt: Date.now(),
    } as any);
    mockService.moveCompletedDownload.mockResolvedValue(
      `/models/${MODEL_NAME.replace('.gguf', '')}-mmproj-model-f16.gguf`,
    );
  });

  it('drives the download store incrementally (0 -> mid -> complete), not just a terminal done', async () => {
    const { modelLibrary } = require('../../../src/services/modelServices/bootstrap/modelLibraryBootstrap');

    const repairPromise = modelLibrary.repairMmProj(REPO, visionFile(), {});

    // Give startDownload + listener registration a tick.
    await new Promise(r => setImmediate(r));

    // The store must now hold an active entry for this model so the UI's
    // ActiveDownloadCard progress bar can render.
    const started = useDownloadStore.getState().downloads[MODEL_KEY];
    expect(started).toBeDefined();
    expect(started.progress).toBe(0);

    // Fire a MID progress event over the boundary.
    mockManifestListener?.({
      type: 'progress',
      operationId: 'repair-1',
      artifactId: 'repair-1:projector-artifact',
      bytesDownloaded: MMPROJ_SIZE / 2,
      totalBytes: MMPROJ_SIZE,
    });
    const mid = useDownloadStore.getState().downloads[MODEL_KEY];
    expect(mid.progress).toBeGreaterThan(started.progress);
    expect(mid.progress).toBeLessThan(1);

    // Fire a near-complete progress event.
    mockManifestListener?.({
      type: 'progress',
      operationId: 'repair-1',
      artifactId: 'repair-1:projector-artifact',
      bytesDownloaded: MMPROJ_SIZE * 0.9,
      totalBytes: MMPROJ_SIZE,
    });
    expect(useDownloadStore.getState().downloads[MODEL_KEY].progress).toBeGreaterThan(
      mid.progress,
    );

    // Completion.
    mockedRNFS.exists.mockResolvedValue(true);
    mockResolveManifest?.({ success: true });
    await repairPromise;
  });

  it('reports failure through the store when the download errors', async () => {
    const { modelLibrary } = require('../../../src/services/modelServices/bootstrap/modelLibraryBootstrap');

    const repairPromise = modelLibrary.repairMmProj(REPO, visionFile(), {});
    await new Promise(r => setImmediate(r));

    expect(useDownloadStore.getState().downloads[MODEL_KEY]).toBeDefined();

    mockManifestListener?.({
      type: 'failed',
      operationId: 'repair-1',
      artifactId: 'repair-1:projector-artifact',
      error: 'Network error',
    });
    mockResolveManifest?.({ success: false, error: 'Network error' });

    await expect(repairPromise).rejects.toThrow('Network error');
  });
});
