import {
  useState,
  useCallback,
  useDeferredValue,
  useMemo,
  useEffect,
} from 'react';
import { Platform } from 'react-native';
import { AlertState } from '../../components/CustomAlert';
import { useActiveLocalModelId } from '../../hooks/useActiveMobileModel';
import { useAppStore } from '../../stores';
import {
  modelLibrary,
  hardwareService,
  selectMobileModel,
} from '../../services';
import {
  fetchAvailableModels,
  HFImageModel,
} from '../../services/huggingFaceModelBrowser';
import { fetchAvailableCoreMLModels } from '../../services/coreMLModelBrowser';
import { ImageModelRecommendation } from '../../types';
import {
  BackendFilter,
  ImageFilterDimension,
  ImageModelDescriptor,
} from './types';
import {
  startImageModelDownload as downloadImageModel,
  type ImageDownloadDeps,
} from '../../services/imageModelDownloadOwner';
import { modelDownloadRegistry } from '../../services/modelServices/downloadRegistryBootstrap';
import {
  filterImageCatalog,
  isRecommendedImageCatalogModel,
  recommendedImageBackendFilter,
  uniformDownloadId,
} from '@offgrid/application';

export function useImageModels(setAlertState: (s: AlertState) => void) {
  const [availableHFModels, setAvailableHFModels] = useState<HFImageModel[]>(
    [],
  );
  const [hfModelsLoading, setHfModelsLoading] = useState(false);
  const [hfModelsError, setHfModelsError] = useState<string | null>(null);
  const [backendFilter, setBackendFilter] = useState<BackendFilter>('all');
  const [styleFilter, setStyleFilter] = useState<string>('all');
  const [sdVersionFilter, setSdVersionFilter] = useState<string>('all');
  const [imageFilterExpanded, setImageFilterExpanded] =
    useState<ImageFilterDimension>(null);
  const [imageSearchQuery, setImageSearchQuery] = useState('');
  const [imageFiltersVisible, setImageFiltersVisible] = useState(false);
  const [imageRec, setImageRec] = useState<ImageModelRecommendation | null>(
    null,
  );
  const [userChangedBackendFilter, setUserChangedBackendFilter] =
    useState(false);
  const [showRecommendedOnly, setShowRecommendedOnly] = useState(true);
  const [showRecHint, setShowRecHint] = useState(true);

  // Narrow selectors: this screen must not re-render for an unrelated app-store field
  // (settings, generated images, download counters) while the catalogue is on screen.
  const downloadedImageModels = useAppStore(state => state.downloadedImageModels);
  const setDownloadedImageModels = useAppStore(
    state => state.setDownloadedImageModels,
  );
  const addDownloadedImageModel = useAppStore(
    state => state.addDownloadedImageModel,
  );
  const triedImageGen = useAppStore(
    state => state.onboardingChecklist.triedImageGen,
  );
  const activeImageModelId = useActiveLocalModelId('image');

  const makeDeps = useCallback(
    (): ImageDownloadDeps => ({
      addDownloadedImageModel,
      activeImageModelId,
      selectActiveImageModel: model =>
        selectMobileModel({
          source: 'local',
          hostId: model.backend ?? 'image-runtime',
          modality: 'image',
          modelId: model.id,
        }),
      setAlertState,
      triedImageGen,
    }),
    [addDownloadedImageModel, activeImageModelId, setAlertState, triedImageGen],
  );

  const loadDownloadedImageModels = useCallback(async () => {
    const models = await modelLibrary.getDownloadedImageModels();
    setDownloadedImageModels(models);
  }, [setDownloadedImageModels]);

  const loadHFModels = useCallback(async (forceRefresh = false) => {
    setHfModelsLoading(true);
    setHfModelsError(null);
    try {
      if (Platform.OS === 'ios') {
        const coremlModels = await fetchAvailableCoreMLModels(forceRefresh);
        setAvailableHFModels(
          coremlModels.map(m => ({
            id: m.id,
            name: m.name,
            displayName: m.displayName,
            backend: 'coreml' as any,
            fileName: m.fileName,
            downloadUrl: m.downloadUrl,
            size: m.size,
            repo: m.repo,
            _coreml: true,
            _coremlFiles: m.files,
            _coremlAttentionVariant: m.attentionVariant,
          })),
        );
      } else {
        const socInfo = await hardwareService.getSoCInfo();
        setAvailableHFModels(
          await fetchAvailableModels(forceRefresh, {
            skipQnn: !socInfo.hasNPU,
          }),
        );
      }
    } catch (error: any) {
      setHfModelsError(error?.message || 'Failed to fetch models');
    } finally {
      setHfModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const downloaded = await modelLibrary.getDownloadedImageModels();
      setDownloadedImageModels(downloaded);
    };
    init();
  }, [setDownloadedImageModels]);

  useEffect(() => {
    let cancelled = false;
    hardwareService.getImageModelRecommendation().then(rec => {
      if (cancelled) return;
      setImageRec(rec);
      if (!userChangedBackendFilter && Platform.OS !== 'ios') {
        setBackendFilter(recommendedImageBackendFilter(rec));
      }
    });
    return () => {
      cancelled = true;
    };

    // Intentionally mount-only: fetches hardware recommendation once.
    // userChangedBackendFilter is read inside but should not re-trigger this fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearImageFilters = useCallback(() => {
    setBackendFilter('all');
    setUserChangedBackendFilter(true);
    setStyleFilter('all');
    setSdVersionFilter('all');
    setImageFilterExpanded(null);
  }, []);

  const isRecommendedModel = useCallback(
    (model: HFImageModel): boolean => {
      return isRecommendedImageCatalogModel(model, imageRec);
    },
    [imageRec],
  );

  // The field stays immediate; the catalogue scan runs against the deferred query, so a
  // keystroke paints before the whole catalogue is re-filtered and re-rendered.
  const deferredImageSearchQuery = useDeferredValue(imageSearchQuery);

  const downloadedImageModelIds = useMemo(
    () => new Set(downloadedImageModels.map(model => model.id)),
    [downloadedImageModels],
  );

  const filteredHFModels = useMemo(() => {
    return filterImageCatalog({
      models: availableHFModels,
      backend: backendFilter,
      style: styleFilter,
      version: sdVersionFilter,
      query: deferredImageSearchQuery,
      recommendedOnly: showRecommendedOnly,
      recommendation: imageRec,
      downloadedIds: downloadedImageModelIds,
    });
  }, [
    availableHFModels,
    backendFilter,
    styleFilter,
    sdVersionFilter,
    downloadedImageModelIds,
    deferredImageSearchQuery,
    imageRec,
    showRecommendedOnly,
  ]);

  const hasActiveImageFilters =
    backendFilter !== 'all' ||
    styleFilter !== 'all' ||
    sdVersionFilter !== 'all';
  const imageRecommendation =
    imageRec?.bannerText ?? 'Loading recommendation...';

  // Stable identities so a memoized card is not invalidated by every parent render.
  const handleDownloadImageModel = useCallback(
    (modelInfo: ImageModelDescriptor) =>
      downloadImageModel(modelInfo, makeDeps()),
    [makeDeps],
  );

  const handleCancelImageDownload = useCallback(
    (modelId: string) =>
      modelDownloadRegistry.cancel(uniformDownloadId('image', modelId)),
    [],
  );

  return {
    availableHFModels,
    hfModelsLoading,
    hfModelsError,
    backendFilter,
    setBackendFilter,
    styleFilter,
    setStyleFilter,
    sdVersionFilter,
    setSdVersionFilter,
    imageFilterExpanded,
    setImageFilterExpanded,
    imageSearchQuery,
    setImageSearchQuery,
    imageFiltersVisible,
    setImageFiltersVisible,
    imageRec,
    showRecommendedOnly,
    setShowRecommendedOnly,
    showRecHint,
    setShowRecHint,
    downloadedImageModels,
    hasActiveImageFilters,
    filteredHFModels,
    imageRecommendation,
    loadHFModels,
    loadDownloadedImageModels,
    clearImageFilters,
    isRecommendedModel,
    handleDownloadImageModel,
    handleCancelImageDownload,
    setUserChangedBackendFilter,
  };
}
