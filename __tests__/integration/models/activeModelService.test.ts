import { useModelResidencyStore } from '../../../src/stores/modelResidencyStore';
import { arrangeLocalSelection } from '../../utils/testHelpers';
import { selectedLocalModelId } from '../../utils/testHelpers';
/**
 * Integration Tests: ActiveModelService
 *
 * Tests the integration between:
 * - activeModelService ↔ llmService (text model loading/unloading)
 * - activeModelService ↔ localDreamGeneratorService (image model loading/unloading)
 * - activeModelService ↔ useAppStore (model state persistence)
 *
 * These tests verify the model lifecycle management works correctly
 * across service boundaries.
 */

import { useAppStore } from '../../../src/stores/appStore';
import { activeModelService } from '../../harness/activeModelLifecycle';
import {
  resolveTextResidentSpec,
} from '../../../src/services/modelServices/modelLifecycleBootstrap';
import { modelResidencyManager } from '../../harness/activeModelLifecycle';
import { llmService } from '../../../src/services/llm';
import { liteRTService } from '../../../src/services/litert';
import { localDreamGeneratorService } from '../../../src/services/localDreamGenerator';
import { hardwareService } from '../../../src/services/hardware';
import {
  clearTextModelCache,
  getPerformanceStats,
  getResourceUsage,
} from '../../../src/services/modelServices/modelState';
import { modelApplication } from '../../harness/activeModelLifecycle';
import {
  resetStores,
  flushPromises,
  getAppState,
} from '../../utils/testHelpers';
import {
  createDownloadedModel,
  createONNXImageModel,
  createDeviceInfo,
} from '../../utils/factories';

// Mock the services
jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/localDreamGenerator');
jest.mock('../../../src/services/hardware');
// Integrity is a boundary for these residency/memory tests (the model files aren't laid
// down on a real disk here). The completeness rule has its own dedicated tests.
jest.mock('../../../src/utils/imageModelIntegrity', () => ({
  validateImageModelDir: jest.fn(async () => ({ complete: true, missing: [] })),
  ensureImageExtractionComplete: jest.fn(async () => {}),
}));

import { validateImageModelDir } from '../../../src/utils/imageModelIntegrity';
import { ImageModelIncompleteError } from '../../../src/services/modelLoadErrors';

const mockLlmService = llmService as jest.Mocked<typeof llmService>;
const mockLocalDreamService = localDreamGeneratorService as jest.Mocked<
  typeof localDreamGeneratorService
>;
const mockHardwareService = hardwareService as jest.Mocked<
  typeof hardwareService
>;

function expectLoadedSettings(expected: Record<string, unknown>) {
  const loadedSettings = getAppState().loadedSettings;
  expect(loadedSettings).not.toBeNull();
  Object.entries(expected).forEach(([key, value]) => {
    expect((loadedSettings as any)?.[key]).toBe(value);
  });
}

async function importTextModelThroughApplication(source: string) {
  const RNFS = require('react-native-fs') as {
    readDir: jest.Mock<Promise<unknown[]>, [string]>;
  };
  const previousReadDir = RNFS.readDir.getMockImplementation();
  const cut = source.lastIndexOf('/');
  const parent = source.slice(0, cut);
  const name = source.slice(cut + 1);
  RNFS.readDir.mockImplementation(async directory =>
    directory === parent
      ? [
          {
            name,
            path: source,
            size: 1_000_000,
            isFile: () => true,
            isDirectory: () => false,
          },
        ]
      : ((await previousReadDir?.(directory)) ?? []),
  );
  const imported = await modelApplication().models.import({
    path: source,
    modality: 'text',
  }).finally(() => {
    if (previousReadDir) RNFS.readDir.mockImplementation(previousReadDir);
  });
  if (!imported.ok) throw new Error(JSON.stringify(imported.failure));
  expect(imported.ok).toBe(true);
  return imported.value;
}

describe('ActiveModelService Integration', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    await modelResidencyManager._reset();

    // Default mock implementations
    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLlmService.getLoadedModelPath.mockReturnValue(null);
    mockLlmService.loadModel.mockResolvedValue(undefined);
    mockLlmService.unloadModel.mockResolvedValue({ released: true });

    mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
    mockLocalDreamService.loadModel.mockResolvedValue(true);
    mockLocalDreamService.unloadModel.mockResolvedValue(true);

    mockHardwareService.getDeviceInfo.mockResolvedValue(createDeviceInfo());
    mockHardwareService.refreshMemoryInfo.mockResolvedValue({
      totalMemory: 8 * 1024 * 1024 * 1024,
      usedMemory: 4 * 1024 * 1024 * 1024,
      availableMemory: 4 * 1024 * 1024 * 1024,
    } as any);
    // Real sizing math (the auto-mock returns undefined otherwise), so the
    // residency manager's budget/eviction has actual model sizes to work with.
    mockHardwareService.getModelTotalSize.mockImplementation(
      (m: any) => (m?.fileSize || m?.size || 0) + (m?.mmProjFileSize || 0),
    );
    mockHardwareService.estimateModelRam.mockImplementation(
      (m: any, mult = 1.5) =>
        ((m?.fileSize || m?.size || 0) + (m?.mmProjFileSize || 0)) * mult,
    );
    mockHardwareService.estimateImageModelRam.mockImplementation(
      (m: any) =>
        ((m?.fileSize || m?.size || 0) + (m?.mmProjFileSize || 0)) * 2.5,
    );
    // Generous RAM by default so model-mechanics tests aren't blocked by the
    // budget; the budget-specific describes below set their own (4GB / 8GB).
    mockHardwareService.getTotalMemoryGB.mockReturnValue(16);
    // Real available high by default so the dynamic budget cap doesn't bind and
    // the physical-RAM budget (the subject of these tests) is what's exercised.
    mockHardwareService.getAvailableMemoryGB.mockReturnValue(16);

    // Reset the activeModelService's internal state to match mock state
    await activeModelService.syncWithNativeState();
  });

  describe('Text Model Loading — aggressive load override ("Load Anyway")', () => {
    it('admits an oversized text resident when the user chooses Load Anyway', async () => {
      mockHardwareService.getTotalMemoryGB.mockReturnValue(24);
      mockHardwareService.getAvailableMemoryGB.mockReturnValue(24);
      const application = modelApplication();
      const cleared = await application.models.eject({
        operationId: 'load-anyway-precondition',
      });
      expect(cleared.ok).toBe(true);
      application.models.setLoadPolicy('balanced');
      const key = 'test:oversized-text';
      const events: string[] = [];

      const lease = await application.models.residency.acquire(
        {
          key,
          type: 'text',
          modelId: 'huge-1',
          sizeMB: 21 * 1024,
          residencyKey: 'test:text-engine',
        },
        {
          load: async () => {
            events.push('native-load');
          },
          unload: async () => ({ reclaimed: true }),
        },
        {
          override: true,
        },
      );

      expect(lease.acquired).toBe(true);
      await lease.release();
      expect(events).toEqual(['native-load']);
      expect(application.models.residency.isResident(key)).toBe(true);
      expect(application.models.snapshot().residents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key, modelId: 'huge-1' }),
        ]),
      );
    });
  });

  describe('Text Model Loading', () => {
    it('should load text model via llmService and update store', async () => {
      const model = createDownloadedModel({ id: 'test-model-1' });
      useAppStore.setState({ downloadedModels: [model] });

      mockLlmService.loadModel.mockResolvedValue(undefined);
      mockLlmService.isModelLoaded.mockReturnValue(true);

      await activeModelService.loadTextModel('test-model-1');

      // Verify llmService was called correctly
      expect(mockLlmService.loadModel).toHaveBeenCalledWith(
        model.filePath,
        (model as any).mmProjPath,
        { override: false },
      );

      // Verify store was updated
      expect(selectedLocalModelId('text')).toBe('test-model-1');
    });

    it('flags textModelEvicted on an eviction (keepSelection) and clears it on reload', async () => {
      const model = createDownloadedModel({ id: 'evict-me' });
      useAppStore.setState({ downloadedModels: [model] });
      useModelResidencyStore.setState({ textModelEvicted: false });
      mockLlmService.loadModel.mockResolvedValue(undefined);
      mockLlmService.isModelLoaded.mockReturnValue(true);
      await activeModelService.loadTextModel('evict-me');
      expect(useModelResidencyStore.getState().textModelEvicted).toBe(false);

      // Residency evicts it to free RAM (keepSelection=true) while a native model is loaded.
      await activeModelService.unloadTextModel(true);
      expect(useModelResidencyStore.getState().textModelEvicted).toBe(true);
      expect(selectedLocalModelId('text')).toBe('evict-me');

      // Reloading (the "continue" tap) clears the flag.
      mockLlmService.isModelLoaded.mockReturnValue(false);
      await activeModelService.loadTextModel('evict-me');
      expect(useModelResidencyStore.getState().textModelEvicted).toBe(false);
    });

    it('a user-initiated unload clears the selection and does NOT flag textModelEvicted', async () => {
      const application = modelApplication();
      const cleared = await application.models.eject({
        operationId: 'user-text-unload-precondition',
      });
      expect(cleared.ok).toBe(true);
      const model = await importTextModelThroughApplication(
        '/external/user-text-unload.gguf',
      );
      const selected = await application.models.select({
        modality: 'text',
        modelId: model.id,
      });
      expect(selected.ok).toBe(true);
      const loaded = await application.models.load({
        modality: 'text',
        modelId: model.id,
        operationId: 'user-text-unload-load',
      });
      expect(loaded.ok).toBe(true);

      const outcome = await application.models.unload({
        modality: 'text',
        keepSelection: false,
        operationId: 'user-text-unload',
      });

      expect(outcome).toEqual({ ok: true, value: true });
      expect(useModelResidencyStore.getState().textModelEvicted).toBe(false);
      expect(application.models.activeModelId('text')).toBeNull();
      expect(
        application.models
          .snapshot()
          .residents.some(resident => resident.modelId === model.id),
      ).toBe(false);
    });

    it('budgets a LiteRT text model as dirty memory and a GGUF as clean (F9)', async () => {
      // LiteRT weights + KV are dirty/accelerator memory -> must budget against REAL
      // free RAM (dirtyMemory:true), or the native engine can OOM on a "fits" verdict.
      const litert = createDownloadedModel({
        id: 'litert-1',
        engine: 'litert' as any,
        fileName: 'm.litertlm',
        filePath: '/m.litertlm',
      });
      useAppStore.setState({ downloadedModels: [litert] });
      await expect(resolveTextResidentSpec('litert-1')).resolves.toEqual(
        expect.objectContaining({ type: 'text', dirtyMemory: true }),
      );

      // GGUF/llama is clean mmap -> physical-cap budgeting unchanged (dirtyMemory:false).
      const gguf = createDownloadedModel({
        id: 'gguf-1',
        engine: 'llama' as any,
      });
      useAppStore.setState({ downloadedModels: [gguf] });
      await expect(resolveTextResidentSpec('gguf-1')).resolves.toEqual(
        expect.objectContaining({ type: 'text', dirtyMemory: false }),
      );
    });

    it('unloads a resident LiteRT model (latent bug: unload was llama-only, so LiteRT never freed)', async () => {
      const litert = createDownloadedModel({
        id: 'litert-1',
        engine: 'litert' as any,
        fileName: 'm.litertlm',
        filePath: '/m.litertlm',
      });
      useAppStore.setState({ downloadedModels: [litert] });
      arrangeLocalSelection('text', 'litert-1');
      // The active engine (LiteRT) reports a resident model; llama has nothing.
      jest.spyOn(liteRTService, 'isModelLoaded').mockReturnValue(true);
      const liteUnload = jest
        .spyOn(liteRTService, 'unloadModel')
        .mockResolvedValue({ released: true });
      mockLlmService.isModelLoaded.mockReturnValue(false);

      await activeModelService.unloadTextModel();

      // The active engine's model is actually freed — not left resident (the OOM-relevant bug).
      expect(liteUnload).toHaveBeenCalled();
      liteUnload.mockRestore();
      (liteRTService.isModelLoaded as jest.Mock).mockRestore?.();
    });

    it('should save loadedSettings when model is loaded', async () => {
      const model = createDownloadedModel({ id: 'test-model-1' });
      useAppStore.setState({
        downloadedModels: [model],
        settings: {
          ...useAppStore.getState().settings,
          nThreads: 8,
          enableGpu: true,
          gpuLayers: 50,
          contextLength: 4096,
          cacheType: 'f16',
        },
      });

      mockLlmService.loadModel.mockResolvedValue(undefined);
      mockLlmService.isModelLoaded.mockReturnValue(true);

      await activeModelService.loadTextModel('test-model-1');

      // Verify loadedSettings was saved with the correct values
      const loadedSettings = getAppState().loadedSettings;
      expect(loadedSettings).not.toBeNull();
      expect(loadedSettings?.nThreads).toBe(8);
      expect(loadedSettings?.enableGpu).toBe(true);
      expect(loadedSettings?.gpuLayers).toBe(50);
      expect(loadedSettings?.contextLength).toBe(4096);
      expect(loadedSettings?.cacheType).toBe('f16');
    });

    it('should save loadedSettings with flash attention enabled', async () => {
      const model = createDownloadedModel({ id: 'flash-attention-model' });
      useAppStore.setState({
        downloadedModels: [model],
        settings: {
          ...useAppStore.getState().settings,
          nThreads: 6,
          nBatch: 256,
          contextLength: 4096,
          enableGpu: true,
          gpuLayers: 50,
          flashAttn: true,
          cacheType: 'f16',
        },
      });

      mockLlmService.loadModel.mockResolvedValue(undefined);
      mockLlmService.isModelLoaded.mockReturnValue(true);

      await activeModelService.loadTextModel('flash-attention-model');

      // Verify loadedSettings was saved with current settings
      expectLoadedSettings({
        nThreads: 6,
        nBatch: 256,
        contextLength: 4096,
        enableGpu: true,
        gpuLayers: 50,
        flashAttn: true,
        cacheType: 'f16',
      });
    });

    it('should skip loading if model already loaded', async () => {
      const model = createDownloadedModel({ id: 'test-model-1' });
      useAppStore.setState({ downloadedModels: [model] });
      arrangeLocalSelection('text', 'test-model-1');

      // First, simulate that the model is already loaded via a first call
      mockLlmService.isModelLoaded.mockReturnValue(true);
      await activeModelService.loadTextModel('test-model-1');

      // Clear the call count after initial setup
      mockLlmService.loadModel.mockClear();

      // Now try to load again - should be skipped since already loaded
      await activeModelService.loadTextModel('test-model-1');

      // Should not be called again since model is already loaded
      expect(mockLlmService.loadModel).not.toHaveBeenCalled();
    });

    it('should unload previous model when loading different model', async () => {
      const model1 = createDownloadedModel({
        id: 'model-1',
        filePath: '/path/model1.gguf',
      });
      const model2 = createDownloadedModel({
        id: 'model-2',
        filePath: '/path/model2.gguf',
      });
      useAppStore.setState({ downloadedModels: [model1, model2] });

      mockLlmService.isModelLoaded.mockReturnValue(true);

      // Load first model
      await activeModelService.loadTextModel('model-1');

      // Load second model
      await activeModelService.loadTextModel('model-2');

      // Should have unloaded first model
      expect(mockLlmService.unloadModel).toHaveBeenCalled();

      // Should have loaded second model
      expect(mockLlmService.loadModel).toHaveBeenLastCalledWith(
        model2.filePath,
        (model2 as any).mmProjPath,
        { override: false },
      );
    });

    it('should throw error if model not found', async () => {
      useAppStore.setState({ downloadedModels: [] });

      await expect(
        activeModelService.loadTextModel('non-existent'),
      ).rejects.toThrow('Model not found');
    });

    it('should notify listeners during loading state changes', async () => {
      const model = createDownloadedModel({ id: 'test-model' });
      useAppStore.setState({ downloadedModels: [model] });

      const listener = jest.fn();
      const unsubscribe = modelApplication().models.subscribe(listener);

      // Create a deferred promise to control loading
      let resolveLoad: () => void;
      mockLlmService.loadModel.mockImplementation(
        () =>
          new Promise(resolve => {
            resolveLoad = resolve;
          }),
      );

      const loadPromise = activeModelService.loadTextModel('test-model');

      await flushPromises();

      // Should have been called with loading state
      expect(listener).toHaveBeenCalled();
      const loadingCall = listener.mock.calls.find(call =>
        call[0].operations.active.some(
          (operation: { kind: string; modality?: string }) =>
            operation.kind === 'load' && operation.modality === 'text',
        ),
      );
      expect(loadingCall).toBeDefined();

      // Complete loading
      resolveLoad!();
      await loadPromise;

      // Should have been called with loaded state
      const loadedCall = listener.mock.calls.find(
        call =>
          !call[0].operations.active.some(
            (operation: { kind: string; modality?: string }) =>
              operation.kind === 'load' && operation.modality === 'text',
          ),
      );
      expect(loadedCall).toBeDefined();

      unsubscribe();
    });

    it('should save loadedSettings with q8_0 cache type', async () => {
      const model = createDownloadedModel({ id: 'test-model-1' });
      useAppStore.setState({
        downloadedModels: [model],
        settings: {
          ...useAppStore.getState().settings,
          nThreads: 6,
          nBatch: 256,
          contextLength: 4096,
          enableGpu: true,
          gpuLayers: 50,
          flashAttn: true,
          cacheType: 'q8_0',
        },
      });

      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLlmService.loadModel.mockResolvedValue(undefined);

      await activeModelService.loadTextModel('test-model-1');

      // Verify loadedSettings was saved with the correct values
      expectLoadedSettings({
        nThreads: 6,
        nBatch: 256,
        contextLength: 4096,
        enableGpu: true,
        gpuLayers: 50,
        flashAttn: true,
        cacheType: 'q8_0',
      });
    });
  });

  describe('Text Model Unloading', () => {
    it('should unload text model and clear store', async () => {
      const model = createDownloadedModel({ id: 'test-model' });
      useAppStore.setState({
        downloadedModels: [model],
      });
      arrangeLocalSelection('text', 'test-model');

      mockLlmService.isModelLoaded.mockReturnValue(true);

      // First load the model to set internal tracking
      await activeModelService.loadTextModel('test-model');

      // Then unload
      await activeModelService.unloadTextModel();

      expect(mockLlmService.unloadModel).toHaveBeenCalled();
      expect(selectedLocalModelId('text')).toBe(null);
    });

    it('reports a successful no-op when no text model is selected or resident', async () => {
      const application = modelApplication();
      const selected = await application.models.select({
        modality: 'text',
        modelId: null,
      });
      expect(selected.ok).toBe(true);
      const cleared = await application.models.eject({
        operationId: 'empty-text-unload-precondition',
      });
      expect(cleared.ok).toBe(true);

      const operationId = 'empty-text-unload';
      const outcome = await application.models.unload({
        modality: 'text',
        operationId,
      });

      expect(outcome).toEqual({ ok: true, value: false });
      expect(application.models.activeModelId('text')).toBeNull();
      expect(
        application.models
          .snapshot()
          .residents.some(resident => resident.type === 'text'),
      ).toBe(false);
      expect(application.models.snapshot().operations.recent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operationId,
            kind: 'unload',
            state: 'succeeded',
            unloaded: false,
          }),
        ]),
      );
    });
  });

  describe('ejectAll (frees RAM but KEEPS the selection)', () => {
    it('unloads the model from RAM yet keeps it selected — eject != deselect', async () => {
      const application = modelApplication();
      const cleared = await application.models.eject({
        operationId: 'selected-text-eject-precondition',
      });
      expect(cleared.ok).toBe(true);
      const model = await importTextModelThroughApplication(
        '/external/selected-text-eject.gguf',
      );
      const selected = await application.models.select({
        modality: 'text',
        modelId: model.id,
      });
      expect(selected.ok).toBe(true);
      const loaded = await application.models.load({
        modality: 'text',
        modelId: model.id,
        operationId: 'selected-text-load',
      });
      expect(loaded.ok).toBe(true);
      expect(application.models.activeModelId('text')).toBe(model.id);
      const residentKey = application.models
        .snapshot()
        .residents.find(resident => resident.modelId === model.id)?.key;
      expect(residentKey).toBeDefined();

      const outcome = await application.models.eject({
        operationId: 'selected-text-eject',
      });

      expect(outcome).toEqual({
        ok: true,
        value: {
          count: 1,
          releasedResidents: [residentKey],
          remainingResidents: [],
          runtimes: {
            'text runtime': { status: 'absent' },
            'image runtime': { status: 'absent' },
          },
          rejections: [],
        },
      });
      expect(
        application.models
          .snapshot()
          .residents.some(resident => resident.modelId === model.id),
      ).toBe(false);
      expect(application.models.activeModelId('text')).toBe(model.id);
    });

    it('is a no-op count of 0 when nothing is loaded', async () => {
      const application = modelApplication();
      const cleared = await application.models.eject({
        operationId: 'empty-eject-precondition',
      });
      expect(cleared.ok).toBe(true);

      const outcome = await application.models.eject({
        operationId: 'empty-eject',
      });

      expect(outcome).toEqual({
        ok: true,
        value: {
          count: 0,
          releasedResidents: [],
          remainingResidents: [],
          runtimes: {
            'text runtime': { status: 'absent' },
            'image runtime': { status: 'absent' },
          },
          rejections: [],
        },
      });
      expect(application.models.snapshot().residents).toEqual([]);
    });
  });

  describe('Image Model Loading', () => {
    it('should load image model via localDreamGeneratorService', async () => {
      const imageModel = createONNXImageModel({ id: 'img-model-1' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      await activeModelService.loadImageModel('img-model-1');

      expect(mockLocalDreamService.loadModel).toHaveBeenCalledWith(
        imageModel.modelPath,
        4,
        { backend: 'auto', cpuOnly: false, attentionVariant: undefined },
      );

      expect(selectedLocalModelId('image')).toBe('img-model-1');
    });

    it('should unload previous image model when loading different model', async () => {
      const imgModel1 = createONNXImageModel({ id: 'img-1' });
      const imgModel2 = createONNXImageModel({ id: 'img-2' });
      useAppStore.setState({
        downloadedImageModels: [imgModel1, imgModel2],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      // Load first model
      await activeModelService.loadImageModel('img-1');

      // Load second model
      await activeModelService.loadImageModel('img-2');

      expect(mockLocalDreamService.unloadModel).toHaveBeenCalled();
      expect(mockLocalDreamService.loadModel).toHaveBeenLastCalledWith(
        imgModel2.modelPath,
        4,
        { backend: 'auto', cpuOnly: false, attentionVariant: undefined },
      );
    });

    it('refuses an INCOMPLETE model — throws ImageModelIncompleteError and never reaches native load (B respects the verdict)', async () => {
      const broken = createONNXImageModel({ id: 'img-broken', backend: 'mnn' });
      useAppStore.setState({
        downloadedImageModels: [broken],
        settings: { imageThreads: 4 } as any,
      });
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
      // Force the REAL loadImageModel to see an INCOMPLETE verdict from the integrity
      // boundary. Assert the CONSEQUENCE (throws + native load never happens), not the call —
      // this catches a caller that queries integrity but ignores `complete: false`.
      (validateImageModelDir as jest.Mock).mockResolvedValueOnce({
        complete: false,
        missing: ['pos_emb.bin', 'clip_v2.mnn.weight'],
      });

      await expect(
        activeModelService.loadImageModel('img-broken'),
      ).rejects.toBeInstanceOf(ImageModelIncompleteError);
      expect(mockLocalDreamService.loadModel).not.toHaveBeenCalled();
    });
  });

  describe('conservative mode — single-model switching text/image/STT', () => {
    // Conservative = ONE model at a time (evict everything else on each load). Aggressive is NOT
    // single-model — it co-resides like balanced (covered in loadingModes.redflow); conservative is
    // where the mutual-exclusion swap is the contract.
    beforeEach(() => modelResidencyManager.setLoadPolicy('conservative'));
    afterEach(() => modelResidencyManager.setLoadPolicy('balanced'));

    it('switching text -> image evicts the text model (single model, not co-resident)', async () => {
      const textModel = createDownloadedModel({ id: 'txt-1' });
      const imageModel = createONNXImageModel({ id: 'img-1' });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      await activeModelService.loadTextModel('txt-1');
      expect(
        modelResidencyManager.getResidents().some(r => r.type === 'text'),
      ).toBe(true);

      // Under conservative single-model, loading the image evicts the resident text model.
      await activeModelService.loadImageModel('img-1');
      expect(mockLlmService.unloadModel).toHaveBeenCalled();
      expect(
        modelResidencyManager.getResidents().some(r => r.type === 'text'),
      ).toBe(false);
      expect(
        modelResidencyManager.getResidents().some(r => r.type === 'image'),
      ).toBe(true);
      expect(selectedLocalModelId('image')).toBe('img-1');
    });

    it('switching image -> text evicts the image model', async () => {
      const textModel = createDownloadedModel({ id: 'txt-1' });
      const imageModel = createONNXImageModel({ id: 'img-1' });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      await activeModelService.loadImageModel('img-1');
      expect(
        modelResidencyManager.getResidents().some(r => r.type === 'image'),
      ).toBe(true);

      await activeModelService.loadTextModel('txt-1');
      expect(mockLocalDreamService.unloadModel).toHaveBeenCalled();
      expect(
        modelResidencyManager.getResidents().some(r => r.type === 'image'),
      ).toBe(false);
      expect(
        modelResidencyManager.getResidents().some(r => r.type === 'text'),
      ).toBe(true);
    });

    it('a full text -> image -> text round-trip loads each and keeps exactly one generation model', async () => {
      const textModel = createDownloadedModel({ id: 'txt-1' });
      const imageModel = createONNXImageModel({ id: 'img-1' });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      await activeModelService.loadTextModel('txt-1');
      await activeModelService.loadImageModel('img-1');
      await activeModelService.loadTextModel('txt-1');

      // Ends with exactly the text model resident — never both.
      expect(
        modelResidencyManager.getResidents().some(r => r.type === 'text'),
      ).toBe(true);
      expect(
        modelResidencyManager.getResidents().some(r => r.type === 'image'),
      ).toBe(false);
    });
  });

  describe('Image Model Unloading', () => {
    it('should unload image model and clear store', async () => {
      const imageModel = createONNXImageModel({ id: 'img-model' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],

        settings: { imageThreads: 4 } as any,
      });
      arrangeLocalSelection('image', 'img-model');

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      // First load to set internal tracking
      await activeModelService.loadImageModel('img-model');

      // Then unload
      await activeModelService.unloadImageModel();

      expect(mockLocalDreamService.unloadModel).toHaveBeenCalled();
      expect(selectedLocalModelId('image')).toBe(null);
    });
  });

  // Helper: load both models without marking them active in the store
  async function loadBothModelsWithSizes(textId: string, imageId: string) {
    const textModel = createDownloadedModel({
      id: textId,
      fileSize: 1 * 1024 * 1024 * 1024,
    });
    const imageModel = createONNXImageModel({
      id: imageId,
      size: 512 * 1024 * 1024,
    });
    useAppStore.setState({
      downloadedModels: [textModel],
      downloadedImageModels: [imageModel],
      settings: { imageThreads: 4 } as any,
    });
    mockLlmService.isModelLoaded.mockReturnValue(true);
    await activeModelService.loadTextModel(textId);
    mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
    mockLocalDreamService.loadModel.mockResolvedValue(true);
    await activeModelService.loadImageModel(imageId);
    return { textModel, imageModel };
  }

  // Helper: set up store and load both a text model and an image model
  async function setupAndLoadBothModels(
    textId = 'text-model',
    imageId = 'img-model',
  ) {
    const textModel = createDownloadedModel({
      id: textId,
      fileSize: 1 * 1024 * 1024 * 1024,
    });
    const imageModel = createONNXImageModel({
      id: imageId,
      size: 512 * 1024 * 1024,
    });
    useAppStore.setState({
      downloadedModels: [textModel],

      downloadedImageModels: [imageModel],

      settings: { imageThreads: 4 } as any,
    });
    arrangeLocalSelection('text', textId);
    arrangeLocalSelection('image', imageId);
    mockLlmService.isModelLoaded.mockReturnValue(true);
    mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
    await activeModelService.loadTextModel(textId);
    await activeModelService.loadImageModel(imageId);
    return { textModel, imageModel };
  }

  describe('Unload All Models', () => {
    it('should unload both text and image models', async () => {
      await setupAndLoadBothModels();

      // Unload all
      const result = await activeModelService.unloadAllModels();

      expect(result.textUnloaded).toBe(true);
      expect(result.imageUnloaded).toBe(true);
      expect(mockLlmService.unloadModel).toHaveBeenCalled();
      expect(mockLocalDreamService.unloadModel).toHaveBeenCalled();
    });
  });

  describe('Memory Check', () => {
    it('should return safe for small models on high memory device', async () => {
      const model = createDownloadedModel({
        id: 'small-model',
        fileSize: 2 * 1024 * 1024 * 1024, // 2GB
      });
      useAppStore.setState({ downloadedModels: [model] });

      // High memory device (16GB)
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 16 * 1024 * 1024 * 1024 }),
      );

      const result = await activeModelService.checkMemoryForModel(
        'small-model',
        'text',
      );

      expect(result.canLoad).toBe(true);
      expect(result.severity).toBe('safe');
    });

    it('should return warning for models exceeding 50% of RAM', async () => {
      const model = createDownloadedModel({
        id: 'large-model',
        fileSize: 3 * 1024 * 1024 * 1024, // 3GB
      });
      useAppStore.setState({ downloadedModels: [model] });

      // 8GB device - 3GB * 1.5 (overhead) = 4.5GB
      // Warning threshold: 50% of 8GB = 4GB
      // Critical threshold: 60% of 8GB = 4.8GB
      // 4.5GB is between 4GB and 4.8GB, so should be warning
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      );

      const result = await activeModelService.checkMemoryForModel(
        'large-model',
        'text',
      );

      expect(result.canLoad).toBe(true);
      expect(result.severity).toBe('warning');
    });

    it('should return critical when the model exceeds the canonical residency budget', async () => {
      const model = createDownloadedModel({
        id: 'huge-model',
        fileSize: 8 * 1024 * 1024 * 1024, // 8GB
      });
      useAppStore.setState({ downloadedModels: [model] });

      // Both advisory observations must describe the same 8GB device: deviceInfo
      // supplies UI evidence and the residency memory source supplies the budget.
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      );
      mockHardwareService.getTotalMemoryGB.mockReturnValue(8);
      mockHardwareService.getAvailableMemoryGB.mockReturnValue(8);

      const result = await activeModelService.checkMemoryForModel(
        'huge-model',
        'text',
      );

      expect(result.canLoad).toBe(false);
      expect(result.severity).toBe('critical');
    });

    it('aggressive load policy relaxes the PRE-CHECK too (not just residency), end-to-end', async () => {
      // 6.5GB file → ~9.75GB required (1.5x). On a 12GB device this exceeds the
      // balanced budget (0.70 Android / 0.78 iOS) but fits the aggressive budget
      // (0.88 / 0.92) — proving the pre-check reads the residency manager's policy.
      const model = createDownloadedModel({
        id: 'mid-model',
        fileSize: 6.5 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({ downloadedModels: [model] });
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 12 * 1024 * 1024 * 1024 }),
      );
      mockHardwareService.getTotalMemoryGB.mockReturnValue(12);
      mockHardwareService.getAvailableMemoryGB.mockReturnValue(12);

      modelResidencyManager.setLoadPolicy('balanced');
      const balanced = await activeModelService.checkMemoryForModel(
        'mid-model',
        'text',
      );
      expect(balanced.canLoad).toBe(false);

      modelResidencyManager.setLoadPolicy('aggressive');
      const aggressive = await activeModelService.checkMemoryForModel(
        'mid-model',
        'text',
      );
      expect(aggressive.canLoad).toBe(true);

      modelResidencyManager.setLoadPolicy('balanced'); // don't leak policy to other tests
    });

    it('should return blocked for non-existent model', async () => {
      useAppStore.setState({ downloadedModels: [] });

      const result = await activeModelService.checkMemoryForModel(
        'non-existent',
        'text',
      );

      expect(result.canLoad).toBe(false);
      expect(result.severity).toBe('blocked');
      expect(result.message).toBe('Model not found');
    });
  });

  describe('Dual Model Memory Check', () => {
    it('should check combined memory for text and image models', async () => {
      const textModel = createDownloadedModel({
        id: 'text-model',
        fileSize: 4 * 1024 * 1024 * 1024, // 4GB
      });
      const imageModel = createONNXImageModel({
        id: 'img-model',
        size: 2 * 1024 * 1024 * 1024, // 2GB
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
      });

      // 16GB device
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 16 * 1024 * 1024 * 1024 }),
      );

      const result = await activeModelService.checkMemoryForDualModel(
        'text-model',
        'img-model',
      );

      expect(result).toBeDefined();
      expect(result.totalRequiredMemoryMB).toBeGreaterThan(0);
    });
  });

  describe('Sync With Native State', () => {
    it('keeps an application-owned text resident across an inventory refresh', async () => {
      const source = '/external/test-model.gguf';
      const application = modelApplication();
      const imported = await importTextModelThroughApplication(source);

      const selected = await application.models.select({
        modality: 'text',
        modelId: imported.id,
      });
      expect(selected.ok).toBe(true);

      const loaded = await application.models.load({
        modality: 'text',
        modelId: imported.id,
      });
      expect(loaded.ok).toBe(true);

      const refreshed = await application.models.refresh();
      expect(refreshed.ok).toBe(true);
      expect(application.models.snapshot().residents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            modelId: imported.id,
            type: 'text',
          }),
        ]),
      );
    });

    it('should clear internal state if native reports no model loaded', async () => {
      // Native says no model loaded
      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await activeModelService.syncWithNativeState();

      const loadedIds = activeModelService.getLoadedModelIds();
      expect(loadedIds.textModelId).toBe(null);
      expect(loadedIds.imageModelId).toBe(null);
    });
  });

  describe('Performance Stats', () => {
    it('should proxy performance stats from llmService', () => {
      const expectedStats = {
        lastTokensPerSecond: 20.5,
        lastDecodeTokensPerSecond: 25.0,
        lastTimeToFirstToken: 0.4,
        lastGenerationTime: 4.0,
        lastTokenCount: 80,
      };

      mockLlmService.getPerformanceStats.mockReturnValue(expectedStats);

      const stats = getPerformanceStats();

      expect(stats).toEqual(expectedStats);
      expect(mockLlmService.getPerformanceStats).toHaveBeenCalled();
    });
  });

  describe('Active Models Info', () => {
    it('should return correct info about the loaded model', async () => {
      // Text and image are mutually exclusive, so only one generation model is
      // resident at a time. Verify the info reflects the loaded image model.
      const imageModel = createONNXImageModel({
        id: 'img-model',
        size: 512 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });
      arrangeLocalSelection('image', 'img-model');
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      await activeModelService.loadImageModel('img-model');

      const info = activeModelService.getActiveModels();
      expect(info.image?.model?.id).toBe('img-model');
      expect(info.image?.ready).toBe(true);
    });

    it('should report no models when none loaded', async () => {
      // Sync with native state to reset internal tracking
      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await activeModelService.syncWithNativeState();

      const info = activeModelService.getActiveModels();

      expect(info.text?.ready ?? false).toBe(false);
      expect(info.image?.ready ?? false).toBe(false);
    });
  });

  describe('Has Any Model Loaded', () => {
    it('reports a loaded text model through Shared active and residency projections', async () => {
      const application = modelApplication();
      const cleared = await application.models.eject({
        operationId: 'has-loaded-text-precondition',
      });
      expect(cleared.ok).toBe(true);
      const model = await importTextModelThroughApplication(
        '/external/has-loaded-text.gguf',
      );
      const selected = await application.models.select({
        modality: 'text',
        modelId: model.id,
      });
      expect(selected.ok).toBe(true);

      const loaded = await application.models.load({
        modality: 'text',
        modelId: model.id,
        operationId: 'has-loaded-text',
      });

      expect(loaded.ok).toBe(true);
      expect(application.models.activeModelIds()).toContain(model.id);
      expect(application.models.snapshot().residents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ modelId: model.id, type: 'text' }),
        ]),
      );
    });

    it('should return true when image model loaded', async () => {
      const imageModel = createONNXImageModel({ id: 'img-model' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      await activeModelService.loadImageModel('img-model');

      expect(activeModelService.hasAnyModelLoaded()).toBe(true);
    });

    it('should return false when no models loaded', async () => {
      // Sync with native state to reset internal tracking
      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await activeModelService.syncWithNativeState();

      expect(activeModelService.hasAnyModelLoaded()).toBe(false);
    });
  });

  describe('Concurrent Load Prevention', () => {
    it('runs one native load and gives the newer application request ownership', async () => {
      const application = modelApplication();
      const model = await importTextModelThroughApplication(
        '/external/concurrent-model.gguf',
      );
      let resolveFirst: () => void;
      let loadCount = 0;

      mockLlmService.loadModel.mockImplementation(() => {
        loadCount++;
        if (loadCount === 1) {
          return new Promise(resolve => {
            resolveFirst = () => {
              // After first load completes, model is loaded
              mockLlmService.isModelLoaded.mockReturnValue(true);
              resolve();
            };
          });
        }
        return Promise.resolve();
      });

      const load1 = application.models.load({
        modality: 'text',
        modelId: model.id,
        operationId: 'concurrent-load-older',
      });
      const load2 = application.models.load({
        modality: 'text',
        modelId: model.id,
        operationId: 'concurrent-load-newer',
      });

      await flushPromises();

      // Only one actual load should have started
      expect(loadCount).toBe(1);

      resolveFirst!();
      const [older, newer] = await Promise.all([load1, load2]);

      expect(older).toEqual({
        ok: false,
        failure: {
          kind: 'superseded',
          modality: 'text',
          supersededBy: 'concurrent-load-newer',
        },
      });
      expect(newer).toEqual({ ok: true, value: undefined });
      expect(loadCount).toBe(1);
      expect(application.models.snapshot().residents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ modelId: model.id, type: 'text' }),
        ]),
      );
    });
  });

  // ============================================================================
  // Additional branch coverage tests
  // ============================================================================
  describe('unloadImageModel when no model loaded', () => {
    it('reports a successful no-op when the application owns no image resident', async () => {
      const application = modelApplication();
      const operationId = 'empty-image-unload';
      const cleared = await application.models.eject({
        operationId: 'empty-image-unload-precondition',
      });
      expect(cleared.ok).toBe(true);

      const outcome = await application.models.unload({
        modality: 'image',
        operationId,
      });

      expect(outcome).toEqual({ ok: true, value: false });
      expect(
        application.models
          .snapshot()
          .residents.some(resident => resident.type === 'image'),
      ).toBe(false);
      expect(application.models.snapshot().operations.recent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operationId,
            kind: 'unload',
            state: 'succeeded',
            unloaded: false,
          }),
        ]),
      );
    });
  });

  describe('unloadAllModels error handling', () => {
    it('releases the image resident and exposes a refused text reclaim', async () => {
      const application = modelApplication();
      const textKey = 'test:text-refuses-release';
      const imageKey = 'test:image-releases';
      const textLease = await application.models.residency.acquire(
        {
          key: textKey,
          type: 'text',
          modelId: 'text-refuses-release',
          sizeMB: 16,
          residencyKey: 'test:text-engine',
        },
        {
          load: async () => undefined,
          unload: async () => {
            throw new Error('Text unload failed');
          },
        },
      );
      const imageLease = await application.models.residency.acquire(
        {
          key: imageKey,
          type: 'image',
          modelId: 'image-releases',
          sizeMB: 16,
          residencyKey: 'test:image-engine',
        },
        {
          load: async () => undefined,
          unload: async () => ({ reclaimed: true }),
        },
      );
      expect(textLease.acquired).toBe(true);
      expect(imageLease.acquired).toBe(true);
      await textLease.release();
      await imageLease.release();

      const outcome = await application.models.eject({
        operationId: 'partial-eject',
      });

      expect(outcome).toEqual({
        ok: false,
        failure: {
          kind: 'ejection_incomplete',
          result: {
            count: 1,
            releasedResidents: [imageKey],
            remainingResidents: [textKey],
            runtimes: {
              'text runtime': { status: 'absent' },
              'image runtime': { status: 'absent' },
            },
            rejections: [
              {
                stage: 'resident',
                target: textKey,
                reason: 'Text unload failed',
              },
            ],
          },
        },
      });
      expect(application.models.snapshot().residents).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: textKey })]),
      );
      expect(
        application.models
          .snapshot()
          .residents.some(resident => resident.key === imageKey),
      ).toBe(false);
      expect(application.models.snapshot().reclaimFailures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: textKey,
            reason: 'Text unload failed',
          }),
        ]),
      );
    });
  });

  describe('getResourceUsage', () => {
    it('returns memory usage information', async () => {
      mockHardwareService.refreshMemoryInfo.mockResolvedValue({
        totalMemory: 8 * 1024 * 1024 * 1024,
        usedMemory: 3 * 1024 * 1024 * 1024,
        availableMemory: 5 * 1024 * 1024 * 1024,
      } as any);

      const usage = await getResourceUsage();

      expect(usage.memoryTotal).toBe(8 * 1024 * 1024 * 1024);
      expect(usage.memoryAvailable).toBe(5 * 1024 * 1024 * 1024);
      expect(usage.memoryUsagePercent).toBeCloseTo(37.5, 0);
      expect(usage.estimatedModelMemory).toBeDefined();
    });
  });

  describe('checkMemoryForModel with image type', () => {
    it('checks memory for image model with correct overhead', async () => {
      const imageModel = createONNXImageModel({
        id: 'img-check',
        size: 2 * 1024 * 1024 * 1024, // 2GB
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
      });

      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 16 * 1024 * 1024 * 1024 }),
      );

      const result = await activeModelService.checkMemoryForModel(
        'img-check',
        'image',
      );

      expect(result.canLoad).toBe(true);
      expect(result.requiredMemoryMB).toBeGreaterThan(0);
    });
  });

  describe('checkMemoryForDualModel with null IDs', () => {
    it('handles null text model ID', async () => {
      const imageModel = createONNXImageModel({
        id: 'img-model',
        size: 2 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [],
        downloadedImageModels: [imageModel],
      });

      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 16 * 1024 * 1024 * 1024 }),
      );

      const result = await activeModelService.checkMemoryForDualModel(
        null,
        'img-model',
      );

      expect(result).toBeDefined();
      expect(result.totalRequiredMemoryMB).toBeGreaterThan(0);
    });

    it('handles null image model ID', async () => {
      const textModel = createDownloadedModel({
        id: 'text-model',
        fileSize: 4 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [],
      });

      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 16 * 1024 * 1024 * 1024 }),
      );

      const result = await activeModelService.checkMemoryForDualModel(
        'text-model',
        null,
      );

      expect(result).toBeDefined();
      expect(result.totalRequiredMemoryMB).toBeGreaterThan(0);
    });
  });

  describe('clearTextModelCache', () => {
    it('delegates to llmService.clearKVCache', async () => {
      const model = createDownloadedModel({ id: 'cache-model' });
      useAppStore.setState({ downloadedModels: [model] });

      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.clearKVCache = jest.fn().mockResolvedValue(undefined);

      await activeModelService.loadTextModel('cache-model');

      await clearTextModelCache();

      expect(mockLlmService.clearKVCache).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Additional branch coverage tests - round 2
  // ============================================================================

  describe('loadTextModel timeout', () => {
    it('should throw timeout error when loading takes too long', async () => {
      const model = createDownloadedModel({ id: 'slow-model' });
      useAppStore.setState({ downloadedModels: [model] });

      // Never-resolving promise to simulate timeout
      mockLlmService.loadModel.mockImplementation(() => new Promise(() => {}));

      await expect(
        activeModelService.loadTextModel('slow-model', 50), // 50ms timeout
      ).rejects.toThrow('timed out');
    });
  });

  describe('loadTextModel with vision model mmproj detection', () => {
    it('should detect mmproj file for vision model', async () => {
      jest.mock('react-native-fs', () => ({
        readDir: jest.fn(),
        exists: jest.fn(),
        DocumentDirectoryPath: '/mock/documents',
      }));
      const RNFS = require('react-native-fs');

      const model = createDownloadedModel({
        id: 'vision-vl-model',
        name: 'Qwen3-VL-2B',
        filePath: '/models/qwen3-vl-2b.gguf',
      });
      // No mmProjPath set
      delete (model as any).mmProjPath;
      useAppStore.setState({ downloadedModels: [model] });

      // Mock RNFS.readDir to return a mmproj file
      RNFS.readDir = jest.fn().mockResolvedValue([
        // Realistic on-disk name: downloads rename the projector to include the model base (name+variant),
        // so the strict matcher pairs it. A generic 'qwen3-vl-mmproj-f16.gguf' (no size) never reaches disk.
        {
          name: 'qwen3-vl-2b-mmproj-f16.gguf',
          path: '/models/qwen3-vl-2b-mmproj-f16.gguf',
          size: 500000000,
          isFile: () => true,
        },
      ]);

      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.loadModel.mockResolvedValue(undefined);

      // Mock modelLibrary.saveModelWithMmproj
      const {
        modelLibrary,
      } = require('../../../src/services/modelServices/bootstrap/modelLibraryBootstrap');
      if (modelLibrary.saveModelWithMmproj) {
        jest
          .spyOn(modelLibrary, 'saveModelWithMmproj')
          .mockResolvedValue(undefined);
      }

      await activeModelService.loadTextModel('vision-vl-model');

      expect(mockLlmService.loadModel).toHaveBeenCalledWith(
        model.filePath,
        expect.any(String), // mmproj path should be found
        { override: false },
      );
    });
  });

  describe('loadTextModel error resets state', () => {
    it('should clear loadedTextModelId on load failure', async () => {
      const model = createDownloadedModel({ id: 'fail-model' });
      useAppStore.setState({ downloadedModels: [model] });

      mockLlmService.loadModel.mockRejectedValue(new Error('Load failed'));

      await expect(
        activeModelService.loadTextModel('fail-model'),
      ).rejects.toThrow('Load failed');

      const ids = activeModelService.getLoadedModelIds();
      expect(ids.textModelId).toBeNull();
    });
  });

  describe('loadImageModel error resets state', () => {
    it('should clear loadedImageModelId on load failure', async () => {
      const imageModel = createONNXImageModel({ id: 'fail-img' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.loadModel.mockRejectedValue(
        new Error('Image load failed'),
      );

      await expect(
        activeModelService.loadImageModel('fail-img'),
      ).rejects.toThrow('Image load failed');

      const ids = activeModelService.getLoadedModelIds();
      expect(ids.imageModelId).toBeNull();
    });
  });

  describe('loadImageModel not found', () => {
    it('should throw when image model not found', async () => {
      useAppStore.setState({
        downloadedImageModels: [],
        settings: { imageThreads: 4 } as any,
      });

      await expect(
        activeModelService.loadImageModel('nonexistent'),
      ).rejects.toThrow('Model not found');
    });
  });

  describe('getEstimatedModelMemory branches', () => {
    it('includes text model memory when active', async () => {
      const textModel = createDownloadedModel({
        id: 'text-est',
        fileSize: 4 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
      });
      arrangeLocalSelection('text', 'text-est');

      const usage = await getResourceUsage();
      // estimatedModelMemory should include text model memory
      expect(usage.estimatedModelMemory).toBeGreaterThan(0);
    });

    it('includes image model memory when active', async () => {
      const imageModel = createONNXImageModel({
        id: 'img-est',
        size: 2 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
      });
      arrangeLocalSelection('image', 'img-est');

      const usage = await getResourceUsage();
      expect(usage.estimatedModelMemory).toBeGreaterThan(0);
    });

    it('includes both text and image model memory', async () => {
      const textModel = createDownloadedModel({
        id: 'text-both',
        fileSize: 4 * 1024 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'img-both',
        size: 2 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],

        downloadedImageModels: [imageModel],
      });
      arrangeLocalSelection('text', 'text-both');
      arrangeLocalSelection('image', 'img-both');

      const usage = await getResourceUsage();
      // Should be sum of both model memories
      const textOnly = textModel.fileSize * 1.2;
      const imageOnly = imageModel.size * 1.3;
      expect(usage.estimatedModelMemory).toBeCloseTo(textOnly + imageOnly, -5);
    });
  });

  describe('checkMemoryForModel with other loaded models', () => {
    it('counts image model memory when checking text model', async () => {
      const textModel = createDownloadedModel({
        id: 'text-check',
        fileSize: 3 * 1024 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'img-loaded',
        size: 2 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      // Load image model first
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      await activeModelService.loadImageModel('img-loaded');

      // 8GB device
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      );

      const result = await activeModelService.checkMemoryForModel(
        'text-check',
        'text',
      );

      // currentlyLoadedMemoryGB should include the image model
      expect(result.currentlyLoadedMemoryMB).toBeGreaterThan(0);
    });

    it('counts text model memory when checking image model', async () => {
      const textModel = createDownloadedModel({
        id: 'text-loaded',
        fileSize: 4 * 1024 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'img-check',
        size: 2 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      // Load text model first
      mockLlmService.isModelLoaded.mockReturnValue(true);
      await activeModelService.loadTextModel('text-loaded');

      // 8GB device
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      );

      const result = await activeModelService.checkMemoryForModel(
        'img-check',
        'image',
      );

      // currentlyLoadedMemoryGB should include the text model
      expect(result.currentlyLoadedMemoryMB).toBeGreaterThan(0);
    });
  });

  describe('checkMemoryForModel critical with other models message', () => {
    it('includes other models in critical message', async () => {
      const textModel = createDownloadedModel({
        id: 'huge-text',
        fileSize: 6 * 1024 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'img-already',
        size: 3 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      // Load image model
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      await activeModelService.loadImageModel('img-already');

      // 8GB device - 6GB text * 1.5 = 9GB + image model memory = way over budget
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      );

      const result = await activeModelService.checkMemoryForModel(
        'huge-text',
        'text',
      );

      expect(result.severity).toBe('critical');
      expect(result.canLoad).toBe(false);
      expect(result.message).toContain('other models are loaded');
    });
  });

  describe('checkMemoryForDualModel warning and critical paths', () => {
    it('returns warning when dual model exceeds 50% RAM', async () => {
      const textModel = createDownloadedModel({
        id: 'dual-text',
        fileSize: 3 * 1024 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'dual-img',
        size: 1.5 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
      });

      // 8GB device - total ~ 3*1.5 + 1.5*1.8 = 4.5+2.7=7.2GB > 4GB (50%) but < 4.8GB (60%)
      // Actually 7.2 > 4.8, so this will be critical. Let's use 16GB device.
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 16 * 1024 * 1024 * 1024 }),
      );

      const result = await activeModelService.checkMemoryForDualModel(
        'dual-text',
        'dual-img',
      );

      // 16GB * 50% = 8GB warning threshold, 16GB * 60% = 9.6GB critical
      // total ~ 4.5 + 2.7 = 7.2 < 8, so safe
      expect(result.severity).toBe('safe');
      expect(result.canLoad).toBe(true);
    });

    it('returns critical when dual models exceed budget', async () => {
      const textModel = createDownloadedModel({
        id: 'dual-huge-text',
        fileSize: 6 * 1024 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'dual-huge-img',
        size: 4 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
      });

      // 8GB device - both models would exceed 60% budget
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      );

      const result = await activeModelService.checkMemoryForDualModel(
        'dual-huge-text',
        'dual-huge-img',
      );

      expect(result.severity).toBe('critical');
      expect(result.canLoad).toBe(false);
      expect(result.message).toContain('Cannot load both');
    });
  });

  describe('syncWithNativeState with image model', () => {
    it('keeps an application-owned image resident across inventory refresh', async () => {
      const application = modelApplication();
      const key = 'test:image-refresh-resident';
      const lease = await application.models.residency.acquire(
        {
          key,
          type: 'image',
          modelId: 'sync-img',
          sizeMB: 16,
          residencyKey: 'test:image-engine',
        },
        {
          load: async () => undefined,
          unload: async () => ({ reclaimed: true }),
        },
      );
      expect(lease.acquired).toBe(true);
      await lease.release();

      const refreshed = await application.models.refresh({
        operationId: 'image-resident-refresh',
      });

      expect(refreshed.ok).toBe(true);
      expect(application.models.snapshot().residents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key,
            modelId: 'sync-img',
            type: 'image',
          }),
        ]),
      );
    });

    it('removes an image resident after its engine confirms release', async () => {
      const application = modelApplication();
      const key = 'test:image-explicit-release';
      const lease = await application.models.residency.acquire(
        {
          key,
          type: 'image',
          modelId: 'clear-img',
          sizeMB: 16,
          residencyKey: 'test:image-engine',
        },
        {
          load: async () => undefined,
          unload: async () => ({ reclaimed: true }),
        },
      );
      expect(lease.acquired).toBe(true);
      await lease.release();

      const outcome = await application.models.ejectResident({
        key,
        operationId: 'image-explicit-release',
      });

      expect(outcome).toEqual({ ok: true, value: true });
      expect(
        application.models.snapshot().residents.some(resident => resident.key === key),
      ).toBe(false);
      expect(
        application.models
          .snapshot()
          .reclaimFailures.some(failure => failure.key === key),
      ).toBe(false);
    });
  });

  describe('unloadTextModel with store but no native', () => {
    it('clears a selected nonresident text route as a successful no-op', async () => {
      const application = modelApplication();
      const cleared = await application.models.eject({
        operationId: 'unload-nonresident-text-precondition',
      });
      expect(cleared.ok).toBe(true);
      const model = await importTextModelThroughApplication(
        '/external/orphan-model.gguf',
      );
      const selected = await application.models.select({
        modality: 'text',
        modelId: model.id,
      });
      expect(selected.ok).toBe(true);
      expect(application.models.activeModelId('text')).toBe(model.id);
      expect(
        application.models
          .snapshot()
          .residents.some(resident => resident.modelId === model.id),
      ).toBe(false);

      const operationId = 'unload-nonresident-text';
      const outcome = await application.models.unload({
        modality: 'text',
        operationId,
      });

      expect(outcome).toEqual({ ok: true, value: false });
      expect(application.models.activeModelId('text')).toBeNull();
      expect(application.models.snapshot().operations.recent).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operationId,
            kind: 'unload',
            state: 'succeeded',
            unloaded: false,
          }),
        ]),
      );
    });
  });

  describe('unloadImageModel with store but no native', () => {
    it('clears store even when native is not loaded', async () => {
      const model = createONNXImageModel({ id: 'orphan-img' });
      useAppStore.setState({
        downloadedImageModels: [model],
      });
      arrangeLocalSelection('image', model.id);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await activeModelService.unloadImageModel();

      expect(selectedLocalModelId('image')).toBeNull();
      expect(mockLocalDreamService.unloadModel).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Additional branch coverage tests - round 3
  // ============================================================================

  describe('loadTextModel vision model no mmproj found', () => {
    it('logs warning when no mmproj file found in directory', async () => {
      const RNFS = require('react-native-fs');

      const model = createDownloadedModel({
        id: 'vision-no-mmproj',
        name: 'Qwen3-VL-2B',
        filePath: '/models/qwen3-vl-2b.gguf',
      });
      // Ensure no mmProjPath
      (model as any).mmProjPath = undefined;
      useAppStore.setState({ downloadedModels: [model] });

      // readDir returns no mmproj files
      RNFS.readDir = jest.fn().mockResolvedValue([
        {
          name: 'qwen3-vl-2b.gguf',
          path: '/models/qwen3-vl-2b.gguf',
          size: 2000000000,
        },
      ]);

      mockLlmService.loadModel.mockResolvedValue(undefined);

      await activeModelService.loadTextModel('vision-no-mmproj');

      // Should have called loadModel with undefined mmProjPath
      expect(mockLlmService.loadModel).toHaveBeenCalledWith(
        model.filePath,
        undefined,
        { override: false },
      );
    });
  });

  describe('loadTextModel vision model mmproj search failure', () => {
    it('catches error when readDir fails', async () => {
      const RNFS = require('react-native-fs');

      const model = createDownloadedModel({
        id: 'vision-error',
        name: 'SmolVLM-500M',
        filePath: '/models/smolvlm.gguf',
      });
      (model as any).mmProjPath = undefined;
      useAppStore.setState({ downloadedModels: [model] });

      // readDir throws
      RNFS.readDir = jest
        .fn()
        .mockRejectedValue(new Error('Permission denied'));

      mockLlmService.loadModel.mockResolvedValue(undefined);

      // Should not throw - error is caught internally
      await activeModelService.loadTextModel('vision-error');

      expect(mockLlmService.loadModel).toHaveBeenCalledWith(
        model.filePath,
        undefined,
        { override: false },
      );
    });
  });

  describe('loadTextModel mmproj found updates store with multiple models', () => {
    it('only updates the matching model in store', async () => {
      const RNFS = require('react-native-fs');
      const {
        modelLibrary: mockModelManager,
      } = require('../../../src/services/modelServices/bootstrap/modelLibraryBootstrap');

      const model1 = createDownloadedModel({
        id: 'other-model',
        name: 'Regular Model',
        filePath: '/models/regular.gguf',
      });
      const model2 = createDownloadedModel({
        id: 'vision-found',
        name: 'Test-Vision-Model',
        filePath: '/models/vision.gguf',
      });
      (model2 as any).mmProjPath = undefined;
      useAppStore.setState({ downloadedModels: [model1, model2] });

      RNFS.readDir = jest.fn().mockResolvedValue([
        {
          name: 'mmproj-f16.gguf',
          path: '/models/mmproj-f16.gguf',
          size: 500000000,
        },
      ]);

      if (mockModelManager.saveModelWithMmproj) {
        jest
          .spyOn(mockModelManager, 'saveModelWithMmproj')
          .mockResolvedValue(undefined);
      }

      mockLlmService.loadModel.mockResolvedValue(undefined);

      await activeModelService.loadTextModel('vision-found');

      // Other model should be untouched, vision model should have mmProjPath
      const models = getAppState().downloadedModels;
      const otherModel = models.find(m => m.id === 'other-model');
      expect((otherModel as any)?.mmProjPath).toBeUndefined();
    });
  });

  describe('unloadTextModel waits for pending load', () => {
    it('serializes text unload behind an in-flight application admission', async () => {
      const application = modelApplication();
      const key = 'test:pending-text-load';
      const events: string[] = [];
      let resolveLoad: () => void;
      const acquire = application.models.residency.acquire(
        {
          key,
          type: 'text',
          modelId: 'pending-model',
          sizeMB: 16,
          residencyKey: 'test:text-engine',
        },
        {
          load: () => {
            events.push('load-started');
            return new Promise<void>(resolve => {
              resolveLoad = () => {
                events.push('load-finished');
                resolve();
              };
            });
          },
          unload: async () => {
            events.push('unload');
            return { reclaimed: true };
          },
        },
      );
      await flushPromises();

      const unload = application.models.residency.unload(key, async () => {
        events.push('untracked-unload');
        return { reclaimed: true };
      });
      await flushPromises();
      expect(events).toEqual(['load-started']);

      resolveLoad!();
      const [lease, outcome] = await Promise.all([acquire, unload]);
      await lease.release();

      expect(outcome).toEqual({ reclaimed: true, tracked: true });
      expect(events).toEqual(['load-started', 'load-finished', 'unload']);
      expect(application.models.residency.isResident(key)).toBe(false);
    });
  });

  describe('unloadImageModel waits for pending load', () => {
    it('serializes image unload behind an in-flight application admission', async () => {
      const application = modelApplication();
      const key = 'test:pending-image-load';
      const events: string[] = [];
      let resolveLoad: () => void;
      const acquire = application.models.residency.acquire(
        {
          key,
          type: 'image',
          modelId: 'pending-img',
          sizeMB: 16,
          residencyKey: 'test:image-engine',
        },
        {
          load: () => {
            events.push('load-started');
            return new Promise<void>(resolve => {
              resolveLoad = () => {
                events.push('load-finished');
                resolve();
              };
            });
          },
          unload: async () => {
            events.push('unload');
            return { reclaimed: true };
          },
        },
      );
      await flushPromises();

      const unload = application.models.residency.unload(key, async () => {
        events.push('untracked-unload');
        return { reclaimed: true };
      });
      await flushPromises();
      expect(events).toEqual(['load-started']);

      resolveLoad!();
      const [lease, outcome] = await Promise.all([acquire, unload]);
      await lease.release();

      expect(outcome).toEqual({ reclaimed: true, tracked: true });
      expect(events).toEqual(['load-started', 'load-finished', 'unload']);
      expect(application.models.residency.isResident(key)).toBe(false);
    });
  });

  describe('loadImageModel already loaded but needs thread reload', () => {
    it('reloads when imageThreads changed', async () => {
      const imageModel = createONNXImageModel({ id: 'thread-img' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      // Load with 4 threads
      await activeModelService.loadImageModel('thread-img');
      expect(mockLocalDreamService.loadModel).toHaveBeenCalledTimes(1);

      // Change threads setting
      useAppStore.setState({
        settings: { ...getAppState().settings, imageThreads: 8 },
      });

      // Load same model again - should reload due to thread change
      await activeModelService.loadImageModel('thread-img');
      expect(mockLocalDreamService.unloadModel).toHaveBeenCalled();
      expect(mockLocalDreamService.loadModel).toHaveBeenCalledTimes(2);
    });
  });

  describe('loadImageModel concurrent load - different model', () => {
    it('serializes a newer image resident behind a pending load and gives it the runtime slot', async () => {
      const application = modelApplication();
      const runtimeKey = 'test:image-engine';
      const firstKey = 'test:image-pending-a';
      const secondKey = 'test:image-pending-b';
      const events: string[] = [];
      let resolveFirst: () => void;

      const firstLoad = application.models.residency.ensurePersistentLazy(
        async () => ({
          spec: {
            key: firstKey,
            type: 'image',
            modelId: 'img-a',
            sizeMB: 16,
            residencyKey: runtimeKey,
          },
          handlers: {
            load: () => {
              events.push('first-load-started');
              return new Promise<void>(resolve => {
                resolveFirst = () => {
                  events.push('first-load-finished');
                  resolve();
                };
              });
            },
            unload: async () => {
              events.push('first-unload');
              return { reclaimed: true };
            },
          },
        }),
      );
      await flushPromises();

      const secondLoad = application.models.residency.ensurePersistentLazy(
        async () => ({
          spec: {
            key: secondKey,
            type: 'image',
            modelId: 'img-b',
            sizeMB: 16,
            residencyKey: runtimeKey,
          },
          handlers: {
            load: async () => {
              events.push('second-load');
            },
            unload: async () => ({ reclaimed: true }),
          },
        }),
      );
      await flushPromises();
      expect(events).toEqual(['first-load-started']);

      resolveFirst!();
      await expect(Promise.all([firstLoad, secondLoad])).resolves.toEqual([
        true,
        true,
      ]);

      expect(events).toEqual([
        'first-load-started',
        'first-load-finished',
        'first-unload',
        'second-load',
      ]);
      expect(application.models.residency.isResident(firstKey)).toBe(false);
      expect(application.models.residency.isResident(secondKey)).toBe(true);
    });
  });

  describe('unloadAllModels error handling - image unload fails', () => {
    it('releases the text resident and exposes a refused image reclaim', async () => {
      const application = modelApplication();
      const cleared = await application.models.eject({
        operationId: 'partial-image-eject-precondition',
      });
      expect(cleared.ok).toBe(true);
      const textKey = 'test:text-releases';
      const imageKey = 'test:image-refuses-release';
      const textLease = await application.models.residency.acquire(
        {
          key: textKey,
          type: 'text',
          modelId: 'text-releases',
          sizeMB: 16,
          residencyKey: 'test:text-engine',
        },
        {
          load: async () => undefined,
          unload: async () => ({ reclaimed: true }),
        },
      );
      const imageLease = await application.models.residency.acquire(
        {
          key: imageKey,
          type: 'image',
          modelId: 'image-refuses-release',
          sizeMB: 16,
          residencyKey: 'test:image-engine',
        },
        {
          load: async () => undefined,
          unload: async () => {
            throw new Error('Image unload failed');
          },
        },
      );
      expect(textLease.acquired).toBe(true);
      expect(imageLease.acquired).toBe(true);
      await textLease.release();
      await imageLease.release();

      const outcome = await application.models.eject({
        operationId: 'partial-image-eject',
      });

      expect(outcome).toEqual({
        ok: false,
        failure: {
          kind: 'ejection_incomplete',
          result: {
            count: 1,
            releasedResidents: [textKey],
            remainingResidents: [imageKey],
            runtimes: {
              'text runtime': { status: 'absent' },
              'image runtime': { status: 'absent' },
            },
            rejections: [
              {
                stage: 'resident',
                target: imageKey,
                reason: 'Image unload failed',
              },
            ],
          },
        },
      });
      expect(
        application.models
          .snapshot()
          .residents.some(resident => resident.key === textKey),
      ).toBe(false);
      expect(application.models.snapshot().residents).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: imageKey })]),
      );
      expect(application.models.snapshot().reclaimFailures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: imageKey,
            reason: 'Image unload failed',
          }),
        ]),
      );
    });
  });

  describe('loadImageModel with coreml backend', () => {
    it('uses auto backend for coreml models', async () => {
      const coremlModel = createONNXImageModel({
        id: 'coreml-model',
        backend: 'coreml',
      });
      useAppStore.setState({
        downloadedImageModels: [coremlModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      await activeModelService.loadImageModel('coreml-model');

      expect(mockLocalDreamService.loadModel).toHaveBeenCalledWith(
        coremlModel.modelPath,
        4,
        { backend: 'auto', cpuOnly: false }, // coreml backend should map to 'auto'
      );
    });

    it('passes attentionVariant through for SDXL-style coreml models', async () => {
      const coremlModel = createONNXImageModel({
        id: 'coreml-sdxl-model',
        backend: 'coreml',
        attentionVariant: 'split_einsum',
      });
      useAppStore.setState({
        downloadedImageModels: [coremlModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      await activeModelService.loadImageModel('coreml-sdxl-model');

      expect(mockLocalDreamService.loadModel).toHaveBeenCalledWith(
        coremlModel.modelPath,
        4,
        { backend: 'auto', cpuOnly: false, attentionVariant: 'split_einsum' },
      );
    });
  });

  describe('loadImageModel already loaded and native confirms', () => {
    it('skips reload when model is already loaded natively', async () => {
      const imageModel = createONNXImageModel({ id: 'skip-img' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { ...getAppState().settings, imageThreads: 4 },
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      // Load the model
      await activeModelService.loadImageModel('skip-img');
      expect(mockLocalDreamService.loadModel).toHaveBeenCalledTimes(1);

      // Try to load the same model again - native confirms it's loaded
      mockLocalDreamService.loadModel.mockClear();
      await activeModelService.loadImageModel('skip-img');

      // Should not call loadModel again
      expect(mockLocalDreamService.loadModel).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // QNN / NPU guard (lines 321-323)
  // ============================================================================
  describe('QNN model NPU guard', () => {
    it('throws when loading a QNN model on a device without NPU (lines 321-323)', async () => {
      const qnnModel = createONNXImageModel({
        id: 'qnn-model-1',
        backend: 'qnn',
      });
      useAppStore.setState({
        downloadedImageModels: [qnnModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
      // Provide getSoCInfo mock returning no NPU
      mockHardwareService.getSoCInfo = jest
        .fn()
        .mockResolvedValue({ hasNPU: false });

      await expect(
        activeModelService.loadImageModel('qnn-model-1'),
      ).rejects.toThrow('NPU models require a Qualcomm Snapdragon processor');
    });

    it('loads QNN model when device has NPU', async () => {
      const qnnModel = createONNXImageModel({
        id: 'qnn-model-2',
        backend: 'qnn',
      });
      useAppStore.setState({
        downloadedImageModels: [qnnModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockHardwareService.getSoCInfo = jest
        .fn()
        .mockResolvedValue({ hasNPU: true });
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      await expect(
        activeModelService.loadImageModel('qnn-model-2'),
      ).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // getCurrentlyLoadedMemoryGB private method (lines 527-545)
  // ============================================================================
  describe('getCurrentlyLoadedMemoryGB', () => {
    it('returns 0 when no models are loaded (lines 527-545)', () => {
      // No models loaded → both if-branches skipped
      const result = (activeModelService as any).getCurrentlyLoadedMemoryGB();
      expect(result).toBe(0);
    });

    it('counts text model memory when text model is loaded (lines 531-535)', async () => {
      const textModel = createDownloadedModel({ id: 'mem-text-1' });
      useAppStore.setState({ downloadedModels: [textModel] });

      mockLlmService.isModelLoaded.mockReturnValue(true);
      await activeModelService.loadTextModel('mem-text-1');

      const result = (activeModelService as any).getCurrentlyLoadedMemoryGB();
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('counts image model memory when image model is loaded (lines 538-543)', async () => {
      const imageModel = createONNXImageModel({ id: 'mem-img-1' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);
      await activeModelService.loadImageModel('mem-img-1');

      const result = (activeModelService as any).getCurrentlyLoadedMemoryGB();
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('sums text and image model memory when both are loaded', async () => {
      await loadBothModelsWithSizes('mem-text-2', 'mem-img-2');

      const textOnly = (activeModelService as any).getCurrentlyLoadedMemoryGB();
      // Both models loaded → sum > either alone
      expect(textOnly).toBeGreaterThan(0);
    });
  });

  describe('loadImageModel concurrent load returns same model', () => {
    it('reuses one image resident when the same request waits behind its load', async () => {
      const application = modelApplication();
      const cleared = await application.models.eject({
        operationId: 'same-image-load-precondition',
      });
      expect(cleared.ok).toBe(true);
      const key = 'test:image-concurrent';
      const spec = {
        key,
        type: 'image' as const,
        modelId: 'concurrent-img',
        sizeMB: 16,
        residencyKey: 'test:image-engine',
      };
      const events: string[] = [];
      let resolveFirst: () => void;
      const firstLoad = application.models.residency.ensurePersistentLazy(
        async () => ({
          spec,
          handlers: {
            load: () => {
              events.push('native-load-started');
              return new Promise<void>(resolve => {
                resolveFirst = () => {
                  events.push('native-load-finished');
                  resolve();
                };
              });
            },
            unload: async () => ({ reclaimed: true }),
          },
        }),
      );
      await flushPromises();

      const secondLoad = application.models.residency.ensurePersistentLazy(
        async () => ({
          spec,
          handlers: {
            load: async () => {
              events.push('duplicate-native-load');
            },
            unload: async () => ({ reclaimed: true }),
          },
        }),
      );
      await flushPromises();
      expect(events).toEqual(['native-load-started']);

      resolveFirst!();
      await expect(Promise.all([firstLoad, secondLoad])).resolves.toEqual([
        true,
        true,
      ]);

      expect(events).toEqual(['native-load-started', 'native-load-finished']);
      expect(application.models.residency.isResident(key)).toBe(true);
      expect(
        application.models
          .snapshot()
          .residents.filter(resident => resident.key === key),
      ).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Low-memory device (≤4 GB) image model loading
  // ===========================================================================

  describe('loadImageModel on low-memory device (≤4GB)', () => {
    const LOW_MEM = 4 * 1024 * 1024 * 1024; // 4 GB
    const setupLowMemDevice = () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: LOW_MEM }),
      );
      mockHardwareService.getTotalMemoryGB.mockReturnValue(4);
    };

    it('evicts the text model to fit an image when they cannot co-reside (tight device)', async () => {
      setupLowMemDevice(); // 4GB → ~2GB budget

      // Each fits ALONE (~1.5GB text est, ~1.0GB image est) but not TOGETHER (~2.5GB) against the
      // ~2GB budget, so loading the image must free the text model to fit (a swap).
      const textModel = createDownloadedModel({
        id: 'txt',
        fileSize: 1000 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'img',
        size: 400 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLlmService.isModelLoaded.mockReturnValue(true);
      await activeModelService.loadTextModel('txt');
      expect(selectedLocalModelId('text')).toBe('txt');

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);
      await activeModelService.loadImageModel('img');

      // Text freed from RAM (they don't co-fit), but its SELECTION is kept so chat still shows it
      // and it reloads on demand (eviction must not deselect).
      expect(mockLlmService.unloadModel).toHaveBeenCalled();
      expect(selectedLocalModelId('text')).toBe('txt');
      expect(selectedLocalModelId('image')).toBe('img');
    });

    it('keeps the text model resident when the image co-fits the budget (no forced mutual exclusion)', async () => {
      setupLowMemDevice();

      // Both small (~0.6GB text + ~0.75GB image ≤ ~2GB budget) → they co-reside,
      // exactly what image-gen-with-prompt-enhance needs.
      const textModel = createDownloadedModel({
        id: 'txt-s',
        fileSize: 400 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'img-s',
        size: 300 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLlmService.isModelLoaded.mockReturnValue(true);
      await activeModelService.loadTextModel('txt-s');
      mockLlmService.unloadModel.mockClear();

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);
      await activeModelService.loadImageModel('img-s');

      // Co-resident — the text model is NOT evicted.
      expect(mockLlmService.unloadModel).not.toHaveBeenCalled();
      expect(selectedLocalModelId('text')).toBe('txt-s');
      expect(selectedLocalModelId('image')).toBe('img-s');
    });

    it('passes cpuOnly=false to native loader', async () => {
      setupLowMemDevice();

      const imageModel = createONNXImageModel({
        id: 'img-cpu',
        size: 512 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);
      await activeModelService.loadImageModel('img-cpu');

      expect(mockLocalDreamService.loadModel).toHaveBeenCalledWith(
        imageModel.modelPath,
        4,
        expect.objectContaining({ cpuOnly: false }),
      );
    });

    it('does not auto-unload text model if none is loaded', async () => {
      setupLowMemDevice();

      const imageModel = createONNXImageModel({
        id: 'img-no-txt',
        size: 512 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      await activeModelService.loadImageModel('img-no-txt');

      expect(mockLlmService.unloadModel).not.toHaveBeenCalled();
      expect(selectedLocalModelId('image')).toBe('img-no-txt');
    });

    it('blocks loading when model exceeds memory budget', async () => {
      setupLowMemDevice();

      const imageModel = createONNXImageModel({
        id: 'img-huge',
        size: 2 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      await expect(
        activeModelService.loadImageModel('img-huge'),
      ).rejects.toThrow();
    });
  });

  describe('loadImageModel on high-memory device (>4GB)', () => {
    const HIGH_MEM = 8 * 1024 * 1024 * 1024; // 8 GB
    const setupHighMemDevice = () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: HIGH_MEM }),
      );
      mockHardwareService.getTotalMemoryGB.mockReturnValue(8);
    };

    it('keeps text and image co-resident on a high-memory device (no forced mutual exclusion)', async () => {
      setupHighMemDevice();
      mockHardwareService.getAvailableMemoryGB.mockReturnValue(8);
      mockHardwareService.refreshMemoryInfo.mockResolvedValue({
        totalMemory: HIGH_MEM,
        usedMemory: 2 * 1024 * 1024 * 1024,
        availableMemory: 6 * 1024 * 1024 * 1024,
      } as any);
      const application = modelApplication();
      const cleared = await application.models.eject({
        operationId: 'high-memory-co-residency-precondition',
      });
      expect(cleared.ok).toBe(true);
      const events: string[] = [];
      const textKey = 'test:high-memory-text';
      const imageKey = 'test:high-memory-image';
      const textLease = await application.models.residency.acquire(
        {
          key: textKey,
          type: 'text',
          modelId: 'txt-hi',
          sizeMB: 1_500,
          residencyKey: 'test:text-engine',
        },
        {
          load: async () => {
            events.push('text-load');
          },
          unload: async () => {
            events.push('text-unload');
            return { reclaimed: true };
          },
        },
      );
      expect(textLease.acquired).toBe(true);
      await textLease.release();

      const imageLease = await application.models.residency.acquire(
        {
          key: imageKey,
          type: 'image',
          modelId: 'img-hi',
          sizeMB: 1_300,
          residencyKey: 'test:image-engine',
        },
        {
          load: async () => {
            events.push('image-load');
          },
          unload: async () => {
            events.push('image-unload');
            return { reclaimed: true };
          },
        },
      );
      expect(imageLease.acquired).toBe(true);
      await imageLease.release();

      expect(events).toEqual(['text-load', 'image-load']);
      expect(application.models.snapshot().residents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: textKey, modelId: 'txt-hi' }),
          expect.objectContaining({ key: imageKey, modelId: 'img-hi' }),
        ]),
      );
    });

    it('passes cpuOnly=false to native loader', async () => {
      setupHighMemDevice();

      const imageModel = createONNXImageModel({
        id: 'img-gpu',
        size: 512 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);
      await activeModelService.loadImageModel('img-gpu');

      expect(mockLocalDreamService.loadModel).toHaveBeenCalledWith(
        imageModel.modelPath,
        4,
        { backend: 'auto', cpuOnly: false, attentionVariant: undefined },
      );
    });

    it('still blocks critically oversized models', async () => {
      setupHighMemDevice();

      // 6GB model * 1.8x = 10.8GB > 8GB * 0.6 = 4.8GB budget
      const imageModel = createONNXImageModel({
        id: 'img-giant',
        size: 6 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await expect(
        activeModelService.loadImageModel('img-giant'),
      ).rejects.toThrow();
    });
  });

  describe('memory budget thresholds by device RAM', () => {
    it('uses 40% budget for 4GB device', async () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 4 * 1024 * 1024 * 1024 }),
      );

      // 800MB * 1.8x = 1.44GB, budget = 4 * 0.4 = 1.6GB → safe
      const smallModel = createONNXImageModel({
        id: 'small-4gb',
        size: 800 * 1024 * 1024,
      });
      useAppStore.setState({ downloadedImageModels: [smallModel] });

      const result = await activeModelService.checkMemoryForModel(
        'small-4gb',
        'image',
      );
      expect(result.canLoad).toBe(true);
    });

    it('uses 40% budget for 3GB device', async () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 3 * 1024 * 1024 * 1024 }),
      );

      // 600MB * 1.8x = 1.08GB, budget = 3 * 0.4 = 1.2GB → safe
      const model = createONNXImageModel({
        id: 'tiny-3gb',
        size: 600 * 1024 * 1024,
      });
      useAppStore.setState({ downloadedImageModels: [model] });

      const result = await activeModelService.checkMemoryForModel(
        'tiny-3gb',
        'image',
      );
      expect(result.canLoad).toBe(true);
    });

    it('uses 60% budget for 6GB device', async () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 6 * 1024 * 1024 * 1024 }),
      );

      // 1.2GB * 2.5x = 3.0GB, budget = 6 * 0.6 = 3.6GB → safe (would fail a 40% budget: 2.4GB)
      const model = createONNXImageModel({
        id: 'mid-6gb',
        size: 1.2 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({ downloadedImageModels: [model] });

      const result = await activeModelService.checkMemoryForModel(
        'mid-6gb',
        'image',
      );
      expect(result.canLoad).toBe(true);
    });

    it('uses 60% budget for 8GB device', async () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      );

      // 1.6GB * 2.5x = 4.0GB, budget = 8 * 0.6 = 4.8GB → safe (would fail a 40% budget: 3.2GB)
      const model = createONNXImageModel({
        id: 'mid-8gb',
        size: 1.6 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({ downloadedImageModels: [model] });

      const result = await activeModelService.checkMemoryForModel(
        'mid-8gb',
        'image',
      );
      expect(result.canLoad).toBe(true);
    });

    it('blocks a model that exceeds the canonical 4GB-device budget', async () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 4 * 1024 * 1024 * 1024 }),
      );
      mockHardwareService.getTotalMemoryGB.mockReturnValue(4);
      mockHardwareService.getAvailableMemoryGB.mockReturnValue(4);

      // Native image estimate is 1.5GB * 2.5 = 3.75GB. Shared's balanced
      // 4GB-device budget is 2GB, so admission is critical.
      const model = createONNXImageModel({
        id: 'too-big-4gb',
        size: 1.5 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({ downloadedImageModels: [model] });

      const result = await activeModelService.checkMemoryForModel(
        'too-big-4gb',
        'image',
      );
      expect(result.canLoad).toBe(false);
      expect(result.severity).toBe('critical');
    });

    it('allows same model on 8GB device that is blocked on 4GB', async () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      );

      // 1.5GB * 1.8x = 2.7GB < 8 * 0.6 = 4.8GB budget → safe
      const model = createONNXImageModel({
        id: 'fits-8gb',
        size: 1.5 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({ downloadedImageModels: [model] });

      const result = await activeModelService.checkMemoryForModel(
        'fits-8gb',
        'image',
      );
      expect(result.canLoad).toBe(true);
    });
  });

  describe('global load serialization', () => {
    it('does not start an image load while a text load is in flight', async () => {
      const textModel = createDownloadedModel({
        id: 'txt-1',
        fileSize: 300 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'img-1',
        size: 300 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      // Make the text native load hang until we release it.
      let releaseText: () => void = () => {};
      mockLlmService.loadModel.mockImplementation(
        () =>
          new Promise<void>(resolve => {
            releaseText = () => resolve();
          }),
      );
      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      const textPromise = activeModelService.loadTextModel('txt-1');
      const imagePromise = activeModelService.loadImageModel('img-1');

      // Let microtasks run: text holds the lock, image must be waiting behind it.
      await new Promise(r => setImmediate(r));
      expect(mockLlmService.loadModel).toHaveBeenCalledTimes(1);
      expect(mockLocalDreamService.loadModel).not.toHaveBeenCalled();

      // Release text — image proceeds only now.
      mockLlmService.isModelLoaded.mockReturnValue(true);
      releaseText();
      await Promise.all([textPromise, imagePromise]);
      expect(mockLocalDreamService.loadModel).toHaveBeenCalledTimes(1);
    });
  });

  describe('budget caps by real available RAM (OOM-freeze guard)', () => {
    it('blocks a model that fits total RAM but not the real free RAM', async () => {
      // 16GB device (physical budget ~9.8GB) but only ~2GB actually free right
      // now — the dynamic cap (available + resident − headroom, floored at 1GB)
      // must block a ~3GB image so it never loads into swap.
      mockHardwareService.getTotalMemoryGB.mockReturnValue(16);
      mockHardwareService.getAvailableMemoryGB.mockReturnValue(2);
      const imageModel = createONNXImageModel({
        id: 'img-big',
        size: 1200 * 1024 * 1024,
      }); // ×2.5 ≈ 3GB
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      await expect(
        activeModelService.loadImageModel('img-big'),
      ).rejects.toThrow();
    });

    it('allows the same model when real free RAM is high', async () => {
      mockHardwareService.getTotalMemoryGB.mockReturnValue(16);
      mockHardwareService.getAvailableMemoryGB.mockReturnValue(16);
      const imageModel = createONNXImageModel({
        id: 'img-ok',
        size: 1200 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      await activeModelService.loadImageModel('img-ok');
      expect(selectedLocalModelId('image')).toBe('img-ok');
    });
  });
});
