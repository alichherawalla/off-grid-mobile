import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
  Switch,
  BackHandler,
  Keyboard,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { Card, ModelCard, Button } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { COLORS, RECOMMENDED_MODELS, CREDIBILITY_LABELS, TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore } from '../stores';
import { huggingFaceService, modelManager, hardwareService, onnxImageGeneratorService, backgroundDownloadService, activeModelService } from '../services';
import { fetchAvailableModels, getVariantLabel, guessStyle, HFImageModel } from '../services/huggingFaceModelBrowser';
import { fetchAvailableCoreMLModels, CoreMLImageModel } from '../services/coreMLModelBrowser';
import { resolveCoreMLModelDir, downloadCoreMLTokenizerFiles } from '../utils/coreMLModelUtils';
import { ModelInfo, ModelFile, DownloadedModel, ModelSource, ONNXImageModel } from '../types';
import { RootStackParamList } from '../navigation/types';

type BackendFilter = 'all' | 'mnn' | 'qnn' | 'coreml';

interface ImageModelDescriptor {
  id: string;
  name: string;
  description: string;
  downloadUrl: string;
  size: number;
  style: string;
  backend: 'mnn' | 'qnn' | 'coreml';
  huggingFaceRepo?: string;
  huggingFaceFiles?: { path: string; size: number }[];
  /** Multi-file download manifest (Core ML full-precision models) */
  coremlFiles?: { path: string; relativePath: string; size: number; downloadUrl: string }[];
  /** HuggingFace repo slug (e.g. 'apple/coreml-stable-diffusion-2-1-base-palettized') */
  repo?: string;
}

type CredibilityFilter = 'all' | ModelSource;
type ModelTypeFilter = 'all' | 'text' | 'vision' | 'code' | 'image-gen';

const CREDIBILITY_OPTIONS: { key: CredibilityFilter; label: string; color?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'lmstudio', label: 'LM Studio', color: CREDIBILITY_LABELS.lmstudio.color },
  { key: 'official', label: 'Official', color: CREDIBILITY_LABELS.official.color },
  { key: 'verified-quantizer', label: 'Verified', color: CREDIBILITY_LABELS['verified-quantizer'].color },
  { key: 'community', label: 'Community', color: CREDIBILITY_LABELS.community.color },
];

const MODEL_TYPE_OPTIONS: { key: ModelTypeFilter; label: string }[] = [
  { key: 'all', label: 'All Types' },
  { key: 'text', label: 'Text' },
  { key: 'vision', label: 'Vision' },
  { key: 'code', label: 'Code' },
];

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type ModelTab = 'text' | 'image';

export const ModelsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const [activeTab, setActiveTab] = useState<ModelTab>('text');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchResults, setSearchResults] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [modelFiles, setModelFiles] = useState<ModelFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [credibilityFilter, setCredibilityFilter] = useState<CredibilityFilter>('all');
  const [modelTypeFilter, setModelTypeFilter] = useState<ModelTypeFilter>('all');
  const [showCompatibleOnly, setShowCompatibleOnly] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const {
    downloadedModels,
    setDownloadedModels,
    downloadProgress,
    setDownloadProgress,
    addDownloadedModel,
    downloadedImageModels,
    setDownloadedImageModels,
    addDownloadedImageModel,
    removeDownloadedImageModel,
    activeImageModelId,
    setActiveImageModelId,
    imageModelDownloading,
    addImageModelDownloading,
    removeImageModelDownloading,
    imageModelDownloadIds,
    setImageModelDownloadId,
    setBackgroundDownload,
  } = useAppStore();

  const [imageModelProgress, setImageModelProgress] = useState<Record<string, number>>({});
  const updateModelProgress = (modelId: string, progress: number) =>
    setImageModelProgress(prev => ({ ...prev, [modelId]: progress }));
  const clearModelProgress = (modelId: string) =>
    setImageModelProgress(prev => { const next = { ...prev }; delete next[modelId]; return next; });

  const [availableHFModels, setAvailableHFModels] = useState<HFImageModel[]>([]);
  const [hfModelsLoading, setHfModelsLoading] = useState(false);
  const [hfModelsError, setHfModelsError] = useState<string | null>(null);
  const [backendFilter, setBackendFilter] = useState<BackendFilter>('all');
  const [imageSearchQuery, setImageSearchQuery] = useState('');

  const loadHFModels = useCallback(async (forceRefresh = false) => {
    setHfModelsLoading(true);
    setHfModelsError(null);
    try {
      if (Platform.OS === 'ios') {
        const coremlModels = await fetchAvailableCoreMLModels(forceRefresh);
        // Map CoreMLImageModel to HFImageModel shape for unified rendering
        const mapped: HFImageModel[] = coremlModels.map((m) => ({
          id: m.id,
          name: m.name,
          displayName: m.displayName,
          backend: 'mnn' as const, // placeholder — overridden by badge logic
          fileName: m.fileName,
          downloadUrl: m.downloadUrl,
          size: m.size,
          repo: m.repo,
          _coreml: true, // marker for badge rendering
          _coremlFiles: m.files, // multi-file download manifest (if no zip available)
        }));
        setAvailableHFModels(mapped);
      } else {
        const models = await fetchAvailableModels(forceRefresh);
        setAvailableHFModels(models);
      }
    } catch (error: any) {
      setHfModelsError(error?.message || 'Failed to fetch models');
    } finally {
      setHfModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialModels();
    loadDownloadedModels();
    loadDownloadedImageModels();
    restoreActiveImageDownloads();
  }, []);

  useEffect(() => {
    if (activeTab === 'image' && availableHFModels.length === 0 && !hfModelsLoading) {
      loadHFModels();
    }
  }, [activeTab]);

  // Restore active image model downloads on mount (after app restart)
  const restoreActiveImageDownloads = async () => {
    if (!backgroundDownloadService.isAvailable()) return;

    try {
      const activeDownloads = await modelManager.getActiveBackgroundDownloads();
      const imageDownloads = activeDownloads.filter(d =>
        d.modelId.startsWith('image:') &&
        (d.status === 'running' || d.status === 'pending' || d.status === 'paused')
      );

      // Clean stale downloads: imageModelDownloading has models with no matching native download
      const activeNativeModelIds = new Set(imageDownloads.map(d => d.modelId.replace('image:', '')));
      for (const modelId of imageModelDownloading) {
        if (!activeNativeModelIds.has(modelId)) {
          removeImageModelDownloading(modelId);
        }
      }

      // Restore each active download
      for (const download of imageDownloads) {
        const modelId = download.modelId.replace('image:', '');
        addImageModelDownloading(modelId);
        setImageModelDownloadId(modelId, download.downloadId);
        const progress = download.totalBytes > 0 ? download.bytesDownloaded / download.totalBytes : 0;
        updateModelProgress(modelId, progress);
        console.log('[ModelsScreen] Restored image download state:', modelId, `${Math.round(progress * 100)}%`);
      }
    } catch (error) {
      console.warn('[ModelsScreen] Failed to restore image downloads:', error);
    }
  };

  // Handle system back button when model detail view is shown
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (selectedModel) {
          setSelectedModel(null);
          setModelFiles([]);
          return true; // Prevent default back behavior
        }
        return false; // Let default back behavior happen
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [selectedModel])
  );

  const loadInitialModels = async () => {
    setIsLoading(true);
    try {
      const results = await huggingFaceService.searchModels('', { limit: 30 });
      setSearchResults(results);
    } catch (error) {
      console.error('Error loading models:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDownloadedModels = async () => {
    const models = await modelManager.getDownloadedModels();
    setDownloadedModels(models);
  };

  const loadDownloadedImageModels = async () => {
    const models = await modelManager.getDownloadedImageModels();
    setDownloadedImageModels(models);
  };

  const handleSearch = async () => {
    Keyboard.dismiss();
    if (!searchQuery.trim()) {
      loadInitialModels();
      return;
    }

    setIsLoading(true);
    try {
      const results = await huggingFaceService.searchModels(searchQuery, {
        limit: 30,
      });
      setSearchResults(results);
    } catch (error) {
      setAlertState(showAlert('Search Error', 'Failed to search models. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadInitialModels();
    await loadDownloadedModels();
    await loadDownloadedImageModels();
    if (activeTab === 'image') {
      await loadHFModels(true);
    }
    setIsRefreshing(false);
  }, [activeTab, loadHFModels]);

  // Download from HuggingFace (multi-file download)
  const handleDownloadHuggingFaceModel = async (modelInfo: ImageModelDescriptor) => {
    if (!modelInfo.huggingFaceRepo || !modelInfo.huggingFaceFiles) {
      setAlertState(showAlert('Error', 'Invalid HuggingFace model configuration'));
      return;
    }

    addImageModelDownloading(modelInfo.id);
    updateModelProgress(modelInfo.id, 0);

    try {
      const imageModelsDir = modelManager.getImageModelsDirectory();
      const modelDir = `${imageModelsDir}/${modelInfo.id}`;

      // Create directories if needed
      if (!(await RNFS.exists(imageModelsDir))) {
        await RNFS.mkdir(imageModelsDir);
      }
      if (!(await RNFS.exists(modelDir))) {
        await RNFS.mkdir(modelDir);
      }

      const files = modelInfo.huggingFaceFiles;
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      let downloadedSize = 0;

      // Download each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileUrl = `https://huggingface.co/${modelInfo.huggingFaceRepo}/resolve/main/${file.path}`;
        const filePath = `${modelDir}/${file.path}`;

        // Create subdirectory if needed
        const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
        if (!(await RNFS.exists(fileDir))) {
          await RNFS.mkdir(fileDir);
        }

        console.log(`[HuggingFace] Downloading ${file.path} (${i + 1}/${files.length})`);

        // Download file with progress
        const downloadResult = RNFS.downloadFile({
          fromUrl: fileUrl,
          toFile: filePath,
          background: true,
          discretionary: false,
          progressInterval: 500,
          progress: (res) => {
            const overallProgress = (downloadedSize + res.bytesWritten) / totalSize;
            updateModelProgress(modelInfo.id, overallProgress * 0.95);
          },
        });

        const result = await downloadResult.promise;

        if (result.statusCode !== 200) {
          throw new Error(`Failed to download ${file.path}: HTTP ${result.statusCode}`);
        }

        downloadedSize += file.size;
        updateModelProgress(modelInfo.id, (downloadedSize / totalSize) * 0.95);
      }

      // Register the model
      const imageModel: ONNXImageModel = {
        id: modelInfo.id,
        name: modelInfo.name,
        description: modelInfo.description,
        modelPath: modelDir,
        downloadedAt: new Date().toISOString(),
        size: modelInfo.size,
        style: modelInfo.style,
        backend: modelInfo.backend,
      };

      await modelManager.addDownloadedImageModel(imageModel);
      addDownloadedImageModel(imageModel);

      if (!activeImageModelId) {
        setActiveImageModelId(imageModel.id);
      }

      updateModelProgress(modelInfo.id, 1);
      setAlertState(showAlert('Success', `${modelInfo.name} downloaded successfully!`));
    } catch (error: any) {
      console.error('[HuggingFace] Download error:', error);
      setAlertState(showAlert('Download Failed', error?.message || 'Unknown error'));
      // Clean up partial download
      try {
        const modelDir = `${modelManager.getImageModelsDirectory()}/${modelInfo.id}`;
        if (await RNFS.exists(modelDir)) {
          await RNFS.unlink(modelDir);
        }
      } catch (e) {
        console.warn('[HuggingFace] Failed to clean up:', e);
      }
    } finally {
      removeImageModelDownloading(modelInfo.id);
      clearModelProgress(modelInfo.id);
    }
  };

  // Image model download/management - uses native background download service
  const handleDownloadImageModel = async (modelInfo: ImageModelDescriptor) => {
    // Route to HuggingFace downloader if it's a HuggingFace model
    if (modelInfo.huggingFaceRepo && modelInfo.huggingFaceFiles) {
      await handleDownloadHuggingFaceModel(modelInfo);
      return;
    }

    // Route to multi-file downloader for Core ML models without zip archives
    if (modelInfo.coremlFiles && modelInfo.coremlFiles.length > 0) {
      await handleDownloadCoreMLMultiFile(modelInfo);
      return;
    }

    // Check if background download service is available
    if (!backgroundDownloadService.isAvailable()) {
      // Fall back to RNFS download for iOS or if native module unavailable
      await handleDownloadImageModelFallback(modelInfo);
      return;
    }

    addImageModelDownloading(modelInfo.id);
    updateModelProgress(modelInfo.id, 0);

    try {
      const fileName = `${modelInfo.id}.zip`;

      // Start background download
      const downloadInfo = await backgroundDownloadService.startDownload({
        url: modelInfo.downloadUrl!,
        fileName: fileName,
        modelId: `image:${modelInfo.id}`,
        title: `Downloading ${modelInfo.name}`,
        description: 'Image generation model',
        totalBytes: modelInfo.size,
      });

      setImageModelDownloadId(modelInfo.id, downloadInfo.downloadId);

      // Store metadata so DownloadManagerScreen can find and cancel this download
      setBackgroundDownload(downloadInfo.downloadId, {
        modelId: `image:${modelInfo.id}`,
        fileName: fileName,
        quantization: '',
        author: 'Image Generation',
        totalBytes: modelInfo.size,
      });

      // Subscribe to progress events
      const unsubProgress = backgroundDownloadService.onProgress(downloadInfo.downloadId, (event) => {
        const progress = event.totalBytes > 0
          ? (event.bytesDownloaded / event.totalBytes) * 0.9
          : 0;
        updateModelProgress(modelInfo.id, progress);
      });

      // Subscribe to completion
      const unsubComplete = backgroundDownloadService.onComplete(downloadInfo.downloadId, async (event) => {
        unsubProgress();
        unsubComplete();
        unsubError();

        try {
          updateModelProgress(modelInfo.id, 0.9);

          // Move the downloaded file to the image models directory
          const imageModelsDir = modelManager.getImageModelsDirectory();
          const zipPath = `${imageModelsDir}/${fileName}`;
          const modelDir = `${imageModelsDir}/${modelInfo.id}`;

          // Create directories if needed
          if (!(await RNFS.exists(imageModelsDir))) {
            await RNFS.mkdir(imageModelsDir);
          }

          // Move the completed download
          await backgroundDownloadService.moveCompletedDownload(downloadInfo.downloadId, zipPath);

          updateModelProgress(modelInfo.id, 0.92);

          // Create the model directory
          if (!(await RNFS.exists(modelDir))) {
            await RNFS.mkdir(modelDir);
          }

          // Extract the zip file
          console.log(`[ImageModels] Extracting ${zipPath} to ${modelDir}`);
          await unzip(zipPath, modelDir);

          // Resolve nested directory for Core ML zips
          const resolvedModelDir = modelInfo.backend === 'coreml'
            ? await resolveCoreMLModelDir(modelDir)
            : modelDir;

          updateModelProgress(modelInfo.id, 0.95);

          // Clean up the ZIP file
          try {
            await RNFS.unlink(zipPath);
            console.log(`[ImageModels] Cleaned up ZIP file: ${zipPath}`);
          } catch (e) {
            console.warn(`[ImageModels] Failed to delete ZIP file: ${e}`);
          }

          // Register the model
          const imageModel: ONNXImageModel = {
            id: modelInfo.id,
            name: modelInfo.name,
            description: modelInfo.description,
            modelPath: resolvedModelDir,
            downloadedAt: new Date().toISOString(),
            size: modelInfo.size,
            style: modelInfo.style,
          };

          await modelManager.addDownloadedImageModel(imageModel);
          addDownloadedImageModel(imageModel);

          // Set as active if it's the first image model
          if (!activeImageModelId) {
            setActiveImageModelId(imageModel.id);
          }

          updateModelProgress(modelInfo.id, 1);
          setAlertState(showAlert('Success', `${modelInfo.name} downloaded successfully!`));
        } catch (extractError: any) {
          setAlertState(showAlert('Extraction Failed', extractError?.message || 'Failed to extract model'));
        } finally {
          removeImageModelDownloading(modelInfo.id);
          clearModelProgress(modelInfo.id);
          setBackgroundDownload(downloadInfo.downloadId, null);
        }
      });

      // Subscribe to errors
      const unsubError = backgroundDownloadService.onError(downloadInfo.downloadId, (event) => {
        unsubProgress();
        unsubComplete();
        unsubError();
        setAlertState(showAlert('Download Failed', event.reason || 'Unknown error'));
        removeImageModelDownloading(modelInfo.id);
        clearModelProgress(modelInfo.id);
        setBackgroundDownload(downloadInfo.downloadId, null);
      });

      // Start polling after listeners are attached
      backgroundDownloadService.startProgressPolling();

    } catch (error: any) {
      setAlertState(showAlert('Download Failed', error?.message || 'Unknown error'));
      removeImageModelDownloading(modelInfo.id);
      clearModelProgress(modelInfo.id);
    }
  };

  // Fallback download method using RNFS (for iOS or when native module unavailable)
  const handleDownloadImageModelFallback = async (modelInfo: ImageModelDescriptor) => {
    addImageModelDownloading(modelInfo.id);
    updateModelProgress(modelInfo.id, 0);

    try {
      const imageModelsDir = modelManager.getImageModelsDirectory();
      const modelDir = `${imageModelsDir}/${modelInfo.id}`;
      const zipPath = `${imageModelsDir}/${modelInfo.id}.zip`;

      // Create directory if needed
      if (!(await RNFS.exists(imageModelsDir))) {
        await RNFS.mkdir(imageModelsDir);
      }

      // Download the zip file
      const downloadResult = RNFS.downloadFile({
        fromUrl: modelInfo.downloadUrl,
        toFile: zipPath,
        background: true,
        discretionary: true,
        progressInterval: 500,
        progress: (res) => {
          const progress = res.bytesWritten / res.contentLength;
          updateModelProgress(modelInfo.id, progress * 0.9);
        },
      });

      const result = await downloadResult.promise;

      if (result.statusCode !== 200) {
        throw new Error(`Download failed with status ${result.statusCode}`);
      }

      updateModelProgress(modelInfo.id, 0.9);

      // Create the model directory
      if (!(await RNFS.exists(modelDir))) {
        await RNFS.mkdir(modelDir);
      }

      // Extract the zip file
      await unzip(zipPath, modelDir);

      // Resolve nested directory for Core ML zips
      const resolvedModelDir = modelInfo.backend === 'coreml'
        ? await resolveCoreMLModelDir(modelDir)
        : modelDir;

      updateModelProgress(modelInfo.id, 0.95);

      // Clean up the ZIP file
      await RNFS.unlink(zipPath).catch(() => { });

      // Register the model with resolved path (handles nested zip extraction)
      const imageModel: ONNXImageModel = {
        id: modelInfo.id,
        name: modelInfo.name,
        description: modelInfo.description,
        modelPath: resolvedModelDir,
        downloadedAt: new Date().toISOString(),
        size: modelInfo.size,
        style: modelInfo.style,
        backend: modelInfo.backend,
      };

      await modelManager.addDownloadedImageModel(imageModel);
      addDownloadedImageModel(imageModel);

      if (!activeImageModelId) {
        setActiveImageModelId(imageModel.id);
      }

      updateModelProgress(modelInfo.id, 1);
      setAlertState(showAlert('Success', `${modelInfo.name} downloaded successfully!`));
    } catch (error: any) {
      setAlertState(showAlert('Download Failed', error?.message || 'Unknown error'));
    } finally {
      removeImageModelDownloading(modelInfo.id);
      clearModelProgress(modelInfo.id);
    }
  };

  // Multi-file download handler for Core ML models without zip archives
  const handleDownloadCoreMLMultiFile = async (modelInfo: ImageModelDescriptor) => {
    if (!backgroundDownloadService.isAvailable()) {
      setAlertState(showAlert('Not Available', 'Background downloads not available'));
      return;
    }
    if (!modelInfo.coremlFiles || modelInfo.coremlFiles.length === 0) return;

    addImageModelDownloading(modelInfo.id);
    updateModelProgress(modelInfo.id, 0);

    try {
      const imageModelsDir = modelManager.getImageModelsDirectory();
      const modelDir = `${imageModelsDir}/${modelInfo.id}`;

      // Start multi-file background download
      const downloadInfo = await backgroundDownloadService.startMultiFileDownload({
        files: modelInfo.coremlFiles.map(f => ({
          url: f.downloadUrl,
          relativePath: f.relativePath,
          size: f.size,
        })),
        fileName: modelInfo.id,
        modelId: `image:${modelInfo.id}`,
        destinationDir: modelDir,
        totalBytes: modelInfo.size,
      });

      setImageModelDownloadId(modelInfo.id, downloadInfo.downloadId);

      // Store metadata so DownloadManagerScreen can find and cancel this download
      setBackgroundDownload(downloadInfo.downloadId, {
        modelId: `image:${modelInfo.id}`,
        fileName: modelInfo.id,
        quantization: 'Core ML',
        author: 'Image Generation',
        totalBytes: modelInfo.size,
      });

      const unsubProgress = backgroundDownloadService.onProgress(downloadInfo.downloadId, (event) => {
        const progress = event.totalBytes > 0
          ? (event.bytesDownloaded / event.totalBytes)
          : 0;
        updateModelProgress(modelInfo.id, progress * 0.95);
      });

      const unsubComplete = backgroundDownloadService.onComplete(downloadInfo.downloadId, async () => {
        unsubProgress();
        unsubComplete();
        unsubError();

        try {
          // Download tokenizer files for Core ML models (not included in compiled dir)
          if (modelInfo.backend === 'coreml' && modelInfo.repo) {
            await downloadCoreMLTokenizerFiles(modelDir, modelInfo.repo);
          }

          // Register the model (files are already in modelDir)
          const imageModel: ONNXImageModel = {
            id: modelInfo.id,
            name: modelInfo.name,
            description: modelInfo.description,
            modelPath: modelDir,
            downloadedAt: new Date().toISOString(),
            size: modelInfo.size,
            style: modelInfo.style,
            backend: modelInfo.backend,
          };

          await modelManager.addDownloadedImageModel(imageModel);
          addDownloadedImageModel(imageModel);

          if (!activeImageModelId) {
            setActiveImageModelId(imageModel.id);
          }

          updateModelProgress(modelInfo.id, 1);
          setAlertState(showAlert('Success', `${modelInfo.name} downloaded successfully!`));
        } catch (regError: any) {
          setAlertState(showAlert('Registration Failed', regError?.message || 'Failed to register model'));
        } finally {
          removeImageModelDownloading(modelInfo.id);
          clearModelProgress(modelInfo.id);
          setBackgroundDownload(downloadInfo.downloadId, null);
        }
      });

      const unsubError = backgroundDownloadService.onError(downloadInfo.downloadId, (event) => {
        unsubProgress();
        unsubComplete();
        unsubError();
        setAlertState(showAlert('Download Failed', event.reason || 'Unknown error'));
        removeImageModelDownloading(modelInfo.id);
        clearModelProgress(modelInfo.id);
        setBackgroundDownload(downloadInfo.downloadId, null);
      });

      backgroundDownloadService.startProgressPolling();
    } catch (error: any) {
      setAlertState(showAlert('Download Failed', error?.message || 'Unknown error'));
      removeImageModelDownloading(modelInfo.id);
      clearModelProgress(modelInfo.id);
    }
  };

  const handleDeleteImageModel = (modelId: string) => {
    const model = downloadedImageModels.find(m => m.id === modelId);
    if (!model) return;

    setAlertState(showAlert(
      'Delete Image Model',
      `Are you sure you want to delete ${model.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Unload if this is the active model
              if (activeImageModelId === modelId) {
                await activeModelService.unloadImageModel();
              }
              await modelManager.deleteImageModel(modelId);
              removeDownloadedImageModel(modelId);
            } catch (error: any) {
              setAlertState(showAlert('Error', `Failed to delete: ${error?.message}`));
            }
          },
        },
      ]
    ));
  };

  const handleSetActiveImageModel = async (modelId: string) => {
    setActiveImageModelId(modelId);
  };

  const handleSelectModel = async (model: ModelInfo) => {
    setSelectedModel(model);
    setIsLoadingFiles(true);

    try {
      const files = await huggingFaceService.getModelFiles(model.id);
      setModelFiles(files);
    } catch (error) {
      setAlertState(showAlert('Error', 'Failed to load model files.'));
      setModelFiles([]);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleDownload = async (model: ModelInfo, file: ModelFile) => {
    const downloadKey = `${model.id}/${file.name}`;

    const onProgress = (progress: { progress: number; bytesDownloaded: number; totalBytes: number }) => {
      setDownloadProgress(downloadKey, {
        progress: progress.progress,
        bytesDownloaded: progress.bytesDownloaded,
        totalBytes: progress.totalBytes,
      });
    };
    const onComplete = (downloadedModel: DownloadedModel) => {
      setDownloadProgress(downloadKey, null);
      addDownloadedModel(downloadedModel);
      setAlertState(showAlert('Success', `${model.name} downloaded successfully!`));
    };
    const onError = (error: Error) => {
      setDownloadProgress(downloadKey, null);
      setAlertState(showAlert('Download Failed', error.message));
    };

    try {
      if (modelManager.isBackgroundDownloadSupported()) {
        await modelManager.downloadModelBackground(model.id, file, onProgress, onComplete, onError);
      } else {
        await modelManager.downloadModel(model.id, file, onProgress, onComplete, onError);
      }
    } catch (error) {
      setAlertState(showAlert('Download Failed', (error as Error).message));
    }
  };

  const isModelDownloaded = (modelId: string, fileName: string): boolean => {
    return downloadedModels.some(
      (m) => m.id === `${modelId}/${fileName}`
    );
  };

  const getDownloadedModel = (
    modelId: string,
    fileName: string
  ): DownloadedModel | undefined => {
    return downloadedModels.find(
      (m) => m.id === `${modelId}/${fileName}`
    );
  };

  const ramGB = hardwareService.getTotalMemoryGB();

  // Helper to detect model type from tags
  const getModelType = (model: ModelInfo): ModelTypeFilter => {
    const tags = model.tags.map(t => t.toLowerCase());
    const name = model.name.toLowerCase();
    const id = model.id.toLowerCase();

    // Check for image generation models (Stable Diffusion, etc.)
    if (tags.some(t => t.includes('diffusion') || t.includes('text-to-image') || t.includes('image-generation')) ||
      name.includes('stable-diffusion') || name.includes('sd-') || name.includes('sdxl') ||
      id.includes('stable-diffusion') || id.includes('coreml-stable') ||
      tags.some(t => t.includes('diffusers'))) {
      return 'image-gen';
    }

    // Check for vision/multimodal models
    if (tags.some(t => t.includes('vision') || t.includes('multimodal') || t.includes('image-text')) ||
      name.includes('vision') || name.includes('vlm') || name.includes('llava') ||
      id.includes('vision') || id.includes('vlm') || id.includes('llava')) {
      return 'vision';
    }

    // Check for code models
    if (tags.some(t => t.includes('code')) ||
      name.includes('code') || name.includes('coder') || name.includes('starcoder') ||
      id.includes('code') || id.includes('coder')) {
      return 'code';
    }

    return 'text';
  };

  // Check if model has any compatible files
  const hasCompatibleFiles = (model: ModelInfo): boolean => {
    if (!model.files || model.files.length === 0) return true; // Assume compatible if no file info
    return model.files.some(file => {
      const fileSizeGB = file.size / (1024 * 1024 * 1024);
      return fileSizeGB < ramGB * 0.6;
    });
  };

  // Filter search results by credibility, type, and compatibility
  const filteredResults = useMemo(() => {
    return searchResults.filter((model) => {
      // Credibility filter
      if (credibilityFilter !== 'all' && model.credibility?.source !== credibilityFilter) {
        return false;
      }

      // Model type filter
      if (modelTypeFilter !== 'all' && getModelType(model) !== modelTypeFilter) {
        return false;
      }

      // Compatibility filter
      if (showCompatibleOnly && !hasCompatibleFiles(model)) {
        return false;
      }

      return true;
    });
  }, [searchResults, credibilityFilter, modelTypeFilter, showCompatibleOnly, ramGB]);

  // Filter HuggingFace image models - must be before any conditional returns
  const filteredHFModels = useMemo(() => {
    const query = imageSearchQuery.toLowerCase().trim();
    return availableHFModels.filter((m) => {
      if (backendFilter !== 'all' && m.backend !== backendFilter) return false;
      if (downloadedImageModels.some((d) => d.id === m.id)) return false;
      if (query && !m.displayName.toLowerCase().includes(query) && !m.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [availableHFModels, backendFilter, downloadedImageModels, imageSearchQuery]);

  const renderModelItem = ({ item, index }: { item: ModelInfo; index: number }) => {
    // Check if any file from this model is downloaded
    const isAnyFileDownloaded = downloadedModels.some((m) =>
      m.id.startsWith(item.id)
    );

    return (
      <ModelCard
        model={item}
        isDownloaded={isAnyFileDownloaded}
        onPress={() => handleSelectModel(item)}
        testID={`model-card-${index}`}
      />
    );
  };

  const renderFileItem = ({ item, index }: { item: ModelFile; index: number }) => {
    if (!selectedModel) return null;

    const downloadKey = `${selectedModel.id}/${item.name}`;
    const progress = downloadProgress[downloadKey];
    const isDownloading = !!progress;
    const isDownloaded = isModelDownloaded(selectedModel.id, item.name);
    const downloadedModel = getDownloadedModel(selectedModel.id, item.name);

    // Estimate if file will fit in memory
    const fileSizeGB = item.size / (1024 * 1024 * 1024);
    const isCompatible = fileSizeGB < ramGB * 0.6;

    return (
      <ModelCard
        model={{
          id: selectedModel.id,
          name: item.name.replace('.gguf', ''),
          author: selectedModel.author,
          credibility: selectedModel.credibility,
        }}
        file={item}
        downloadedModel={downloadedModel}
        isDownloaded={isDownloaded}
        isDownloading={isDownloading}
        downloadProgress={progress?.progress}
        isCompatible={isCompatible}
        testID={`file-card-${index}`}
        onDownload={
          !isDownloaded && !isDownloading
            ? () => handleDownload(selectedModel, item)
            : undefined
        }
      />
    );
  };

  if (selectedModel) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View testID="model-detail-screen" style={{ flex: 1 }}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => { setSelectedModel(null); setModelFiles([]); }}
              testID="model-detail-back"
              style={{ padding: 4, marginRight: 8 }}
            >
              <Icon name="arrow-left" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>
              {selectedModel.name}
            </Text>
          </View>

          <Card style={styles.modelInfoCard}>
            <View style={styles.authorRow}>
              <Text style={styles.modelAuthor}>{selectedModel.author}</Text>
              {selectedModel.credibility && (
                <View style={[
                  styles.credibilityBadge,
                  { backgroundColor: CREDIBILITY_LABELS[selectedModel.credibility.source].color + '25' }
                ]}>
                  {selectedModel.credibility.source === 'lmstudio' && (
                    <Text style={[styles.credibilityIcon, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>★</Text>
                  )}
                  {selectedModel.credibility.source === 'official' && (
                    <Text style={[styles.credibilityIcon, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>✓</Text>
                  )}
                  {selectedModel.credibility.source === 'verified-quantizer' && (
                    <Text style={[styles.credibilityIcon, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>◆</Text>
                  )}
                  <Text style={[styles.credibilityText, { color: CREDIBILITY_LABELS[selectedModel.credibility.source].color }]}>
                    {CREDIBILITY_LABELS[selectedModel.credibility.source].label}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.modelDescription}>{selectedModel.description}</Text>
            <View style={styles.modelStats}>
              <Text style={styles.statText}>
                {formatNumber(selectedModel.downloads)} downloads
              </Text>
              <Text style={styles.statText}>
                {formatNumber(selectedModel.likes)} likes
              </Text>
            </View>
          </Card>

          <Text style={styles.sectionTitle}>Available Files</Text>
          <Text style={styles.sectionSubtitle}>
            Choose a quantization level. Q4_K_M is recommended for mobile.
            {modelFiles.some(f => f.mmProjFile) && ' Vision files include mmproj.'}
          </Text>

          {isLoadingFiles ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : (
            <FlatList
              data={modelFiles}
              renderItem={renderFileItem}
              keyExtractor={(item) => item.name}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <Card style={styles.emptyCard}>
                  <Text style={styles.emptyText}>
                    No GGUF files found for this model.
                  </Text>
                </Card>
              }
            />
          )}
        </View>
        <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
      </SafeAreaView>
    );
  }

  // Count of active downloads for badge
  const activeDownloadCount = Object.keys(downloadProgress).length;

  // Total count: downloaded text models + downloaded image models + currently downloading
  const totalModelCount = downloadedModels.length + downloadedImageModels.length + activeDownloadCount;

  const hfModelToDescriptor = (hfModel: HFImageModel & { _coreml?: boolean; _coremlFiles?: any[] }): ImageModelDescriptor => ({
    id: hfModel.id,
    name: hfModel.displayName,
    description: hfModel._coreml
      ? `Core ML model from ${hfModel.repo}`
      : `${hfModel.backend === 'qnn' ? 'NPU' : 'CPU'} model from ${hfModel.repo}`,
    downloadUrl: hfModel.downloadUrl,
    size: hfModel.size,
    style: guessStyle(hfModel.name),
    backend: hfModel._coreml ? 'coreml' : hfModel.backend,
    coremlFiles: hfModel._coremlFiles,
    repo: hfModel.repo,
  });

  // Render image models section
  const renderImageModelsSection = () => (
    <View style={styles.imageModelsSection}>
      <Text style={styles.imageSectionSubtitle}>
        Stable Diffusion models for on-device image generation
      </Text>

      {/* Downloaded image models */}
      {downloadedImageModels.length > 0 && (
        <View style={styles.downloadedImageModels}>
          {downloadedImageModels.map((model) => (
            <Card key={model.id} style={styles.imageModelCard}>
              <View style={styles.imageModelHeader}>
                <View style={styles.imageModelInfo}>
                  <Text style={styles.imageModelName}>{model.name}</Text>
                  <Text style={styles.imageModelDesc}>{model.description}</Text>
                  <Text style={styles.imageModelSize}>
                    {formatBytes(model.size)}
                  </Text>
                </View>
                {activeImageModelId === model.id && (
                  <View style={styles.activeBadge}>
                    <Text style={styles.activeBadgeText}>Active</Text>
                  </View>
                )}
              </View>
              <View style={styles.imageModelActions}>
                {activeImageModelId !== model.id && (
                  <TouchableOpacity
                    style={styles.setActiveButton}
                    onPress={() => handleSetActiveImageModel(model.id)}
                    testID="set-active-image-model"
                  >
                    <Text style={styles.setActiveButtonText}>Set Active</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.deleteImageButton}
                  onPress={() => handleDeleteImageModel(model.id)}
                >
                  <Icon name="trash-2" size={18} color={COLORS.error} />
                </TouchableOpacity>
              </View>
            </Card>
          ))}
        </View>
      )}

      {/* Search and filter */}
      <Text style={styles.availableTitle}>Available for Download</Text>
      <TextInput
        style={styles.imageSearchInput}
        placeholder="Search models..."
        placeholderTextColor={COLORS.textMuted}
        value={imageSearchQuery}
        onChangeText={setImageSearchQuery}
        returnKeyType="search"
      />
      {Platform.OS !== 'ios' && (
        <View style={styles.backendFilterRow}>
          {([
            { key: 'all' as BackendFilter, label: 'All' },
            { key: 'mnn' as BackendFilter, label: 'CPU' },
            { key: 'qnn' as BackendFilter, label: 'NPU' },
          ]).map((option) => (
            <TouchableOpacity
              key={option.key}
              style={[
                styles.filterChip,
                backendFilter === option.key && styles.filterChipActive,
              ]}
              onPress={() => setBackendFilter(option.key)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  backendFilter === option.key && styles.filterChipTextActive,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Loading / Error / List */}
      {hfModelsLoading && (
        <View style={styles.hfLoadingContainer}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading models...</Text>
        </View>
      )}

      {hfModelsError && !hfModelsLoading && (
        <View style={styles.hfErrorContainer}>
          <Text style={styles.hfErrorText}>{hfModelsError}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => loadHFModels(true)}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!hfModelsLoading && !hfModelsError && filteredHFModels.map((model) => (
        <Card key={model.id} style={styles.imageModelCard}>
          <View style={styles.imageModelHeader}>
            <View style={styles.imageModelInfo}>
              <View style={styles.modelNameRow}>
                <Text style={styles.imageModelName}>{model.displayName}</Text>
              </View>
              <View style={styles.badgeRow}>
                <View style={[styles.backendBadge, (model as any)._coreml ? styles.cpuBadge : model.backend === 'qnn' ? styles.npuBadge : styles.cpuBadge]}>
                  <Text style={styles.backendBadgeText}>
                    {(model as any)._coreml ? 'Core ML' : model.backend === 'qnn' ? 'NPU' : 'CPU'}
                  </Text>
                </View>
                {model.variant && (
                  <View style={styles.variantBadge}>
                    <Text style={styles.variantBadgeText}>{model.variant}</Text>
                  </View>
                )}
              </View>
              {model.variant && (
                <Text style={styles.variantHint}>
                  {getVariantLabel(model.variant)}
                </Text>
              )}
              <Text style={styles.imageModelSize}>
                {formatBytes(model.size)}
              </Text>
            </View>
          </View>
          {imageModelDownloading.includes(model.id) ? (
            <View style={styles.imageDownloadProgress}>
              <Text style={styles.imageDownloadText}>
                Downloading... {Math.round((imageModelProgress[model.id] || 0) * 100)}%
              </Text>
              <View style={styles.imageProgressBar}>
                <View
                  style={[
                    styles.imageProgressFill,
                    { width: `${(imageModelProgress[model.id] || 0) * 100}%` },
                  ]}
                />
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.downloadImageButton}
              onPress={() => handleDownloadImageModel(hfModelToDescriptor(model))}
              disabled={imageModelDownloading.includes(model.id)}
            >
              <Icon name="download" size={16} color={COLORS.primary} />
              <Text style={styles.downloadImageButtonText}>Download</Text>
            </TouchableOpacity>
          )}
        </Card>
      ))}

      {!hfModelsLoading && !hfModelsError && filteredHFModels.length === 0 && availableHFModels.length > 0 && (
        <Text style={styles.allDownloadedText}>
          {imageSearchQuery.trim()
            ? 'No models match your search'
            : backendFilter === 'all'
              ? 'All available models are downloaded'
              : `All ${backendFilter === 'mnn' ? 'CPU' : 'NPU'} models are downloaded`}
        </Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View testID="models-screen" style={{ flex: 1 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Models</Text>
          <TouchableOpacity
            style={styles.downloadManagerButton}
            onPress={() => navigation.navigate('DownloadManager')}
            testID="downloads-icon"
          >
            <Icon name="download" size={22} color={COLORS.text} />
            {totalModelCount > 0 && (
              <View style={styles.downloadBadge}>
                <Text style={styles.downloadBadgeText}>
                  {totalModelCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Tab Bar */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'text' && styles.tabActive]}
            onPress={() => setActiveTab('text')}
          >
            <Icon name="message-square" size={18} color={activeTab === 'text' ? COLORS.primary : COLORS.textSecondary} />
            <Text style={[styles.tabText, activeTab === 'text' && styles.tabTextActive]}>Text Models</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'image' && styles.tabActive]}
            onPress={() => setActiveTab('image')}
          >
            <Icon name="image" size={18} color={activeTab === 'image' ? COLORS.primary : COLORS.textSecondary} />
            <Text style={[styles.tabText, activeTab === 'image' && styles.tabTextActive]}>Image Models</Text>
          </TouchableOpacity>
        </View>

        {/* Text Models Tab */}
        {activeTab === 'text' && (
          <>
            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search models..."
                placeholderTextColor={COLORS.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={handleSearch}
                returnKeyType="search"
                testID="search-input"
              />
              <Button title="Search" size="small" onPress={handleSearch} testID="search-button" />
            </View>

            {/* Filters Section */}
            <View style={styles.filtersSection}>
              {/* Compatible Only Toggle */}
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Show compatible only</Text>
                <Switch
                  value={showCompatibleOnly}
                  onValueChange={setShowCompatibleOnly}
                  trackColor={{ false: COLORS.surfaceLight, true: COLORS.primary + '60' }}
                  thumbColor={showCompatibleOnly ? COLORS.primary : COLORS.textMuted}
                />
              </View>

              {/* Model Type Filter */}
              <View style={styles.filterContainer}>
                <Text style={styles.filterSectionLabel}>Type</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterScroll}
                >
                  {MODEL_TYPE_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.key}
                      style={[
                        styles.filterChip,
                        modelTypeFilter === option.key && styles.filterChipActive,
                      ]}
                      onPress={() => setModelTypeFilter(option.key)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          modelTypeFilter === option.key && styles.filterChipTextActive,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Credibility Filter */}
              <View style={styles.filterContainer}>
                <Text style={styles.filterSectionLabel}>Source</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterScroll}
                >
                  {CREDIBILITY_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.key}
                      style={[
                        styles.filterChip,
                        credibilityFilter === option.key && styles.filterChipActive,
                        credibilityFilter === option.key && option.color && {
                          backgroundColor: option.color + '25',
                          borderColor: option.color,
                        },
                      ]}
                      onPress={() => setCredibilityFilter(option.key)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          credibilityFilter === option.key && styles.filterChipTextActive,
                          credibilityFilter === option.key && option.color && {
                            color: option.color,
                          },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>

            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.loadingText}>Loading models...</Text>
              </View>
            ) : (
              <FlatList
                data={filteredResults}
                renderItem={renderModelItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                testID="models-list"
                refreshControl={
                  <RefreshControl
                    refreshing={isRefreshing}
                    onRefresh={handleRefresh}
                    tintColor={COLORS.primary}
                  />
                }
                ListEmptyComponent={
                  <Card style={styles.emptyCard}>
                    <Text style={styles.emptyText}>
                      {credibilityFilter !== 'all'
                        ? `No ${CREDIBILITY_OPTIONS.find((f: { key: CredibilityFilter; label: string }) => f.key === credibilityFilter)?.label} models found. Try a different filter.`
                        : 'No models found. Try a different search term.'}
                    </Text>
                  </Card>
                }
              />
            )}
          </>
        )}

        {/* Image Models Tab */}
        {
          activeTab === 'image' && (
            <ScrollView style={styles.imageTabContent}>
              {renderImageModelsSection()}
            </ScrollView>
          )
        }
      </View>
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </SafeAreaView >
  );
};

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(0) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
    flex: 1,
  },
  downloadManagerButton: {
    padding: 8,
    position: 'relative',
  },
  downloadBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  downloadBadgeText: {
    ...TYPOGRAPHY.label,
    color: COLORS.text,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
  },
  tabActive: {
    backgroundColor: COLORS.primary + '20',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  tabText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  tabTextActive: {
    color: COLORS.primary,
  },
  imageTabContent: {
    flex: 1,
  },
  searchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  searchInput: {
    ...TYPOGRAPHY.body,
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: COLORS.text,
  },
  filtersSection: {
    marginBottom: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
  },
  toggleLabel: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
  },
  filterContainer: {
    marginBottom: 8,
  },
  filterSectionLabel: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  filterScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary + '25',
    borderColor: COLORS.primary,
  },
  filterChipText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
  },
  filterChipTextActive: {
    color: COLORS.primary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  modelInfoCard: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  modelAuthor: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  credibilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  credibilityIcon: {
    ...TYPOGRAPHY.label,
  },
  credibilityText: {
    ...TYPOGRAPHY.meta,
  },
  modelDescription: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
    marginBottom: 12,
  },
  modelStats: {
    flexDirection: 'row',
    gap: 16,
  },
  statText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.text,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  sectionSubtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  emptyCard: {
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  // Image models section styles
  imageModelsSection: {
    marginBottom: 24,
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  imageSectionTitle: {
    ...TYPOGRAPHY.h1,
    color: COLORS.text,
    marginBottom: 4,
  },
  imageSectionSubtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  downloadedImageModels: {
    marginBottom: 16,
  },
  imageModelCard: {
    marginBottom: 12,
  },
  imageModelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  imageModelInfo: {
    flex: 1,
  },
  imageModelName: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
    marginBottom: 4,
  },
  imageModelDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  imageModelSize: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
  },
  activeBadge: {
    backgroundColor: COLORS.info + '25',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  activeBadgeText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.info,
  },
  imageModelActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  setActiveButton: {
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  setActiveButtonText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.primary,
  },
  deleteImageButton: {
    padding: 8,
  },
  availableTitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    marginBottom: 12,
    marginTop: 8,
  },
  downloadImageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
  },
  downloadImageButtonText: {
    ...TYPOGRAPHY.body,
    color: COLORS.primary,
  },
  imageDownloadProgress: {
    alignItems: 'center',
    gap: 8,
  },
  imageDownloadText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
  },
  imageProgressBar: {
    width: '100%',
    height: 6,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 3,
    overflow: 'hidden',
  },
  imageProgressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  allDownloadedText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: 16,
  },
  textModelsSectionTitle: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
    marginBottom: 12,
    marginTop: 8,
  },
  imageSearchInput: {
    ...TYPOGRAPHY.body,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: COLORS.text,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  backendFilterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  modelNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  backendBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  cpuBadge: {
    backgroundColor: COLORS.primary + '25',
  },
  npuBadge: {
    backgroundColor: '#FF990025',
  },
  backendBadgeText: {
    ...TYPOGRAPHY.label,
    color: COLORS.text,
  },
  variantBadge: {
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  variantBadgeText: {
    ...TYPOGRAPHY.label,
    color: COLORS.textSecondary,
  },
  variantHint: {
    ...TYPOGRAPHY.label,
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  hfLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  hfErrorContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 12,
  },
  hfErrorText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.error,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryButtonText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.primary,
  },
});
