/**
 * useTextModels.handlers.test.ts
 *
 * Unit tests for handler functions in useTextModels that are not covered by
 * the trending-selection or ModelsScreen integration tests:
 * - handleCancelDownload
 * - handleDeleteModel presentation intent
 * - runSearch error path
 * - runSearch with code type and no query (CODE_FALLBACK_QUERY)
 */

// ── Navigation ────────────────────────────────────────────────────────
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
  useFocusEffect: jest.fn((cb: () => () => void) => { cb(); }),
}));

// ── Acceleration predicate (deterministic per-id verdict for the resort test) ──
// Keep the real module's other exports; only make modelSupportsNpuGpu controllable
// so we can assert the "float accelerable models to the top" ordering deterministically.
jest.mock('../../../../src/utils/acceleration', () => ({
  ...jest.requireActual('../../../../src/utils/acceleration'),
  modelSupportsNpuGpu: (m: { id?: string }) => ((m?.id?.charCodeAt(0) ?? 1) % 2 === 0),
}));

// ── App store ─────────────────────────────────────────────────────────
const mockAddDownloadedModel = jest.fn();
const mockRemoveDownloadedModel = jest.fn();
const mockSetDownloadedModels = jest.fn();
const mockDownloads: Record<string, any> = {};

const mockStoreState: any = {
  downloadedModels: [],
  setDownloadedModels: mockSetDownloadedModels,
  addDownloadedModel: mockAddDownloadedModel,
  removeDownloadedModel: mockRemoveDownloadedModel,
  activeModelId: null,
};

jest.mock('../../../../src/stores', () => ({
  useAppStore: jest.fn((selector?: (state: typeof mockStoreState) => unknown) =>
    selector ? selector(mockStoreState) : mockStoreState),
}));

jest.mock('../../../../src/stores/downloadStore', () => ({
  useDownloadStore: Object.assign(
    jest.fn((selector?: any) => selector ? selector({ downloads: mockDownloads }) : { downloads: mockDownloads }),
    {
      getState: () => ({
        downloads: mockDownloads,
        add: (entry: any) => { if (!mockDownloads[entry.modelKey]) mockDownloads[entry.modelKey] = entry; },
        remove: (modelKey: string) => { delete mockDownloads[modelKey]; },
        setStatus: jest.fn(),
      }),
    },
  ),
  modelDownloadProjection: {
    admit: (entry: any) => {
      if (!mockDownloads[entry.modelKey]) mockDownloads[entry.modelKey] = entry;
    },
    remove: (modelKey: string) => { delete mockDownloads[modelKey]; },
    reportStatus: jest.fn(),
  },
  isActiveStatus: (status: string) => ['pending', 'running', 'retrying', 'waiting_for_network', 'processing'].includes(status),
}));

// ── Services ──────────────────────────────────────────────────────────
const mockSearchModels = jest.fn((_query: string, _opts?: any) => Promise.resolve([]));
const mockDeleteModel = jest.fn((_id: string) => Promise.resolve());
const mockUnloadTextModel = jest.fn(() => Promise.resolve());
const mockGetDownloadedModels = jest.fn(() => Promise.resolve([]));
jest.mock('../../../../src/services/modelServices/residencyIntents', () => ({
  mobileResidencyIntents: {
    unloadText: () => mockUnloadTextModel(),
  },
}));

jest.mock('../../../../src/services', () => ({
  huggingFaceService: {
    searchModels: (query: string, opts?: any) => mockSearchModels(query, opts),
    getModelDetails: jest.fn(() => Promise.reject(new Error('not found'))),
    getModelFiles: jest.fn(() => Promise.resolve([])),
  },
  modelLibrary: {
    getDownloadedModels: () => mockGetDownloadedModels(),
    downloadModelBackground: jest.fn(),
    watchDownload: jest.fn(),
    repairMmProj: jest.fn(),
    deleteModel: (id: string) => mockDeleteModel(id),
  },
  hardwareService: {
    getTotalMemoryGB: jest.fn(() => 8),
    getModelRecommendation: jest.fn(() => ({ maxParameters: 8 })),
  },
  activeModelService: {
    // The model-selection seam, from the one place it is defined.
    ...require('../../../utils/activeModelServiceStub').activeModelSelectionStub(),
  },
  unloadTextModel: () => mockUnloadTextModel(),
}));

// ── Alert ─────────────────────────────────────────────────────────────
const mockShowAlert = jest.fn((title: string, message: string) => ({ title, message, visible: true }));
jest.mock('../../../../src/components/CustomAlert', () => ({
  showAlert: (title: string, message: string) => mockShowAlert(title, message),
  initialAlertState: { title: '', message: '', visible: false },
}));

const { installNativeBoundary, requireRTL } =
  require('../../../harness/nativeBoundary') as typeof import('../../../harness/nativeBoundary');
installNativeBoundary({ download: true, fs: true, llama: true });
const { renderHook, act } = requireRTL();
const { useTextModels } =
  require('../../../../src/screens/ModelsScreen/useTextModels') as typeof import('../../../../src/screens/ModelsScreen/useTextModels');

// ─────────────────────────────────────────────────────────────────────

const setAlertState = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockStoreState.downloadedModels = [];
  mockStoreState.activeModelId = null;
  Object.keys(mockDownloads).forEach(k => delete mockDownloads[k]);
  const { useAppStore } = jest.requireMock('../../../../src/stores') as any;
  useAppStore.getState = () => mockStoreState;
});

// ── handleDeleteModel ─────────────────────────────────────────────────

describe('handleDeleteModel', () => {
  it('does nothing when model is not in downloadedModels', async () => {
    mockStoreState.downloadedModels = [];

    const { result } = renderHook(() => useTextModels(setAlertState));

    await act(async () => {
      await result.current.handleDeleteModel('org/missing-model');
    });

    expect(mockDeleteModel).not.toHaveBeenCalled();
  });

});

// ── runSearch error path ──────────────────────────────────────────────

describe('runSearch', () => {
  it('shows a Search Error alert when searchModels rejects', async () => {
    mockSearchModels.mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() => useTextModels(setAlertState));

    await act(async () => {
      await result.current.handleSearch();
      // handleSearch calls runSearch directly — but needs a non-empty query
      // Set query first so runSearch doesn't short-circuit
    });

    // handleSearch with empty query returns early — trigger search via handleSelectModel-like path
    // Instead, call handleSearch after setting query
    await act(async () => {
      result.current.setSearchQuery('llama');
    });

    // Wait for debounce (500ms) + async resolve
    await act(async () => {
      await new Promise(r => setTimeout(r, 600));
    });

    expect(setAlertState).toHaveBeenCalled();
    expect(mockShowAlert).toHaveBeenCalledWith('Search Error', expect.stringContaining('Failed to search'));
  });

  it('uses CODE_FALLBACK_QUERY when type=code and query is empty', async () => {
    mockSearchModels.mockResolvedValue([]);

    const { result } = renderHook(() => useTextModels(setAlertState));

    await act(async () => {
      result.current.setTypeFilter('code');
      await new Promise(r => setTimeout(r, 100));
    });

    expect(mockSearchModels).toHaveBeenCalledWith(
      'coder',
      expect.objectContaining({}),
    );
  });
});

// ── handleSelectModel ────────────────────────────────────────────────

describe('handleSelectModel', () => {
  it('uses the Shared Gemma artifacts when network file discovery fails', async () => {
    const { huggingFaceService } = jest.requireMock('../../../../src/services');
    huggingFaceService.getModelFiles.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useTextModels(setAlertState));
    const gemma: any = {
      id: 'unsloth/gemma-4-E2B-it-GGUF',
      name: 'Gemma 4 E2B',
      author: 'google',
      description: '',
      downloads: 0,
      likes: 0,
      tags: ['vision'],
      lastModified: '',
      files: [],
    };

    await act(async () => {
      await result.current.handleSelectModel(gemma);
    });

    expect(result.current.modelFiles).toEqual([
      expect.objectContaining({
        name: 'gemma-4-E2B-it-Q4_K_M.gguf',
        quantization: 'Q4_K_M',
        mmProjFile: expect.objectContaining({
          name: 'mmproj-gemma-4-E2B-it-F16.gguf',
        }),
      }),
    ]);
    expect(huggingFaceService.getModelFiles).not.toHaveBeenCalled();
    expect(setAlertState).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to load model files.' }),
    );
  });

  it('short-circuits HF fetch when model id is in the offgrid/ namespace and ships files', async () => {
    const { huggingFaceService } = jest.requireMock('../../../../src/services');
    const getModelFilesSpy = jest.spyOn(huggingFaceService, 'getModelFiles');
    const { result } = renderHook(() => useTextModels(setAlertState));

    const curatedFile = { name: 'gemma-4-E2B-it.litertlm', size: 1000, quantization: 'mixed', downloadUrl: 'https://hf/x' };
    const curatedModel: any = {
      id: 'offgrid/litert-recommended',
      name: 'Gemma 4 LiteRT',
      author: 'google',
      description: '',
      downloads: 0, likes: 0, tags: ['litert'], lastModified: '',
      files: [curatedFile],
    };

    await act(async () => {
      await result.current.handleSelectModel(curatedModel);
    });

    expect(getModelFilesSpy).not.toHaveBeenCalled();
    expect(result.current.modelFiles).toEqual([curatedFile]);
    expect(result.current.selectedModel).toBe(curatedModel);
  });

  it('uses pre-populated catalog files for any projected model without a second fetch', async () => {
    const { huggingFaceService } = jest.requireMock('../../../../src/services');
    const fetched = [{ name: 'q4.gguf', size: 2000, quantization: 'Q4_K_M', downloadUrl: 'https://hf/q4' }];
    huggingFaceService.getModelFiles.mockResolvedValueOnce(fetched);

    const { result } = renderHook(() => useTextModels(setAlertState));

    // A projected model already carries the authoritative artifact list.
    const hfModel: any = {
      id: 'test-org/test-model',
      name: 'Test Model',
      author: 'test-org',
      description: '',
      downloads: 1000, likes: 100, tags: [], lastModified: '',
      files: [{ name: 'model-q4_k_m.gguf', size: 100, quantization: 'Q4_K_M', downloadUrl: '' }],
    };

    await act(async () => {
      await result.current.handleSelectModel(hfModel);
    });

    expect(huggingFaceService.getModelFiles).not.toHaveBeenCalled();
    expect(result.current.modelFiles).toEqual(hfModel.files);
  });
});

// ── downloaded-file resolution (recovered / catch-up id schemes) ──────────
describe('isModelDownloaded / getDownloadedModel resolve by file, not composite id', () => {
  const REPO = 'unsloth/gemma-4-E2B-it-GGUF';

  it('resolves a quant registered under the composite download id', () => {
    mockStoreState.downloadedModels = [
      { id: `${REPO}/gemma-4-E2B-it-Q4_K_M.gguf`, fileName: 'gemma-4-E2B-it-Q4_K_M.gguf', quantization: 'Q4_K_M', engine: 'llama' },
    ];
    const { result } = renderHook(() => useTextModels(setAlertState));
    expect(result.current.isModelDownloaded(REPO, 'gemma-4-E2B-it-Q4_K_M.gguf')).toBe(true);
    expect(result.current.getDownloadedModel(REPO, 'gemma-4-E2B-it-Q4_K_M.gguf')?.quantization).toBe('Q4_K_M');
  });

  it('resolves a quant recovered under a DIFFERENT id (catch-up/recovery) by its fileName', () => {
    // The Q4_0 finished after an app kill and was re-registered by the recovery scan
    // under a `recovered_…` id — the composite-id lookup would miss it and fall back to
    // the sibling Q4_K_M. Matching by fileName finds the real Q4_0 entry.
    mockStoreState.downloadedModels = [
      { id: `${REPO}/gemma-4-E2B-it-Q4_K_M.gguf`, fileName: 'gemma-4-E2B-it-Q4_K_M.gguf', quantization: 'Q4_K_M', engine: 'llama' },
      { id: 'recovered_gemma-4-E2B-it-Q4_0.gguf_1783000000000', fileName: 'gemma-4-E2B-it-Q4_0.gguf', quantization: 'Q4_0', engine: 'llama' },
    ];
    const { result } = renderHook(() => useTextModels(setAlertState));
    expect(result.current.isModelDownloaded(REPO, 'gemma-4-E2B-it-Q4_0.gguf')).toBe(true);
    const resolved = result.current.getDownloadedModel(REPO, 'gemma-4-E2B-it-Q4_0.gguf');
    expect(resolved?.quantization).toBe('Q4_0');
    expect(resolved?.id).toBe('recovered_gemma-4-E2B-it-Q4_0.gguf_1783000000000');
  });
});

// ── Recommended-list NPU/GPU prioritization (the resort at useTextModels.ts:329) ──
// Guards the user-visible behavior CodeRabbit flagged: on the 'recommended' sort,
// NPU/GPU-accelerable models float to the top; explicit sorts are honored (no resort).
describe('recommendedAsModelInfo — NPU/GPU prioritization', () => {
  const accel = (m: { id?: string }) => ((m?.id?.charCodeAt(0) ?? 1) % 2 === 0); // matches the mock

  it("floats accelerable models ahead of non-accelerable ones on the 'recommended' sort", () => {
    const { result } = renderHook(() => useTextModels(setAlertState));
    const list = result.current.recommendedAsModelInfo;
    expect(list.length).toBeGreaterThan(0);

    // Partition invariant: once a non-accelerable model appears, no accelerable model
    // may appear after it. Deleting the resort line lets a non-accelerable precede an
    // accelerable one → this fails.
    let sawNonAccel = false;
    for (const m of list) {
      if (!accel(m)) sawNonAccel = true;
      else if (sawNonAccel) throw new Error(`accelerable model ${m.id} appears after a non-accelerable one`);
    }
    // And the resort must be meaningful for this dataset (both groups present),
    // otherwise the invariant is vacuous.
    expect(list.some(accel)).toBe(true);
    expect(list.some(m => !accel(m))).toBe(true);
  });

  it("honors an explicit sort (size) — does NOT reprioritize by accelerability", () => {
    const { result } = renderHook(() => useTextModels(setAlertState));
    act(() => result.current.setSortOption('size'));

    const list = result.current.recommendedAsModelInfo;
    // 'size' sorts by paramCount ascending (applySort). The accel resort is skipped,
    // so the list stays param-ordered rather than accelerable-first.
    const params = list.map(m => m.paramCount ?? 0);
    for (let i = 1; i < params.length; i++) {
      expect(params[i]).toBeGreaterThanOrEqual(params[i - 1]);
    }
  });
});
