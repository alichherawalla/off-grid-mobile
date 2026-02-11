/**
 * ModelManager Unit Tests
 *
 * Tests for model download, storage, deletion, and background download management.
 * Priority: P0 (Critical) - Model lifecycle management.
 */

import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { modelManager } from '../../../src/services/modelManager';
import { backgroundDownloadService } from '../../../src/services/backgroundDownloadService';
import { huggingFaceService } from '../../../src/services/huggingface';
import { createModelFile, createModelFileWithMmProj } from '../../utils/factories';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

// Mock huggingFaceService
jest.mock('../../../src/services/huggingface', () => ({
  huggingFaceService: {
    getDownloadUrl: jest.fn((modelId: string, fileName: string) =>
      `https://huggingface.co/${modelId}/resolve/main/${fileName}`
    ),
  },
}));

// Mock backgroundDownloadService
jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    isAvailable: jest.fn(() => false),
    startDownload: jest.fn(),
    cancelDownload: jest.fn(),
    getActiveDownloads: jest.fn(() => Promise.resolve([])),
    moveCompletedDownload: jest.fn(),
    startProgressPolling: jest.fn(),
    stopProgressPolling: jest.fn(),
    onProgress: jest.fn(() => jest.fn()),
    onComplete: jest.fn(() => jest.fn()),
    onError: jest.fn(() => jest.fn()),
  },
}));

const mockedBackgroundDownloadService = backgroundDownloadService as jest.Mocked<typeof backgroundDownloadService>;

const MODELS_STORAGE_KEY = '@local_llm/downloaded_models';

describe('ModelManager', () => {
  beforeEach(() => {
    jest.resetAllMocks();

    // Reset private state
    (modelManager as any).downloadJobs = new Map();
    (modelManager as any).backgroundDownloadMetadataCallback = null;

    // Re-establish huggingFaceService mock (resetAllMocks clears jest.mock implementations)
    (huggingFaceService.getDownloadUrl as jest.Mock).mockImplementation(
      (modelId: string, fileName: string) =>
        `https://huggingface.co/${modelId}/resolve/main/${fileName}`
    );

    // Default RNFS behaviors
    mockedRNFS.exists.mockResolvedValue(false);
    mockedRNFS.mkdir.mockResolvedValue(undefined as any);
    mockedRNFS.stat.mockResolvedValue({ size: 4000000000, isFile: () => true } as any);
    mockedRNFS.unlink.mockResolvedValue(undefined as any);
    mockedRNFS.readDir.mockResolvedValue([]);
    mockedRNFS.downloadFile.mockReturnValue({
      jobId: 1,
      promise: Promise.resolve({ statusCode: 200, bytesWritten: 1000 }),
    } as any);
    (mockedRNFS as any).stopDownload = jest.fn();
    (mockedRNFS as any).copyFile = jest.fn(() => Promise.resolve());
    (mockedRNFS as any).moveFile = jest.fn(() => Promise.resolve());

    // Reset backgroundDownloadService mock implementations
    mockedBackgroundDownloadService.isAvailable.mockReturnValue(false);
    mockedBackgroundDownloadService.startDownload.mockResolvedValue({} as any);
    mockedBackgroundDownloadService.cancelDownload.mockResolvedValue(undefined as any);
    mockedBackgroundDownloadService.getActiveDownloads.mockResolvedValue([]);
    mockedBackgroundDownloadService.moveCompletedDownload.mockResolvedValue('' as any);
    mockedBackgroundDownloadService.startProgressPolling.mockImplementation(() => {});
    mockedBackgroundDownloadService.stopProgressPolling.mockImplementation(() => {});
    mockedBackgroundDownloadService.onProgress.mockReturnValue(jest.fn());
    mockedBackgroundDownloadService.onComplete.mockReturnValue(jest.fn());
    mockedBackgroundDownloadService.onError.mockReturnValue(jest.fn());

    // Reset AsyncStorage defaults
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    mockedAsyncStorage.setItem.mockResolvedValue(undefined as any);
  });

  // ========================================================================
  // initialize
  // ========================================================================
  describe('initialize', () => {
    it('creates models directories when they do not exist', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      await modelManager.initialize();

      expect(RNFS.mkdir).toHaveBeenCalledTimes(2);
    });

    it('does not create dirs when they already exist', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      await modelManager.initialize();

      expect(RNFS.mkdir).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // getDownloadedModels
  // ========================================================================
  describe('getDownloadedModels', () => {
    it('returns empty array when nothing stored', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue(null);

      const models = await modelManager.getDownloadedModels();

      expect(models).toEqual([]);
    });

    it('returns stored models that exist on disk', async () => {
      const storedModels = [
        { id: 'model1', name: 'Model 1', filePath: '/models/m1.gguf', fileSize: 100 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);

      const models = await modelManager.getDownloadedModels();

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('model1');
    });

    it('filters out models whose files no longer exist', async () => {
      const storedModels = [
        { id: 'exists', name: 'Exists', filePath: '/models/exists.gguf', fileSize: 100 },
        { id: 'gone', name: 'Gone', filePath: '/models/gone.gguf', fileSize: 100 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // exists.gguf
        .mockResolvedValueOnce(false); // gone.gguf

      const models = await modelManager.getDownloadedModels();

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('exists');
    });

    it('updates storage when invalid entries are removed', async () => {
      const storedModels = [
        { id: 'exists', name: 'Exists', filePath: '/models/exists.gguf', fileSize: 100 },
        { id: 'gone', name: 'Gone', filePath: '/models/gone.gguf', fileSize: 100 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await modelManager.getDownloadedModels();

      // Should save updated list (only the existing model)
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        MODELS_STORAGE_KEY,
        expect.stringContaining('exists')
      );
    });

    it('returns empty array on parse error', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue('invalid json{{{');

      const models = await modelManager.getDownloadedModels();

      expect(models).toEqual([]);
    });
  });

  // ========================================================================
  // downloadModel
  // ========================================================================
  describe('downloadModel', () => {
    const file = createModelFile({
      name: 'test-model-q4.gguf',
      size: 4000000000,
      quantization: 'Q4_K_M',
      downloadUrl: 'https://huggingface.co/test/model/resolve/main/test-model-q4.gguf',
    });

    it('throws when already downloading', async () => {
      // Simulate an active download
      (modelManager as any).downloadJobs.set('test-author/test-model/test-model-q4.gguf', {
        jobId: 1,
        cancel: jest.fn(),
      });

      await expect(
        modelManager.downloadModel('test-author/test-model', file)
      ).rejects.toThrow('already being downloaded');
    });

    it('skips download when files already exist', async () => {
      mockedRNFS.exists.mockResolvedValue(true); // All exists checks return true
      // Mock getDownloadedModels for addDownloadedModel
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const onComplete = jest.fn();
      await modelManager.downloadModel('test-author/test-model', file, undefined, onComplete);

      expect(RNFS.downloadFile).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalled();
    });

    it('downloads via RNFS when file does not exist', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // initialize: modelsDir exists
        .mockResolvedValueOnce(true)   // initialize: imageModelsDir exists
        .mockResolvedValueOnce(false)  // mainExists = false
        .mockResolvedValueOnce(true);  // mmProjExists (no mmproj, so vacuously true isn't called - but model needs to be added)

      mockedRNFS.downloadFile.mockReturnValue({
        jobId: 1,
        promise: Promise.resolve({ statusCode: 200, bytesWritten: 4000000000 }),
      } as any);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');
      // For the addDownloadedModel -> getDownloadedModels -> exists checks
      // After download, RNFS.exists will be called to check mmProjLocalPath
      mockedRNFS.exists.mockResolvedValue(false);

      await modelManager.downloadModel('test-author/test-model', file);

      expect(RNFS.downloadFile).toHaveBeenCalled();
    });

    it('reports progress via callback', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false)  // main file doesn't exist
        .mockResolvedValue(false);     // remaining checks

      let capturedProgressFn: any;
      mockedRNFS.downloadFile.mockImplementation((opts: any) => {
        capturedProgressFn = opts.progress;
        return {
          jobId: 1,
          promise: Promise.resolve({ statusCode: 200, bytesWritten: 4000000000 }),
        } as any;
      });
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const onProgress = jest.fn();
      await modelManager.downloadModel('test-author/test-model', file, onProgress);

      // Simulate progress callback
      if (capturedProgressFn) {
        capturedProgressFn({ bytesWritten: 2000000000 });
        expect(onProgress).toHaveBeenCalledWith(
          expect.objectContaining({
            bytesDownloaded: 2000000000,
            totalBytes: 4000000000,
          })
        );
      }
    });

    it('cleans up on non-200 status', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false)  // main doesn't exist
        .mockResolvedValue(false);

      mockedRNFS.downloadFile.mockReturnValue({
        jobId: 1,
        promise: Promise.resolve({ statusCode: 500, bytesWritten: 0 }),
      } as any);

      await expect(
        modelManager.downloadModel('test-author/test-model', file)
      ).rejects.toThrow('download failed');

      expect(RNFS.unlink).toHaveBeenCalled();
    });

    it('downloads mmproj file when present', async () => {
      const visionFile = createModelFileWithMmProj({
        name: 'vision-model.gguf',
        size: 4000000000,
        mmProjName: 'mmproj-vision.gguf',
        mmProjSize: 500000000,
      });

      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false)  // main doesn't exist
        .mockResolvedValueOnce(false)  // mmproj doesn't exist
        .mockResolvedValue(false);     // remaining checks

      mockedRNFS.downloadFile.mockReturnValue({
        jobId: 1,
        promise: Promise.resolve({ statusCode: 200, bytesWritten: 4000000000 }),
      } as any);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      await modelManager.downloadModel('test-author/test-model', visionFile);

      // Should have two downloadFile calls (main + mmproj)
      expect(RNFS.downloadFile).toHaveBeenCalledTimes(2);
    });

    it('continues without mmproj on mmproj download failure', async () => {
      const visionFile = createModelFileWithMmProj({
        name: 'vision-model.gguf',
        size: 4000000000,
        mmProjName: 'mmproj-vision.gguf',
        mmProjSize: 500000000,
      });

      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false)  // main doesn't exist
        .mockResolvedValueOnce(false)  // mmproj doesn't exist
        .mockResolvedValue(false);

      // Main succeeds, mmproj fails
      mockedRNFS.downloadFile
        .mockReturnValueOnce({
          jobId: 1,
          promise: Promise.resolve({ statusCode: 200, bytesWritten: 4000000000 }),
        } as any)
        .mockReturnValueOnce({
          jobId: 2,
          promise: Promise.resolve({ statusCode: 500, bytesWritten: 0 }),
        } as any);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const onComplete = jest.fn();
      // Should not throw - mmproj failure is not fatal
      await modelManager.downloadModel('test-author/test-model', visionFile, undefined, onComplete);

      expect(onComplete).toHaveBeenCalled();
    });

    it('calls onComplete with model when done', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false)  // main doesn't exist
        .mockResolvedValue(false);

      mockedRNFS.downloadFile.mockReturnValue({
        jobId: 1,
        promise: Promise.resolve({ statusCode: 200, bytesWritten: 4000000000 }),
      } as any);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const onComplete = jest.fn();
      await modelManager.downloadModel('test-author/test-model', file, undefined, onComplete);

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'test-model-q4.gguf',
          quantization: 'Q4_K_M',
        })
      );
    });
  });

  // ========================================================================
  // cancelDownload
  // ========================================================================
  describe('cancelDownload', () => {
    it('cancels active download job', async () => {
      const cancelFn = jest.fn();
      (modelManager as any).downloadJobs.set('test-model/test-file.gguf', {
        jobId: 1,
        cancel: cancelFn,
      });

      await modelManager.cancelDownload('test-model', 'test-file.gguf');

      expect(cancelFn).toHaveBeenCalled();
    });

    it('cleans up partial file', async () => {
      (modelManager as any).downloadJobs.set('test-model/test-file.gguf', {
        jobId: 1,
        cancel: jest.fn(),
      });

      await modelManager.cancelDownload('test-model', 'test-file.gguf');

      expect(RNFS.unlink).toHaveBeenCalled();
    });

    it('does nothing when no active download for key', async () => {
      await modelManager.cancelDownload('nonexistent', 'file.gguf');

      expect(RNFS.unlink).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // deleteModel
  // ========================================================================
  describe('deleteModel', () => {
    it('deletes file and updates storage', async () => {
      const storedModels = [
        { id: 'model1', name: 'Model 1', filePath: '/models/m1.gguf', fileSize: 100 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);

      await modelManager.deleteModel('model1');

      expect(RNFS.unlink).toHaveBeenCalledWith('/models/m1.gguf');
      // Storage should be updated with empty list
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        MODELS_STORAGE_KEY,
        '[]'
      );
    });

    it('also deletes mmproj file when present', async () => {
      const storedModels = [
        {
          id: 'model1',
          name: 'Model 1',
          filePath: '/models/m1.gguf',
          fileSize: 100,
          mmProjPath: '/models/mmproj.gguf',
        },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);

      await modelManager.deleteModel('model1');

      expect(RNFS.unlink).toHaveBeenCalledWith('/models/m1.gguf');
      expect(RNFS.unlink).toHaveBeenCalledWith('/models/mmproj.gguf');
    });

    it('throws when model not found', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      await expect(modelManager.deleteModel('nonexistent')).rejects.toThrow('Model not found');
    });
  });

  // ========================================================================
  // getModelPath
  // ========================================================================
  describe('getModelPath', () => {
    it('returns path for existing model', async () => {
      const storedModels = [
        { id: 'model1', name: 'Model 1', filePath: '/models/m1.gguf', fileSize: 100 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);

      const path = await modelManager.getModelPath('model1');
      expect(path).toBe('/models/m1.gguf');
    });

    it('returns null for missing model', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const path = await modelManager.getModelPath('nonexistent');
      expect(path).toBeNull();
    });
  });

  // ========================================================================
  // getStorageUsed
  // ========================================================================
  describe('getStorageUsed', () => {
    it('sums all model file sizes including mmproj', async () => {
      const storedModels = [
        { id: 'm1', filePath: '/m1.gguf', fileSize: 1000, mmProjFileSize: 200 },
        { id: 'm2', filePath: '/m2.gguf', fileSize: 2000 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);

      const used = await modelManager.getStorageUsed();

      expect(used).toBe(3200); // 1000 + 200 + 2000
    });

    it('returns 0 when no models', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const used = await modelManager.getStorageUsed();
      expect(used).toBe(0);
    });
  });

  // ========================================================================
  // getAvailableStorage
  // ========================================================================
  describe('getAvailableStorage', () => {
    it('returns free space from RNFS', async () => {
      (RNFS as any).getFSInfo = jest.fn(() => Promise.resolve({
        freeSpace: 50 * 1024 * 1024 * 1024,
        totalSpace: 128 * 1024 * 1024 * 1024,
      }));

      const available = await modelManager.getAvailableStorage();

      expect(available).toBe(50 * 1024 * 1024 * 1024);
    });
  });

  // ========================================================================
  // getOrphanedFiles
  // ========================================================================
  describe('getOrphanedFiles', () => {
    it('finds untracked GGUF files', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir
        .mockResolvedValueOnce([
          { name: 'orphan.gguf', path: '/models/orphan.gguf', size: 5000, isFile: () => true, isDirectory: () => false } as any,
        ])
        .mockResolvedValueOnce([]); // image models dir empty
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const orphaned = await modelManager.getOrphanedFiles();

      expect(orphaned).toHaveLength(1);
      expect(orphaned[0].name).toBe('orphan.gguf');
    });

    it('excludes tracked files', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir
        .mockResolvedValueOnce([
          { name: 'tracked.gguf', path: '/models/tracked.gguf', size: 5000, isFile: () => true, isDirectory: () => false } as any,
        ])
        .mockResolvedValueOnce([]); // image models dir empty
      const storedModels = [{ id: 'm1', filePath: '/models/tracked.gguf', fileSize: 5000 }];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));

      const orphaned = await modelManager.getOrphanedFiles();

      expect(orphaned).toHaveLength(0);
    });

    it('returns empty array when directory is empty', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const orphaned = await modelManager.getOrphanedFiles();

      expect(orphaned).toEqual([]);
    });

    it('finds orphaned image model directories', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir
        .mockResolvedValueOnce([]) // text models dir empty
        .mockResolvedValueOnce([
          { name: 'anythingv5_cpu', path: '/image_models/anythingv5_cpu', size: 0, isFile: () => false, isDirectory: () => true } as any,
        ])
        .mockResolvedValueOnce([ // contents of orphaned image model dir
          { name: 'model.onnx', path: '/image_models/anythingv5_cpu/model.onnx', size: 500000, isFile: () => true, isDirectory: () => false } as any,
        ]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const orphaned = await modelManager.getOrphanedFiles();

      expect(orphaned).toHaveLength(1);
      expect(orphaned[0].name).toBe('anythingv5_cpu');
      expect(orphaned[0].size).toBe(500000);
    });
  });

  // ========================================================================
  // determineCredibility (private, tested via downloadModel -> addDownloadedModel)
  // ========================================================================
  describe('determineCredibility', () => {
    // Access private method
    const determineCredibility = (author: string) =>
      (modelManager as any).determineCredibility(author);

    it('recognizes lmstudio-community source', () => {
      const result = determineCredibility('lmstudio-community');
      expect(result.source).toBe('lmstudio');
      expect(result.isVerifiedQuantizer).toBe(true);
    });

    it('recognizes official model authors', () => {
      const result = determineCredibility('meta-llama');
      expect(result.source).toBe('official');
      expect(result.isOfficial).toBe(true);
    });

    it('recognizes verified quantizers', () => {
      const result = determineCredibility('TheBloke');
      expect(result.source).toBe('verified-quantizer');
      expect(result.isVerifiedQuantizer).toBe(true);
    });

    it('defaults to community for unknown authors', () => {
      const result = determineCredibility('random-user');
      expect(result.source).toBe('community');
      expect(result.isOfficial).toBe(false);
      expect(result.isVerifiedQuantizer).toBe(false);
    });
  });

  // ========================================================================
  // downloadModelBackground
  // ========================================================================
  describe('downloadModelBackground', () => {
    const file = createModelFile({
      name: 'bg-model.gguf',
      size: 8000000000,
      quantization: 'Q4_K_M',
    });

    it('throws when not supported', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(false);

      await expect(
        modelManager.downloadModelBackground('test/model', file)
      ).rejects.toThrow('Background downloads not supported');
    });

    it('skips download when files already exist', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists.mockResolvedValue(true);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const onComplete = jest.fn();
      const result = await modelManager.downloadModelBackground('test/model', file, undefined, onComplete);

      expect(result.status).toBe('completed');
      expect(onComplete).toHaveBeenCalled();
      expect(mockedBackgroundDownloadService.startDownload).not.toHaveBeenCalled();
    });

    it('starts background download for main model', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false)  // main doesn't exist
        .mockResolvedValueOnce(true);  // mmProjExists (no mmproj)

      mockedBackgroundDownloadService.startDownload.mockResolvedValue({
        downloadId: 42,
        fileName: 'bg-model.gguf',
        modelId: 'test/model',
        status: 'pending',
        bytesDownloaded: 0,
        totalBytes: 8000000000,
        startedAt: Date.now(),
      } as any);

      const result = await modelManager.downloadModelBackground('test/model', file);

      expect(mockedBackgroundDownloadService.startDownload).toHaveBeenCalled();
      expect(result.downloadId).toBe(42);
    });

    it('sets up progress/complete/error listeners', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      mockedBackgroundDownloadService.startDownload.mockResolvedValue({
        downloadId: 42,
        fileName: 'bg-model.gguf',
        modelId: 'test/model',
        status: 'pending',
        bytesDownloaded: 0,
        totalBytes: 8000000000,
        startedAt: Date.now(),
      } as any);

      await modelManager.downloadModelBackground('test/model', file);

      expect(mockedBackgroundDownloadService.onProgress).toHaveBeenCalledWith(42, expect.any(Function));
      expect(mockedBackgroundDownloadService.onComplete).toHaveBeenCalledWith(42, expect.any(Function));
      expect(mockedBackgroundDownloadService.onError).toHaveBeenCalledWith(42, expect.any(Function));
    });

    it('calls metadata callback with download info', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      mockedBackgroundDownloadService.startDownload.mockResolvedValue({
        downloadId: 42,
        fileName: 'bg-model.gguf',
        modelId: 'test/model',
        status: 'pending',
        bytesDownloaded: 0,
        totalBytes: 8000000000,
        startedAt: Date.now(),
      } as any);

      const metadataCallback = jest.fn();
      modelManager.setBackgroundDownloadMetadataCallback(metadataCallback);

      await modelManager.downloadModelBackground('test/model', file);

      expect(metadataCallback).toHaveBeenCalledWith(42, expect.objectContaining({
        modelId: 'test/model',
        fileName: 'bg-model.gguf',
      }));
    });

    it('downloads mmproj via foreground first when present', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);

      const visionFile = createModelFileWithMmProj({
        name: 'vision.gguf',
        size: 4000000000,
        mmProjName: 'mmproj.gguf',
        mmProjSize: 500000000,
      });

      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false)  // main doesn't exist
        .mockResolvedValueOnce(false); // mmproj doesn't exist

      // mmproj foreground download
      mockedRNFS.downloadFile.mockReturnValue({
        jobId: 1,
        promise: Promise.resolve({ statusCode: 200, bytesWritten: 500000000 }),
      } as any);

      mockedBackgroundDownloadService.startDownload.mockResolvedValue({
        downloadId: 42,
        fileName: 'vision.gguf',
        modelId: 'test/model',
        status: 'pending',
        bytesDownloaded: 0,
        totalBytes: 4000000000,
        startedAt: Date.now(),
      } as any);

      await modelManager.downloadModelBackground('test/model', visionFile);

      // mmproj should be downloaded via RNFS (foreground)
      expect(RNFS.downloadFile).toHaveBeenCalled();
      // Main model via background
      expect(mockedBackgroundDownloadService.startDownload).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // syncBackgroundDownloads
  // ========================================================================
  describe('syncBackgroundDownloads', () => {
    it('returns empty when not supported', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(false);

      const result = await modelManager.syncBackgroundDownloads({}, jest.fn());

      expect(result).toEqual([]);
    });

    it('processes completed downloads', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists.mockResolvedValue(true); // dirs exist
      mockedBackgroundDownloadService.getActiveDownloads.mockResolvedValue([
        {
          downloadId: 1,
          fileName: 'model.gguf',
          modelId: 'test/model',
          status: 'completed',
          bytesDownloaded: 4000,
          totalBytes: 4000,
          startedAt: 12345,
        } as any,
      ]);
      mockedBackgroundDownloadService.moveCompletedDownload.mockResolvedValue('/models/model.gguf');
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const clearCb = jest.fn();
      const result = await modelManager.syncBackgroundDownloads(
        {
          1: {
            modelId: 'test/model',
            fileName: 'model.gguf',
            quantization: 'Q4_K_M',
            author: 'test',
            totalBytes: 4000,
          },
        },
        clearCb
      );

      expect(result).toHaveLength(1);
      expect(clearCb).toHaveBeenCalledWith(1);
    });

    it('clears failed downloads', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists.mockResolvedValue(true);
      mockedBackgroundDownloadService.getActiveDownloads.mockResolvedValue([
        {
          downloadId: 2,
          fileName: 'failed.gguf',
          modelId: 'test/failed',
          status: 'failed',
          bytesDownloaded: 100,
          totalBytes: 4000,
          startedAt: 12345,
        } as any,
      ]);

      const clearCb = jest.fn();
      await modelManager.syncBackgroundDownloads(
        {
          2: {
            modelId: 'test/failed',
            fileName: 'failed.gguf',
            quantization: 'Q4_K_M',
            author: 'test',
            totalBytes: 4000,
          },
        },
        clearCb
      );

      expect(clearCb).toHaveBeenCalledWith(2);
    });

    it('skips downloads with no metadata', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists.mockResolvedValue(true);
      mockedBackgroundDownloadService.getActiveDownloads.mockResolvedValue([
        {
          downloadId: 99,
          fileName: 'unknown.gguf',
          modelId: 'unknown',
          status: 'completed',
          bytesDownloaded: 4000,
          totalBytes: 4000,
          startedAt: 12345,
        } as any,
      ]);

      const clearCb = jest.fn();
      const result = await modelManager.syncBackgroundDownloads({}, clearCb);

      // No metadata for downloadId 99, so it's skipped
      expect(result).toHaveLength(0);
      expect(clearCb).not.toHaveBeenCalled();
    });

    it('leaves running downloads as-is', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists.mockResolvedValue(true);
      mockedBackgroundDownloadService.getActiveDownloads.mockResolvedValue([
        {
          downloadId: 3,
          fileName: 'running.gguf',
          modelId: 'test/running',
          status: 'running',
          bytesDownloaded: 2000,
          totalBytes: 4000,
          startedAt: 12345,
        } as any,
      ]);

      const clearCb = jest.fn();
      const result = await modelManager.syncBackgroundDownloads(
        {
          3: {
            modelId: 'test/running',
            fileName: 'running.gguf',
            quantization: 'Q4_K_M',
            author: 'test',
            totalBytes: 4000,
          },
        },
        clearCb
      );

      expect(result).toHaveLength(0);
      expect(clearCb).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // scanForUntrackedTextModels
  // ========================================================================
  describe('scanForUntrackedTextModels', () => {
    it('discovers untracked GGUF files', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([
        {
          name: 'untracked-Q4_K_M.gguf',
          path: '/models/untracked-Q4_K_M.gguf',
          size: 4000000000,
          isFile: () => true,
          isDirectory: () => false,
        } as any,
      ]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedTextModels();

      expect(discovered).toHaveLength(1);
      expect(discovered[0].fileName).toBe('untracked-Q4_K_M.gguf');
      expect(discovered[0].quantization).toBe('Q4_K_M');
    });

    it('skips mmproj files', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([
        {
          name: 'model-mmproj-f16.gguf',
          path: '/models/model-mmproj-f16.gguf',
          size: 500000000,
          isFile: () => true,
          isDirectory: () => false,
        } as any,
      ]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedTextModels();

      expect(discovered).toHaveLength(0);
    });

    it('parses quantization from filename', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([
        {
          name: 'llama-7b-Q8_0.gguf',
          path: '/models/llama-7b-Q8_0.gguf',
          size: 7000000000,
          isFile: () => true,
          isDirectory: () => false,
        } as any,
      ]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedTextModels();

      expect(discovered[0].quantization).toBe('Q8_0');
    });

    it('returns empty when directory is empty', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedTextModels();

      expect(discovered).toEqual([]);
    });
  });

  // ========================================================================
  // scanForUntrackedImageModels
  // ========================================================================
  describe('scanForUntrackedImageModels', () => {
    const IMAGE_MODELS_KEY = '@local_llm/downloaded_image_models';

    it('discovers untracked model directories', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      // readDir is called for:
      // 1. imageModelsDir listing (the scan itself)
      // 2. files inside the discovered model dir
      mockedRNFS.readDir.mockImplementation((dir: string) => {
        if (dir.includes('image_models') && !dir.includes('sd-turbo-mnn')) {
          return Promise.resolve([
            {
              name: 'sd-turbo-mnn',
              path: '/mock/documents/image_models/sd-turbo-mnn',
              size: 0,
              isFile: () => false,
              isDirectory: () => true,
            } as any,
          ]);
        }
        if (dir.includes('sd-turbo-mnn')) {
          return Promise.resolve([
            {
              name: 'model.onnx',
              path: '/mock/documents/image_models/sd-turbo-mnn/model.onnx',
              size: 2000000000,
              isFile: () => true,
              isDirectory: () => false,
            } as any,
          ]);
        }
        return Promise.resolve([]);
      });

      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedImageModels();

      expect(discovered).toHaveLength(1);
      expect(discovered[0].name).toContain('sd-turbo-mnn');
    });

    it('determines backend from directory name', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir
        .mockResolvedValueOnce([
          {
            name: 'model-qnn-8gen3',
            path: '/mock/documents/image_models/model-qnn-8gen3',
            size: 0,
            isFile: () => false,
            isDirectory: () => true,
          } as any,
        ])
        .mockResolvedValueOnce([
          {
            name: 'model.bin',
            path: '/mock/documents/image_models/model-qnn-8gen3/model.bin',
            size: 1000000000,
            isFile: () => true,
            isDirectory: () => false,
          } as any,
        ]);

      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedImageModels();

      expect(discovered).toHaveLength(1);
      expect(discovered[0].backend).toBe('qnn');
    });

    it('skips already registered models', async () => {
      const registeredModel = {
        id: 'existing',
        name: 'Existing Model',
        modelPath: '/mock/documents/image_models/existing-model',
        size: 2000000000,
        downloadedAt: new Date().toISOString(),
      };

      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValueOnce([
        {
          name: 'existing-model',
          path: '/mock/documents/image_models/existing-model',
          size: 0,
          isFile: () => false,
          isDirectory: () => true,
        } as any,
      ]);

      mockedAsyncStorage.getItem.mockImplementation((key: string) => {
        if (key === IMAGE_MODELS_KEY) {
          return Promise.resolve(JSON.stringify([registeredModel]));
        }
        return Promise.resolve('[]');
      });

      const discovered = await modelManager.scanForUntrackedImageModels();

      expect(discovered).toHaveLength(0);
    });

    it('returns empty when directory does not exist', async () => {
      mockedRNFS.exists.mockResolvedValue(false);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedImageModels();

      expect(discovered).toEqual([]);
    });
  });

  // ========================================================================
  // isDownloading
  // ========================================================================
  describe('isDownloading', () => {
    it('returns true when download is active', () => {
      (modelManager as any).downloadJobs.set('test/model.gguf', { jobId: 1, cancel: jest.fn() });

      expect(modelManager.isDownloading('test', 'model.gguf')).toBe(true);
    });

    it('returns false when no active download', () => {
      expect(modelManager.isDownloading('test', 'model.gguf')).toBe(false);
    });
  });
});
