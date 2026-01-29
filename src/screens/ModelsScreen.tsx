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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, ModelCard, Button } from '../components';
import { COLORS, RECOMMENDED_MODELS, CREDIBILITY_LABELS } from '../constants';
import { useAppStore } from '../stores';
import { huggingFaceService, modelManager, hardwareService } from '../services';
import { ModelInfo, ModelFile, DownloadedModel, ModelSource } from '../types';

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

export const ModelsScreen: React.FC = () => {
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
  } = useAppStore();

  useEffect(() => {
    loadInitialModels();
    loadDownloadedModels();
  }, []);

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
    setIsRefreshing(false);
  }, []);

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
          <Button
            title="Back"
            variant="ghost"
            size="small"
            onPress={() => {
              setSelectedModel(null);
              setModelFiles([]);
            }}
          />
          <Text style={styles.title} numberOfLines={1}>
            {selectedModel.name}
          </Text>
          <View style={{ width: 60 }} />
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Browse Models</Text>
      </View>

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
    </SafeAreaView>
  );
};

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
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
    textAlign: 'center',
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
});
