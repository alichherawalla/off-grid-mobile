import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { AlertState } from '../../components/CustomAlert';
import { useAppStore } from '../../stores';
import { modelDownloadProjection, useDownloadStore } from '../../stores/downloadStore';
import {
  modelLibrary,
  hardwareService,
  selectMobileModel,
} from '../../services';
import { fetchAvailableModels, HFImageModel } from '../../services/huggingFaceModelBrowser';
import { fetchAvailableCoreMLModels } from '../../services/coreMLModelBrowser';
import { ImageModelRecommendation } from '../../types';
import { BackendFilter, ImageFilterDimension, ImageModelDescriptor } from './types';
import { startImageModelDownload as downloadImageModel, type ImageDownloadDeps } from '../../services/imageModelDownloadOwner';
import { resumeImageDownload } from '../../services/imageDownloadResume';
import { modelDownloadRegistry } from '../../services/modelServices/downloadRegistryBootstrap';
import {
  filterImageCatalog,
  isRecommendedImageCatalogModel,
  recommendedImageBackendFilter,
  uniformDownloadId,
} from '@offgrid/models';

export function useImageModels(setAlertState: (s: AlertState) => void) {
  const [availableHFModels, setAvailableHFModels] = useState<HFImageModel[]>([]);
  const [hfModelsLoading, setHfModelsLoading] = useState(false);
  const [hfModelsError, setHfModelsError] = useState<string | null>(null);
  const [backendFilter, setBackendFilter] = useState<BackendFilter>('all');
  const [styleFilter, setStyleFilter] = useState<string>('all');
  const [sdVersionFilter, setSdVersionFilter] = useState<string>('all');
  const [imageFilterExpanded, setImageFilterExpanded] = useState<ImageFilterDimension>(null);
  const [imageSearchQuery, setImageSearchQuery] = useState('');
  const [imageFiltersVisible, setImageFiltersVisible] = useState(false);
  const [imageRec, setImageRec] = useState<ImageModelRecommendation | null>(null);
  const [userChangedBackendFilter, setUserChangedBackendFilter] = useState(false);
  const [showRecommendedOnly, setShowRecommendedOnly] = useState(true);
  const [showRecHint, setShowRecHint] = useState(true);

  const {
    downloadedImageModels, setDownloadedImageModels, addDownloadedImageModel,
    activeImageModelId,
    onboardingChecklist,
  } = useAppStore();
  const downloads = useDownloadStore((s) => s.downloads);
  const resumingDownloadKeysRef = useRef<Set<string>>(new Set());

  const makeDeps = (): ImageDownloadDeps => ({
    addDownloadedImageModel,
    activeImageModelId,
    selectActiveImageModel: model => selectMobileModel({
      source: 'local',
      hostId: model.backend ?? 'image-runtime',
      modality: 'image',
      modelId: model.id,
    }),
    setAlertState,
    triedImageGen: onboardingChecklist.triedImageGen,
  });

  const loadDownloadedImageModels = useCallback(async () => {
    const models = await modelLibrary.getDownloadedImageModels();
    setDownloadedImageModels(models);
  }, [setDownloadedImageModels]);

  const loadHFModels = useCallback(async (forceRefresh = false) => {
    setHfModelsLoading(true); setHfModelsError(null);
    try {
      if (Platform.OS === 'ios') {
        const coremlModels = await fetchAvailableCoreMLModels(forceRefresh);
        setAvailableHFModels(coremlModels.map(m => ({
          id: m.id, name: m.name, displayName: m.displayName, backend: 'coreml' as any,
          fileName: m.fileName, downloadUrl: m.downloadUrl, size: m.size, repo: m.repo,
          _coreml: true, _coremlFiles: m.files,
          _coremlAttentionVariant: m.attentionVariant,
        })));
      } else {
        const socInfo = await hardwareService.getSoCInfo();
        setAvailableHFModels(await fetchAvailableModels(forceRefresh, { skipQnn: !socInfo.hasNPU }));
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
    const processingEntries = Object.values(downloads).filter(
      entry => entry.modelType === 'image' && entry.status === 'processing',
    );
    if (processingEntries.length === 0) return;

    let cancelled = false;
    const resumeProcessingDownloads = async () => {
      const latestDownloaded = await modelLibrary.getDownloadedImageModels();
      if (cancelled) return;
      const downloadedIds = new Set(latestDownloaded.map(m => m.id));
      const deps = makeDeps();

      for (const entry of processingEntries) {
        if (cancelled) return;
        if (resumingDownloadKeysRef.current.has(entry.modelKey)) continue;

        const modelId = entry.modelId.replace('image:', '');
        if (downloadedIds.has(modelId)) {
          modelDownloadProjection.remove(entry.modelKey);
          continue;
        }

        // Restored image downloads can finish after mount and transition
        // running -> processing via the global download hook. Re-run the same
        // finalize path here so unzip/register isn't missed after relaunch.
        resumingDownloadKeysRef.current.add(entry.modelKey);
        resumeImageDownload(entry, deps)
          .catch(() => {})
          .finally(() => {
            resumingDownloadKeysRef.current.delete(entry.modelKey);
          });
      }
    };

    resumeProcessingDownloads();
    return () => { cancelled = true; };
    // makeDeps intentionally omitted: it is recreated each render and current store
    // values are read when resumeProcessingDownloads runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloads]);

  useEffect(() => {
    let cancelled = false;
    hardwareService.getImageModelRecommendation().then(rec => {
      if (cancelled) return;
      setImageRec(rec);
      if (!userChangedBackendFilter && Platform.OS !== 'ios') {
        setBackendFilter(recommendedImageBackendFilter(rec));
      }
    });
    return () => { cancelled = true; };

    // Intentionally mount-only: fetches hardware recommendation once.
    // userChangedBackendFilter is read inside but should not re-trigger this fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearImageFilters = useCallback(() => {
    setBackendFilter('all'); setUserChangedBackendFilter(true);
    setStyleFilter('all'); setSdVersionFilter('all'); setImageFilterExpanded(null);
  }, []);

  const isRecommendedModel = useCallback((model: HFImageModel): boolean => {
    return isRecommendedImageCatalogModel(model, imageRec);
  }, [imageRec]);

  const filteredHFModels = useMemo(() => {
    return filterImageCatalog({
      models: availableHFModels,
      backend: backendFilter,
      style: styleFilter,
      version: sdVersionFilter,
      query: imageSearchQuery,
      recommendedOnly: showRecommendedOnly,
      recommendation: imageRec,
      downloadedIds: new Set(downloadedImageModels.map(model => model.id)),
    });
  }, [availableHFModels, backendFilter, styleFilter, sdVersionFilter, downloadedImageModels, imageSearchQuery, imageRec, showRecommendedOnly]);

  const hasActiveImageFilters = backendFilter !== 'all' || styleFilter !== 'all' || sdVersionFilter !== 'all';
  const imageRecommendation = imageRec?.bannerText ?? 'Loading recommendation...';

  const handleDownloadImageModel = (modelInfo: ImageModelDescriptor) =>
    downloadImageModel(modelInfo, makeDeps());

  const handleCancelImageDownload = (modelId: string) =>
    modelDownloadRegistry.cancel(uniformDownloadId('image', modelId));

  return {
    availableHFModels, hfModelsLoading, hfModelsError,
    backendFilter, setBackendFilter,
    styleFilter, setStyleFilter,
    sdVersionFilter, setSdVersionFilter,
    imageFilterExpanded, setImageFilterExpanded,
    imageSearchQuery, setImageSearchQuery,
    imageFiltersVisible, setImageFiltersVisible,
    imageRec, showRecommendedOnly, setShowRecommendedOnly,
    showRecHint, setShowRecHint,
    downloadedImageModels,
    hasActiveImageFilters, filteredHFModels, imageRecommendation,
    loadHFModels, loadDownloadedImageModels,
    clearImageFilters, isRecommendedModel, handleDownloadImageModel,
    handleCancelImageDownload,
    setUserChangedBackendFilter,
  };
}
