import { useState, useCallback, useMemo, useEffect } from 'react';
import { Keyboard, BackHandler } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { showAlert, AlertState } from '../../components/CustomAlert';
import { useAppStore } from '../../stores';
import { useDownloadStore } from '../../stores/downloadStore';
import {
  hardwareService,
  huggingFaceService,
  modelLibrary,
} from '../../services';
import { startModelDownload } from '../../services/startModelDownload';
import { modelDownloadRegistry } from '../../services/modelServices/downloadRegistryBootstrap';
import { modelSupportsNpuGpu } from '../../utils/acceleration';
import { ModelInfo, ModelFile, DownloadedModel } from '../../types';
import {
  FilterDimension,
  FilterState,
  ModelTypeFilter,
  CredibilityFilter,
  SizeFilter,
  SortOption,
} from './types';
import {
  initialFilterState,
  SIZE_OPTIONS,
  VISION_PIPELINE_TAG,
  CODE_FALLBACK_QUERY,
} from './constants';
import logger from '../../utils/logger';
import { getUserFacingDownloadMessage } from '../../utils/downloadErrors';
import {
  catalogModelFiles,
  resolveModelFiles,
} from '../../services/modelCatalogFiles';
import {
  MODEL_ORGS,
  RECOMMENDED_MODELS,
  prioritizeAccelerated,
  queryCatalogModels,
  recommendedCatalogModels,
  trendingCatalogModels,
  uniformDownloadId,
} from '@offgrid/models';

function mapCuratedModel(
  m: (typeof RECOMMENDED_MODELS)[number],
  details: Record<string, ModelInfo>,
): ModelInfo {
  const fetched = details[m.id];
  const catalogFiles = catalogModelFiles(m.id) ?? [];
  const curatedFields = {
    modelType: m.type,
    paramCount: m.params,
    minRamGB: m.minRam,
    files: catalogFiles,
  };
  if (fetched)
    return {
      ...fetched,
      name: m.name,
      description: m.description,
      ...curatedFields,
    };
  return {
    id: m.id,
    name: m.name,
    author: m.id.split('/')[0],
    description: m.description,
    downloads: -1,
    likes: 0,
    tags: [],
    lastModified: '',
    ...curatedFields,
  };
}

async function fetchRecommendedModelDetails(): Promise<
  Record<string, ModelInfo>
> {
  const details: Record<string, ModelInfo> = {};
  await Promise.allSettled(
    RECOMMENDED_MODELS.map(async m => {
      try {
        details[m.id] = await huggingFaceService.getModelDetails(m.id);
      } catch (e) {
        logger.warn(`[ModelsScreen] Failed to fetch details for ${m.id}:`, e);
      }
    }),
  );
  return details;
}

function useCatalogCollections(input: {
  filterState: FilterState;
  searchResults: ModelInfo[];
  recommendedModelDetails: Record<string, ModelInfo>;
}) {
  const { filterState, searchResults, recommendedModelDetails } = input;
  const ramGB = hardwareService.getTotalMemoryGB();
  const deviceRecommendation = useMemo(
    () => hardwareService.getModelRecommendation(),
    [],
  );
  const hasActiveFilters =
    filterState.orgs.length > 0 ||
    filterState.type !== 'all' ||
    filterState.source !== 'all' ||
    filterState.size !== 'all' ||
    filterState.quant !== 'all' ||
    filterState.sort !== 'recommended';
  const filteredResults = useMemo(
    () =>
      queryCatalogModels({
        models: searchResults,
        state: filterState,
        ramGb: ramGB,
        organizations: MODEL_ORGS,
      }),
    [searchResults, filterState, ramGB],
  );
  const recommendedAsModelInfo = useMemo((): ModelInfo[] => {
    const size =
      filterState.size === 'all'
        ? null
        : SIZE_OPTIONS.find(option => option.key === filterState.size) ?? null;
    const models = recommendedCatalogModels({
      maxParams: deviceRecommendation.maxParameters,
      ramGb: ramGB,
      type: filterState.type,
      orgs: filterState.orgs,
      size,
    }).map(model => mapCuratedModel(model, recommendedModelDetails));
    const sorted = queryCatalogModels({
      models,
      state: {
        ...filterState,
        orgs: [],
        type: 'all',
        source: 'all',
        size: 'all',
        quant: 'all',
      },
      ramGb: ramGB,
    });
    return filterState.sort === 'recommended'
      ? prioritizeAccelerated(sorted, modelSupportsNpuGpu)
      : sorted;
  }, [
    deviceRecommendation.maxParameters,
    filterState,
    recommendedModelDetails,
    ramGB,
  ]);
  const trendingAsModelInfo = useMemo(
    () =>
      trendingCatalogModels({
        maxParams: deviceRecommendation.maxParameters,
        ramGb: ramGB,
      }).map(model => mapCuratedModel(model, recommendedModelDetails)),
    [deviceRecommendation.maxParameters, recommendedModelDetails, ramGB],
  );
  return {
    ramGB,
    deviceRecommendation,
    hasActiveFilters,
    filteredResults,
    recommendedAsModelInfo,
    trendingAsModelInfo,
  };
}

export function useTextModels(setAlertState: (s: AlertState) => void) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchResults, setSearchResults] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [modelFiles, setModelFiles] = useState<ModelFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [filterState, setFilterState] =
    useState<FilterState>(initialFilterState);
  const [textFiltersVisible, setTextFiltersVisible] = useState(false);
  const [recommendedModelDetails, setRecommendedModelDetails] = useState<
    Record<string, ModelInfo>
  >({});
  const repairingVisionIds = useDownloadStore(s => s.repairingVisionIds);
  const setRepairingVision = useDownloadStore(s => s.setRepairingVision);

  const { downloadedModels, setDownloadedModels } = useAppStore();

  const loadDownloadedModels = async () => {
    const models = await modelLibrary.getDownloadedModels();
    setDownloadedModels(models);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadDownloadedModels();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchRecommendedModelDetails().then(d => {
      if (!cancelled) setRecommendedModelDetails(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (selectedModel) {
          setSelectedModel(null);
          setModelFiles([]);
          return true;
        }
        return false;
      };
      const sub = BackHandler.addEventListener(
        'hardwareBackPress',
        onBackPress,
      );
      return () => sub.remove();
    }, [selectedModel]),
  );

  const runSearch = async () => {
    const hasQuery = searchQuery.trim().length > 0;
    const hasTypeFilter = filterState.type !== 'all';
    const hasOrgFilter = filterState.orgs.length > 0;
    const hasSizeFilter = filterState.size !== 'all';
    if (!hasQuery && !hasTypeFilter && !hasOrgFilter && !hasSizeFilter) {
      setHasSearched(false);
      setSearchResults([]);
      return;
    }
    let pipelineTag: string | undefined;
    let effectiveQuery = searchQuery.trim();
    if (filterState.type === 'vision') pipelineTag = VISION_PIPELINE_TAG;
    else if (filterState.type === 'code' && !effectiveQuery)
      effectiveQuery = CODE_FALLBACK_QUERY;
    setIsLoading(true);
    setHasSearched(true);
    try {
      const results = await huggingFaceService.searchModels(effectiveQuery, {
        limit: 30,
        pipelineTag,
      });
      setSearchResults(results);
    } catch {
      setAlertState(
        showAlert('Search Error', 'Failed to search models. Please try again.'),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async () => {
    Keyboard.dismiss();
    setFilterState(prev => ({ ...prev, expandedDimension: null }));
    await runSearch();
  };

  useEffect(() => {
    if (!searchQuery.trim()) {
      setHasSearched(false);
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      runSearch();
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Auto-search when searchable filters change (type/size/org) even with empty query
  // Uses runSearch directly to avoid collapsing the expanded filter dimension
  useEffect(() => {
    if (
      filterState.type === 'all' &&
      filterState.size === 'all' &&
      filterState.orgs.length === 0
    )
      return;
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterState.type, filterState.size, filterState.orgs.length]);

  const handleSelectModel = async (model: ModelInfo) => {
    setSelectedModel(model);
    setIsLoadingFiles(true);
    try {
      // Synthetic and catalog-projected parents already carry their canonical
      // artifacts. Do not discard them and query a non-repository parent ID.
      const files = model.files?.length
        ? model.files
        : await resolveModelFiles(model.id, huggingFaceService);
      setModelFiles(files);
    } catch {
      setAlertState(showAlert('Error', 'Failed to load model files.'));
      setModelFiles([]);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleRepairMmProj = async (model: ModelInfo, file: ModelFile) => {
    const modelDownloadId = `${model.id}/${file.name}`;
    setRepairingVision(modelDownloadId, true);
    try {
      const result = await modelLibrary.executeVisionRepair({
        type: 'repair-projector',
        modelId: model.id,
        file,
      });
      if (result.status === 'failed') throw new Error(result.error);
      setAlertState(
        showAlert(
          'Vision Repaired',
          `Vision file restored for ${model.name}. Reload the model to enable vision.`,
        ),
      );
    } catch (e) {
      setAlertState(showAlert('Repair Failed', (e as Error).message));
    } finally {
      setRepairingVision(modelDownloadId, false);
    }
  };

  const isRepairingVisionModel = (modelDownloadId: string) =>
    !!repairingVisionIds[modelDownloadId];

  const handleDownload = async (model: ModelInfo, file: ModelFile) => {
    // Shared with the onboarding ModelDownloadScreen via startModelDownload — one
    // mechanism + one duplicate guard. This screen owns only its completion/error UI.
    await startModelDownload(model.id, file, {
      onRegistered: dm => {
        if (file.mmProjFile && !(dm.engine === 'llama' && dm.isVisionModel)) {
          setAlertState(
            showAlert(
              'Model Downloaded',
              `${model.name} downloaded but the vision projection file could not be saved. Go to Download Manager and use "Repair Vision" to fix it.`,
            ),
          );
        } else {
          setAlertState(
            showAlert('Success', `${model.name} downloaded successfully!`),
          );
        }
      },
      onError: err =>
        setAlertState(
          showAlert(
            'Download Failed',
            getUserFacingDownloadMessage(err.message),
          ),
        ),
    });
  };

  const handleCancelDownload = async (modelKey: string) => {
    await modelDownloadRegistry.cancel(uniformDownloadId('text', modelKey));
  };

  const handleDeleteModel = async (modelId: string) => {
    if (!downloadedModels.some(model => model.id === modelId)) return;
    await modelDownloadRegistry.remove(uniformDownloadId('text', modelId));
  };
  // Resolve a catalog file to its on-disk model by the FILE, not the composite id.
  // The download path registers `${modelId}/${fileName}`, but the restart catch-up /
  // recovery scans register the SAME file under a different id (`recovered_…` or a bare
  // name). Matching only the composite id made a recovered quant (e.g. a Q4_0 finalized
  // after an app kill) look "not downloaded", so its file row fell through to whichever
  // sibling quant WAS registered under the expected id (the Q4_K_M) — loading the wrong
  // quant. A file name is unique within the models dir, so it's the stable key.
  const matchesFile = (m: DownloadedModel, modelId: string, fileName: string) =>
    m.fileName === fileName || m.id === `${modelId}/${fileName}`;

  const isModelDownloaded = (modelId: string, fileName: string) =>
    downloadedModels.some(m => matchesFile(m, modelId, fileName));

  const getDownloadedModel = (
    modelId: string,
    fileName: string,
  ): DownloadedModel | undefined =>
    downloadedModels.find(m => matchesFile(m, modelId, fileName));

  // Filter actions
  const clearFilters = useCallback(
    () => setFilterState(initialFilterState),
    [],
  );
  const toggleFilterDimension = useCallback((dim: FilterDimension) => {
    setFilterState(prev => ({
      ...prev,
      expandedDimension: prev.expandedDimension === dim ? null : dim,
    }));
  }, []);
  const toggleOrg = useCallback((orgKey: string) => {
    setFilterState(prev => ({
      ...prev,
      orgs: prev.orgs.includes(orgKey)
        ? prev.orgs.filter(o => o !== orgKey)
        : [...prev.orgs, orgKey],
    }));
  }, []);
  const setTypeFilter = useCallback(
    (type: ModelTypeFilter) =>
      setFilterState(prev => ({ ...prev, type, expandedDimension: null })),
    [],
  );
  const setSourceFilter = useCallback(
    (source: CredibilityFilter) =>
      setFilterState(prev => ({ ...prev, source, expandedDimension: null })),
    [],
  );
  const setSizeFilter = useCallback(
    (size: SizeFilter) =>
      setFilterState(prev => ({ ...prev, size, expandedDimension: null })),
    [],
  );
  const setQuantFilter = useCallback(
    (quant: string) =>
      setFilterState(prev => ({ ...prev, quant, expandedDimension: null })),
    [],
  );
  const setSortOption = useCallback(
    (sort: SortOption) =>
      setFilterState(prev => ({ ...prev, sort, expandedDimension: null })),
    [],
  );

  const {
    ramGB,
    deviceRecommendation,
    hasActiveFilters,
    filteredResults,
    recommendedAsModelInfo,
    trendingAsModelInfo,
  } = useCatalogCollections({
    filterState,
    searchResults,
    recommendedModelDetails,
  });

  return {
    searchQuery,
    setSearchQuery,
    isLoading,
    isRefreshing,
    setIsRefreshing,
    hasSearched,
    selectedModel,
    setSelectedModel,
    modelFiles,
    setModelFiles,
    isLoadingFiles,
    filterState,
    setFilterState,
    textFiltersVisible,
    setTextFiltersVisible,
    downloadedModels,
    hasActiveFilters,
    ramGB,
    deviceRecommendation,
    filteredResults,
    recommendedAsModelInfo,
    trendingAsModelInfo,
    handleSearch,
    handleSelectModel,
    handleDownload,
    handleRepairMmProj,
    handleCancelDownload,
    handleDeleteModel,
    loadDownloadedModels,
    clearFilters,
    toggleFilterDimension,
    toggleOrg,
    setTypeFilter,
    setSourceFilter,
    setSizeFilter,
    setQuantFilter,
    setSortOption,
    isModelDownloaded,
    getDownloadedModel,
    isRepairingVisionModel,
  };
}
