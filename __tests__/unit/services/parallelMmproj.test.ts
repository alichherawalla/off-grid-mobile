import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDownloadStore } from '../../../src/stores/downloadStore';

const mockManifests: any[] = [];
const mockExisting = new Set<string>();
const mockSizes = new Map<string, number>();
let mockFailProjector = false;

jest.mock('../../../src/services/modelServices/coordinatedDownloadBridge', () => ({
  coordinatedDownloads: {
    startManifest: (manifest: any) => {
      mockManifests.push(manifest);
      const { ModelDownloadCoordinator } = require('@offgrid/models');
      const fsModule = require('react-native-fs');
      const fs = fsModule.default ?? fsModule;
      const coordinator = new ModelDownloadCoordinator({
        persistence: { read: async () => [], write: async () => undefined },
        files: {
          pathFor: (name: string) => `${fs.DocumentDirectoryPath}/${name}`,
          exists: async (path: string) => mockExisting.has(path),
          size: async (path: string) => mockSizes.get(path) ?? 0,
          readPrefix: async () => Uint8Array.from([0x47, 0x47, 0x55, 0x46]),
          remove: async (path: string) => { mockExisting.delete(path); },
        },
        transfers: {
          start: async (input: any) => {
            input.onStarted?.(`native:${input.id}`);
            if (mockFailProjector && input.id.includes('projector')) throw new Error('projector offline');
            input.onProgress({ bytesDownloaded: input.expectedBytes, totalBytes: input.expectedBytes });
            mockExisting.add(input.destination);
            mockSizes.set(input.destination, input.expectedBytes);
            return {};
          },
        },
      });
      const handle = coordinator.enqueueWithHandle(manifest);
      return { downloadId: manifest.id, handle };
    },
  },
}));

jest.mock('../../../src/services/huggingface', () => ({
  huggingFaceService: { getDownloadUrl: (_modelId: string, fileName: string) => `https://hf/${fileName}` },
}));

const {
  performBackgroundDownload,
  performMmProjRepairDownload,
  watchBackgroundDownload,
} = require('../../../src/services/adapters/models/library/downloadArtifactAdapter');

const MODELS_DIR = `${RNFS.DocumentDirectoryPath}/models`;
const file = (vision = true) => ({
  name: 'model-Q4.gguf', size: 1024, quantization: 'Q4', downloadUrl: 'https://hf/model-Q4.gguf',
  ...(vision ? { mmProjFile: {
    name: 'mmproj-F16.gguf', size: 1024, downloadUrl: 'https://hf/mmproj-F16.gguf',
  } } : {}),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockManifests.length = 0;
  mockExisting.clear();
  mockSizes.clear();
  mockFailProjector = false;
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {}, repairingVisionIds: {} });
  (RNFS.exists as jest.Mock).mockImplementation(async (path: string) => mockExisting.has(path));
  (RNFS.unlink as jest.Mock).mockImplementation(async (path: string) => { mockExisting.delete(path); });
  (RNFS.stat as jest.Mock).mockImplementation(async (path: string) => ({ size: mockSizes.get(path) ?? 0 }));
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
});

async function start(modelFile = file()) {
  const context = new Map();
  const progress = jest.fn();
  const info = await performBackgroundDownload({
    modelId: 'owner/model', file: modelFile, modelsDir: MODELS_DIR,
    backgroundDownloadContext: context, backgroundDownloadMetadataCallback: null,
    onProgress: progress,
  });
  return { context, progress, info };
}

test('one Shared operation owns the primary GGUF and projector', async () => {
  const { info, context } = await start();
  expect(mockManifests).toHaveLength(1);
  expect(mockManifests[0].artifacts.map((artifact: any) => artifact.role)).toEqual(['mmproj', 'primary']);
  expect(info.downloadId).toBe(mockManifests[0].id);
  expect(context.get(info.downloadId).operation).toBeDefined();
  const result = await context.get(info.downloadId).operation.completion;
  expect(result).toEqual({ success: true });
});

test('the operation projects combined progress through one store row', async () => {
  const { info, context, progress } = await start();
  await context.get(info.downloadId).operation.completion;
  const events: any[] = [];
  context.get(info.downloadId).operation.subscribe((event: any) => events.push(event));
  expect(events.filter(event => event.type === 'progress')).toHaveLength(2);
  const entry = useDownloadStore.getState().downloads['owner/model/model-Q4.gguf'];
  expect(entry.progress).toBe(1);
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({ totalBytes: 2048, progress: 1 }));
});

test('watch finalizes and registers exactly once from the replayable Shared handle', async () => {
  const { info, context } = await start(file(false));
  const onComplete = jest.fn();
  const opts = {
    downloadId: info.downloadId, modelsDir: MODELS_DIR, backgroundDownloadContext: context,
    backgroundDownloadMetadataCallback: null, onComplete, onError: jest.fn(),
  };
  watchBackgroundDownload(opts);
  watchBackgroundDownload(opts);
  await context.get(info.downloadId)?.operation?.completion;
  await new Promise(resolve => setImmediate(resolve));
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    '@local_llm/downloaded_models', expect.stringContaining('owner/model/model-Q4.gguf'),
  );
});

test('an optional projector failure registers the exact model as text-only', async () => {
  mockFailProjector = true;
  const { info, context } = await start();
  const onComplete = jest.fn();
  watchBackgroundDownload({
    downloadId: info.downloadId, modelsDir: MODELS_DIR, backgroundDownloadContext: context,
    backgroundDownloadMetadataCallback: null, onComplete, onError: jest.fn(),
  });
  await context.get(info.downloadId)?.operation?.completion;
  await new Promise(resolve => setImmediate(resolve));
  expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
    id: 'owner/model/model-Q4.gguf', isVisionModel: false, mmProjFileName: 'mmproj-F16.gguf',
  }));
});

test('already installed artifacts are persisted before completion is published', async () => {
  const primary = `${MODELS_DIR}/model-Q4.gguf`;
  const projector = `${MODELS_DIR}/model-mmproj-F16.gguf`;
  mockExisting.add(primary); mockSizes.set(primary, 1024);
  mockExisting.add(projector); mockSizes.set(projector, 1024);
  const { info, context } = await start();
  const onComplete = jest.fn();
  watchBackgroundDownload({
    downloadId: info.downloadId, modelsDir: MODELS_DIR, backgroundDownloadContext: context,
    backgroundDownloadMetadataCallback: null, onComplete, onError: jest.fn(),
  });
  await new Promise(resolve => setImmediate(resolve));
  expect(mockManifests).toHaveLength(0);
  expect(AsyncStorage.setItem).toHaveBeenCalled();
  expect(onComplete).toHaveBeenCalledTimes(1);
});

test('vision repair uses the same Shared manifest and returns the verified projector path', async () => {
  const primary = `${MODELS_DIR}/model-Q4.gguf`;
  mockExisting.add(primary); mockSizes.set(primary, 1024);
  const onDownloadIdReady = jest.fn();
  const path = await performMmProjRepairDownload({
    modelId: 'owner/model', file: file(), modelsDir: MODELS_DIR, onDownloadIdReady,
  });
  expect(onDownloadIdReady).toHaveBeenCalledWith(mockManifests[0].id);
  expect(path).toBe(`${MODELS_DIR}/model-mmproj-F16.gguf`);
});
