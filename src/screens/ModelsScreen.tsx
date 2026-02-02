import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
  Switch,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { Card, ModelCard, Button } from '../components';
import { COLORS, RECOMMENDED_MODELS, CREDIBILITY_LABELS } from '../constants';
import { useAppStore } from '../stores';
import { huggingFaceService, modelManager, hardwareService, onnxImageGeneratorService, backgroundDownloadService } from '../services';
import { ModelInfo, ModelFile, DownloadedModel, ModelSource, ONNXImageModel } from '../types';
import { RootStackParamList } from '../navigation/types';

// HuggingFace file structure for LCM model
const LCM_HUGGINGFACE_FILES = [
  { path: 'text_encoder/model.onnx', size: 247 * 1024 * 1024 },
  { path: 'unet/model.onnx', size: 93.7 * 1024 * 1024 },
  { path: 'unet/model.onnx_data', size: 1.64 * 1024 * 1024 * 1024 },
  { path: 'unet/config.json', size: 2 * 1024 },
  { path: 'vae_decoder/model.onnx', size: 2.11 * 1024 * 1024 },
  { path: 'vae_decoder/model.onnx_data', size: 97.4 * 1024 * 1024 },
  { path: 'vae_decoder/config.json', size: 1 * 1024 },
  { path: 'tokenizer/vocab.json', size: 1.06 * 1024 * 1024 },
  { path: 'tokenizer/merges.txt', size: 525 * 1024 },
  { path: 'tokenizer/tokenizer_config.json', size: 2 * 1024 },
  { path: 'tokenizer/special_tokens_map.json', size: 1 * 1024 },
];

// Predefined ONNX image models available for download
// Note: Only 1GB+ models from patch-14022024 work reliably. The 600MB models from patch-25022024 have compatibility issues.
const AVAILABLE_IMAGE_MODELS: Array<{
  id: string;
  name: string;
  description: string;
  downloadUrl?: string;
  huggingFaceRepo?: string;
  huggingFaceFiles?: Array<{ path: string; size: number }>;
  size: number;
  style: string;
}> = [
  {
    id: 'absolute_reality',
    name: 'Absolute Reality',
    description: 'Best photorealistic model - high fidelity portraits and scenes',
    downloadUrl: 'https://github.com/ShiftHackZ/Local-Diffusion-Models-SDAI-ONXX/releases/download/patch-14022024/majicmix.zip',
    size: 1034 * 1024 * 1024, // ~1GB
    style: 'photorealistic',
  },
  {
    id: 'lcm_dreamshaper_v7',
    name: 'LCM DreamShaper v7',
    description: 'Fast generation (4-8 steps) - experimental LCM model',
    huggingFaceRepo: 'aislamov/lcm-dreamshaper-v7-onnx',
    huggingFaceFiles: LCM_HUGGINGFACE_FILES,
    size: 2.22 * 1024 * 1024 * 1024, // ~2.22GB
    style: 'creative',
  },
];

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
  { key: 'image-gen', label: 'Image Gen' },
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
  } = useAppStore();

  const [imageModelDownloading, setImageModelDownloading] = useState<string | null>(null);
  const [imageModelProgress, setImageModelProgress] = useState<number>(0);
  const [imageModelDownloadId, setImageModelDownloadId] = useState<number | null>(null);

  useEffect(() => {
    loadInitialModels();
    loadDownloadedModels();
    loadDownloadedImageModels();
  }, []);

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
      Alert.alert('Search Error', 'Failed to search models. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadInitialModels();
    await loadDownloadedModels();
    await loadDownloadedImageModels();
    setIsRefreshing(false);
  }, []);

  // Download from HuggingFace (multi-file download)
  const handleDownloadHuggingFaceModel = async (modelInfo: typeof AVAILABLE_IMAGE_MODELS[0]) => {
    if (!modelInfo.huggingFaceRepo || !modelInfo.huggingFaceFiles) {
      Alert.alert('Error', 'Invalid HuggingFace model configuration');
      return;
    }

    setImageModelDownloading(modelInfo.id);
    setImageModelProgress(0);

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
            const fileProgress = res.bytesWritten / res.contentLength;
            const overallProgress = (downloadedSize + res.bytesWritten) / totalSize;
            setImageModelProgress(overallProgress * 0.95);
          },
        });

        const result = await downloadResult.promise;

        if (result.statusCode !== 200) {
          throw new Error(`Failed to download ${file.path}: HTTP ${result.statusCode}`);
        }

        downloadedSize += file.size;
        setImageModelProgress((downloadedSize / totalSize) * 0.95);
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
      };

      await modelManager.addDownloadedImageModel(imageModel);
      addDownloadedImageModel(imageModel);

      if (!activeImageModelId) {
        setActiveImageModelId(imageModel.id);
      }

      setImageModelProgress(1);
      Alert.alert('Success', `${modelInfo.name} downloaded successfully!`);
    } catch (error: any) {
      console.error('[HuggingFace] Download error:', error);
      Alert.alert('Download Failed', error?.message || 'Unknown error');
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
      setImageModelDownloading(null);
      setImageModelProgress(0);
    }
  };

  // Image model download/management - uses native background download service
  const handleDownloadImageModel = async (modelInfo: typeof AVAILABLE_IMAGE_MODELS[0]) => {
    if (imageModelDownloading) {
      Alert.alert('Download in Progress', 'Please wait for the current download to complete.');
      return;
    }

    // Route to HuggingFace downloader if it's a HuggingFace model
    if (modelInfo.huggingFaceRepo && modelInfo.huggingFaceFiles) {
      await handleDownloadHuggingFaceModel(modelInfo);
      return;
    }

    // Check if background download service is available
    if (!backgroundDownloadService.isAvailable()) {
      // Fall back to RNFS download for iOS or if native module unavailable
      await handleDownloadImageModelFallback(modelInfo);
      return;
    }

    setImageModelDownloading(modelInfo.id);
    setImageModelProgress(0);

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

      setImageModelDownloadId(downloadInfo.downloadId);

      // Subscribe to progress events
      const unsubProgress = backgroundDownloadService.onProgress(downloadInfo.downloadId, (event) => {
        const progress = event.totalBytes > 0
          ? (event.bytesDownloaded / event.totalBytes) * 0.9
          : 0;
        setImageModelProgress(progress);
      });

      // Subscribe to completion
      const unsubComplete = backgroundDownloadService.onComplete(downloadInfo.downloadId, async (event) => {
        unsubProgress();
        unsubComplete();
        unsubError();

        try {
          setImageModelProgress(0.9);

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

          setImageModelProgress(0.92);

          // Create the model directory
          if (!(await RNFS.exists(modelDir))) {
            await RNFS.mkdir(modelDir);
          }

          // Extract the zip file
          console.log(`[ImageModels] Extracting ${zipPath} to ${modelDir}`);
          await unzip(zipPath, modelDir);

          setImageModelProgress(0.95);

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
            modelPath: modelDir,
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

          setImageModelProgress(1);
          Alert.alert('Success', `${modelInfo.name} downloaded successfully!`);
        } catch (extractError: any) {
          Alert.alert('Extraction Failed', extractError?.message || 'Failed to extract model');
        } finally {
          setImageModelDownloading(null);
          setImageModelProgress(0);
          setImageModelDownloadId(null);
        }
      });

      // Subscribe to errors
      const unsubError = backgroundDownloadService.onError(downloadInfo.downloadId, (event) => {
        unsubProgress();
        unsubComplete();
        unsubError();
        Alert.alert('Download Failed', event.reason || 'Unknown error');
        setImageModelDownloading(null);
        setImageModelProgress(0);
        setImageModelDownloadId(null);
      });

    } catch (error: any) {
      Alert.alert('Download Failed', error?.message || 'Unknown error');
      setImageModelDownloading(null);
      setImageModelProgress(0);
      setImageModelDownloadId(null);
    }
  };

  // Fallback download method using RNFS (for iOS or when native module unavailable)
  const handleDownloadImageModelFallback = async (modelInfo: typeof AVAILABLE_IMAGE_MODELS[0]) => {
    setImageModelDownloading(modelInfo.id);
    setImageModelProgress(0);

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
          setImageModelProgress(progress * 0.9);
        },
      });

      const result = await downloadResult.promise;

      if (result.statusCode !== 200) {
        throw new Error(`Download failed with status ${result.statusCode}`);
      }

      setImageModelProgress(0.9);

      // Create the model directory
      if (!(await RNFS.exists(modelDir))) {
        await RNFS.mkdir(modelDir);
      }

      // Extract the zip file
      await unzip(zipPath, modelDir);

      setImageModelProgress(0.95);

      // Clean up the ZIP file
      await RNFS.unlink(zipPath).catch(() => {});

      // Register the model
      const imageModel: ONNXImageModel = {
        id: modelInfo.id,
        name: modelInfo.name,
        description: modelInfo.description,
        modelPath: modelDir,
        downloadedAt: new Date().toISOString(),
        size: modelInfo.size,
        style: modelInfo.style,
      };

      await modelManager.addDownloadedImageModel(imageModel);
      addDownloadedImageModel(imageModel);

      if (!activeImageModelId) {
        setActiveImageModelId(imageModel.id);
      }

      setImageModelProgress(1);
      Alert.alert('Success', `${modelInfo.name} downloaded successfully!`);
    } catch (error: any) {
      Alert.alert('Download Failed', error?.message || 'Unknown error');
    } finally {
      setImageModelDownloading(null);
      setImageModelProgress(0);
    }
  };

  const handleDeleteImageModel = (modelId: string) => {
    const model = downloadedImageModels.find(m => m.id === modelId);
    if (!model) return;

    Alert.alert(
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
                await onnxImageGeneratorService.unloadModel();
                setActiveImageModelId(null);
              }
              await modelManager.deleteImageModel(modelId);
              removeDownloadedImageModel(modelId);
            } catch (error: any) {
              Alert.alert('Error', `Failed to delete: ${error?.message}`);
            }
          },
        },
      ]
    );
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
      Alert.alert('Error', 'Failed to load model files.');
      setModelFiles([]);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleDownload = async (model: ModelInfo, file: ModelFile) => {
    const downloadKey = `${model.id}/${file.name}`;

    try {
      await modelManager.downloadModel(
        model.id,
        file,
        (progress) => {
          setDownloadProgress(downloadKey, {
            progress: progress.progress,
            bytesDownloaded: progress.bytesDownloaded,
            totalBytes: progress.totalBytes,
          });
        },
        (downloadedModel) => {
          setDownloadProgress(downloadKey, null);
          addDownloadedModel(downloadedModel);
          Alert.alert('Success', `${model.name} downloaded successfully!`);
        },
        (error) => {
          setDownloadProgress(downloadKey, null);
          Alert.alert('Download Failed', error.message);
        }
      );
    } catch (error) {
      Alert.alert('Download Failed', (error as Error).message);
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

  const renderModelItem = ({ item }: { item: ModelInfo }) => {
    // Check if any file from this model is downloaded
    const isAnyFileDownloaded = downloadedModels.some((m) =>
      m.id.startsWith(item.id)
    );

    return (
      <ModelCard
        model={item}
        isDownloaded={isAnyFileDownloaded}
        onPress={() => handleSelectModel(item)}
      />
    );
  };

  const renderFileItem = ({ item }: { item: ModelFile }) => {
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
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
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
      </SafeAreaView>
    );
  }

  // Count of active downloads for badge
  const activeDownloadCount = Object.keys(downloadProgress).length;

  // Render image models section
  const renderImageModelsSection = () => (
    <View style={styles.imageModelsSection}>
      <Text style={styles.imageSectionSubtitle}>
        ONNX-based Stable Diffusion models for on-device image generation
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

      {/* Available image models to download */}
      <Text style={styles.availableTitle}>Available for Download</Text>
      {AVAILABLE_IMAGE_MODELS.filter(
        (m) => !downloadedImageModels.some((d) => d.id === m.id)
      ).map((model) => (
        <Card key={model.id} style={styles.imageModelCard}>
          <View style={styles.imageModelHeader}>
            <View style={styles.imageModelInfo}>
              <Text style={styles.imageModelName}>{model.name}</Text>
              <Text style={styles.imageModelDesc}>{model.description}</Text>
              <Text style={styles.imageModelSize}>
                {formatBytes(model.size)}
              </Text>
            </View>
          </View>
          {imageModelDownloading === model.id ? (
            <View style={styles.imageDownloadProgress}>
              <Text style={styles.imageDownloadText}>
                Downloading... {Math.round(imageModelProgress * 100)}%
              </Text>
              <View style={styles.imageProgressBar}>
                <View
                  style={[
                    styles.imageProgressFill,
                    { width: `${imageModelProgress * 100}%` },
                  ]}
                />
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.downloadImageButton}
              onPress={() => handleDownloadImageModel(model)}
              disabled={!!imageModelDownloading}
            >
              <Icon name="download" size={16} color={COLORS.text} />
              <Text style={styles.downloadImageButtonText}>Download</Text>
            </TouchableOpacity>
          )}
        </Card>
      ))}

      {AVAILABLE_IMAGE_MODELS.every((m) =>
        downloadedImageModels.some((d) => d.id === m.id)
      ) && (
        <Text style={styles.allDownloadedText}>
          All available image models are downloaded
        </Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Models</Text>
        <TouchableOpacity
          style={styles.downloadManagerButton}
          onPress={() => navigation.navigate('DownloadManager')}
        >
          <Icon name="download" size={22} color={COLORS.text} />
          {(activeDownloadCount > 0 || downloadedModels.length > 0) && (
            <View style={styles.downloadBadge}>
              <Text style={styles.downloadBadgeText}>
                {activeDownloadCount > 0 ? activeDownloadCount : downloadedModels.length}
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
        />
        <Button title="Search" size="small" onPress={handleSearch} />
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
      {activeTab === 'image' && (
        <ScrollView style={styles.imageTabContent}>
          {renderImageModelsSection()}
        </ScrollView>
      )}
    </SafeAreaView>
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
    fontSize: 24,
    fontWeight: 'bold',
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
    fontSize: 11,
    fontWeight: 'bold',
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
    fontSize: 14,
    fontWeight: '600',
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
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 16,
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
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  filterContainer: {
    marginBottom: 8,
  },
  filterSectionLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  filterScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary + '25',
    borderColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
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
    color: COLORS.textSecondary,
    fontSize: 16,
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
    fontSize: 14,
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
    fontSize: 11,
    fontWeight: '700',
  },
  credibilityText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modelDescription: {
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 12,
  },
  modelStats: {
    flexDirection: 'row',
    gap: 16,
  },
  statText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
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
  },
  imageSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  imageSectionSubtitle: {
    fontSize: 13,
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
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  imageModelDesc: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  imageModelSize: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  activeBadge: {
    backgroundColor: COLORS.secondary + '25',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  activeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.secondary,
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
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  deleteImageButton: {
    padding: 8,
  },
  availableTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 12,
    marginTop: 8,
  },
  downloadImageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
  },
  downloadImageButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  imageDownloadProgress: {
    alignItems: 'center',
    gap: 8,
  },
  imageDownloadText: {
    fontSize: 13,
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
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: 16,
  },
  textModelsSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
    marginTop: 8,
  },
});
