/**
 * imageSync Unit Tests
 *
 * Tests for syncCompletedImageDownloads and related helpers.
 */

jest.mock('react-native-fs', () => ({
  exists: jest.fn(),
  mkdir: jest.fn(),
  unlink: jest.fn(),
}));

jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(),
}));

jest.mock('../../../../src/services/modelServices/coordinatedDownloadBridge', () => ({
  coordinatedDownloads: {
    getActiveDownloads: jest.fn(),
    moveCompletedDownload: jest.fn(),
  },
}));

jest.mock('../../../../src/utils/coreMLModelUtils', () => ({
  resolveCoreMLModelDir: jest.fn(),
  downloadCoreMLTokenizerFiles: jest.fn(),
}));

import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { coordinatedDownloads as backgroundDownloadService } from '../../../../src/services/modelServices/coordinatedDownloadBridge';
import { resolveCoreMLModelDir, downloadCoreMLTokenizerFiles } from '../../../../src/utils/coreMLModelUtils';
import { syncCompletedImageDownloads } from '../../../../src/services/modelManager/imageSync';

const mockExists = RNFS.exists as jest.Mock;
const mockMkdir = RNFS.mkdir as jest.Mock;
const mockUnlink = RNFS.unlink as jest.Mock;
const mockUnzip = unzip as jest.Mock;
const mockGetActiveDownloads = backgroundDownloadService.getActiveDownloads as jest.Mock;
const mockMoveCompletedDownload = backgroundDownloadService.moveCompletedDownload as jest.Mock;
const mockResolveCoreMLModelDir = resolveCoreMLModelDir as jest.Mock;
const mockDownloadCoreMLTokenizerFiles = downloadCoreMLTokenizerFiles as jest.Mock;

const baseOpts = {
  imageModelsDir: '/models/images',
  persistedDownloads: {} as Record<number, any>,
  clearDownloadCallback: jest.fn(),
  getDownloadedImageModels: jest.fn(),
  addDownloadedImageModel: jest.fn(),
};

function makeOpts(overrides: Partial<typeof baseOpts> = {}) {
  return {
    ...baseOpts,
    clearDownloadCallback: jest.fn(),
    getDownloadedImageModels: jest.fn().mockResolvedValue([]),
    addDownloadedImageModel: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('syncCompletedImageDownloads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExists.mockResolvedValue(true);
    mockMkdir.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockUnzip.mockResolvedValue(undefined);
    mockMoveCompletedDownload.mockResolvedValue(undefined);
    mockResolveCoreMLModelDir.mockResolvedValue('/models/images/model1/coreml');
    mockDownloadCoreMLTokenizerFiles.mockResolvedValue(undefined);
  });

  it('returns empty array when no active downloads', async () => {
    mockGetActiveDownloads.mockResolvedValue([]);
    const result = await syncCompletedImageDownloads(makeOpts());
    expect(result).toEqual([]);
  });

  it('skips non-completed downloads', async () => {
    mockGetActiveDownloads.mockResolvedValue([
      { downloadId: 1, status: 'running', modelId: 'image:model1' },
    ]);
    const opts = makeOpts({
      persistedDownloads: {
        1: { modelId: 'image:model1', imageDownloadType: 'multifile', imageModelName: 'M1' },
      },
    });
    const result = await syncCompletedImageDownloads(opts);
    expect(result).toEqual([]);
    expect(opts.addDownloadedImageModel).not.toHaveBeenCalled();
  });

  it('skips downloads with no metadata', async () => {
    mockGetActiveDownloads.mockResolvedValue([
      { downloadId: 99, status: 'completed' },
    ]);
    const opts = makeOpts({ persistedDownloads: {} });
    const result = await syncCompletedImageDownloads(opts);
    expect(result).toEqual([]);
  });

  it('skips metadata where modelId does not start with image:', async () => {
    mockGetActiveDownloads.mockResolvedValue([
      { downloadId: 1, status: 'completed' },
    ]);
    const opts = makeOpts({
      persistedDownloads: {
        1: { modelId: 'text:model1', imageDownloadType: 'multifile' },
      },
    });
    const result = await syncCompletedImageDownloads(opts);
    expect(result).toEqual([]);
  });

  it('skips metadata with no imageDownloadType', async () => {
    mockGetActiveDownloads.mockResolvedValue([
      { downloadId: 1, status: 'completed' },
    ]);
    const opts = makeOpts({
      persistedDownloads: {
        1: { modelId: 'image:model1' }, // no imageDownloadType
      },
    });
    const result = await syncCompletedImageDownloads(opts);
    expect(result).toEqual([]);
  });

  it('clears and skips already-downloaded models', async () => {
    mockGetActiveDownloads.mockResolvedValue([
      { downloadId: 1, status: 'completed' },
    ]);
    const clearDownloadCallback = jest.fn();
    const opts = makeOpts({
      persistedDownloads: {
        1: { modelId: 'image:model1', imageDownloadType: 'multifile' },
      },
      clearDownloadCallback,
      getDownloadedImageModels: jest.fn().mockResolvedValue([{ id: 'model1' }]),
    });
    const result = await syncCompletedImageDownloads(opts);
    expect(result).toEqual([]);
    expect(clearDownloadCallback).toHaveBeenCalledWith(1);
  });

  it('recovers a multifile download and adds model', async () => {
    mockGetActiveDownloads.mockResolvedValue([
      { downloadId: 1, status: 'completed' },
    ]);
    const opts = makeOpts({
      persistedDownloads: {
        1: {
          modelId: 'image:model1',
          imageDownloadType: 'multifile',
          imageModelName: 'Model One',
          imageModelDescription: 'A model',
          imageModelSize: 500,
          imageModelStyle: 'realistic',
          imageModelBackend: 'mnn',
        },
      },
    });
    const result = await syncCompletedImageDownloads(opts);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('model1');
    expect(result[0].name).toBe('Model One');
    expect(result[0].modelPath).toBe('/models/images/model1');
    expect(opts.addDownloadedImageModel).toHaveBeenCalledWith(expect.objectContaining({ id: 'model1' }));
    expect(opts.clearDownloadCallback).toHaveBeenCalledWith(1);
  });

  it('recovers a zip download and adds model', async () => {
    mockGetActiveDownloads.mockResolvedValue([
      { downloadId: 2, status: 'completed' },
    ]);
    const opts = makeOpts({
      persistedDownloads: {
        2: {
          modelId: 'image:model2',
          imageDownloadType: 'zip',
          fileName: 'model2.zip',
          imageModelName: 'Model Two',
          imageModelDescription: 'A zip model',
          imageModelSize: 1000,
          imageModelBackend: 'mnn',
        },
      },
    });
    const result = await syncCompletedImageDownloads(opts);
    expect(mockMoveCompletedDownload).toHaveBeenCalledWith(2, '/models/images/model2.zip');
    expect(mockUnzip).toHaveBeenCalledWith('/models/images/model2.zip', '/models/images/model2');
    expect(mockUnlink).toHaveBeenCalledWith('/models/images/model2.zip');
    expect(result[0].modelPath).toBe('/models/images/model2');
  });

  it('uses resolveCoreMLModelDir for coreml zip download', async () => {
    mockGetActiveDownloads.mockResolvedValue([
      { downloadId: 3, status: 'completed' },
    ]);
    mockResolveCoreMLModelDir.mockResolvedValue('/models/images/model3/resolved');
    const opts = makeOpts({
      persistedDownloads: {
        3: {
          modelId: 'image:model3',
          imageDownloadType: 'zip',
          fileName: 'model3.zip',
          imageModelName: 'CoreML Model',
          imageModelBackend: 'coreml',
          imageModelSize: 800,
        },
      },
    });
    const result = await syncCompletedImageDownloads(opts);
    expect(mockResolveCoreMLModelDir).toHaveBeenCalledWith('/models/images/model3');
    expect(result[0].modelPath).toBe('/models/images/model3/resolved');
  });

  it('downloads tokenizer files for coreml multifile with repo', async () => {
    mockGetActiveDownloads.mockResolvedValue([
      { downloadId: 4, status: 'completed' },
    ]);
    const opts = makeOpts({
      persistedDownloads: {
        4: {
          modelId: 'image:model4',
          imageDownloadType: 'multifile',
          imageModelName: 'CoreML Multi',
          imageModelBackend: 'coreml',
          imageModelRepo: 'org/repo',
          imageModelSize: 600,
        },
      },
    });
    await syncCompletedImageDownloads(opts);
    expect(mockDownloadCoreMLTokenizerFiles).toHaveBeenCalledWith('/models/images/model4', 'org/repo');
  });

  it('does not call downloadCoreMLTokenizerFiles when no repo', async () => {
    mockGetActiveDownloads.mockResolvedValue([
      { downloadId: 5, status: 'completed' },
    ]);
    const opts = makeOpts({
      persistedDownloads: {
        5: {
          modelId: 'image:model5',
          imageDownloadType: 'multifile',
          imageModelName: 'CoreML No Repo',
          imageModelBackend: 'coreml',
          imageModelSize: 600,
          // no imageModelRepo
        },
      },
    });
    await syncCompletedImageDownloads(opts);
    expect(mockDownloadCoreMLTokenizerFiles).not.toHaveBeenCalled();
  });

  it('falls back to modelId as name when imageModelName is missing', async () => {
    mockGetActiveDownloads.mockResolvedValue([
      { downloadId: 6, status: 'completed' },
    ]);
    const opts = makeOpts({
      persistedDownloads: {
        6: {
          modelId: 'image:unnamed-model',
          imageDownloadType: 'multifile',
          imageModelSize: 200,
          imageModelBackend: 'mnn',
        },
      },
    });
    const result = await syncCompletedImageDownloads(opts);
    expect(result[0].name).toBe('unnamed-model');
  });

  it('silently skips on recovery error', async () => {
    mockGetActiveDownloads.mockResolvedValue([
      { downloadId: 7, status: 'completed' },
    ]);
    mockMoveCompletedDownload.mockRejectedValue(new Error('move failed'));
    mockExists.mockResolvedValue(false); // zip doesn't exist either
    const opts = makeOpts({
      persistedDownloads: {
        7: {
          modelId: 'image:broken',
          imageDownloadType: 'zip',
          fileName: 'broken.zip',
          imageModelName: 'Broken',
          imageModelBackend: 'mnn',
          imageModelSize: 100,
        },
      },
    });
    const result = await syncCompletedImageDownloads(opts);
    expect(result).toEqual([]);
    expect(opts.addDownloadedImageModel).not.toHaveBeenCalled();
  });

  it('creates imageModelsDir if it does not exist (zip path)', async () => {
    mockGetActiveDownloads.mockResolvedValue([
      { downloadId: 8, status: 'completed' },
    ]);
    mockExists.mockResolvedValue(false);
    const opts = makeOpts({
      persistedDownloads: {
        8: {
          modelId: 'image:model8',
          imageDownloadType: 'zip',
          fileName: 'model8.zip',
          imageModelName: 'Model 8',
          imageModelBackend: 'mnn',
          imageModelSize: 100,
        },
      },
    });
    await syncCompletedImageDownloads(opts);
    expect(mockMkdir).toHaveBeenCalledWith('/models/images');
  });
});
