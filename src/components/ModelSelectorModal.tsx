import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from './AppSheet';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY } from '../constants';
import { useAppStore } from '../stores';
import { DownloadedModel, ONNXImageModel } from '../types';
import { activeModelService, hardwareService } from '../services';

type TabType = 'text' | 'image';

interface ModelSelectorModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectModel: (model: DownloadedModel) => void;
  onSelectImageModel?: (model: ONNXImageModel) => void;
  onUnloadModel: () => void;
  onUnloadImageModel?: () => void;
  isLoading: boolean;
  currentModelPath: string | null;
  initialTab?: TabType;
}

export const ModelSelectorModal: React.FC<ModelSelectorModalProps> = ({
  visible,
  onClose,
  onSelectModel,
  onSelectImageModel,
  onUnloadModel,
  onUnloadImageModel,
  isLoading,
  currentModelPath,
  initialTab = 'text',
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const {
    downloadedModels,
    downloadedImageModels,
    activeImageModelId,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [isLoadingImage, setIsLoadingImage] = useState(false);

  // Reset tab when modal opens
  useEffect(() => {
    if (visible) {
      setActiveTab(initialTab);
    }
  }, [visible, initialTab]);

  const hasLoadedTextModel = currentModelPath !== null;
  const hasLoadedImageModel = !!activeImageModelId;

  const activeImageModel = downloadedImageModels.find(m => m.id === activeImageModelId);
  const activeTextModel = downloadedModels.find(m => m.filePath === currentModelPath);

  const handleSelectImageModel = async (model: ONNXImageModel) => {
    if (activeImageModelId === model.id) return;

    setIsLoadingImage(true);
    try {
      await activeModelService.loadImageModel(model.id);
      onSelectImageModel?.(model);
    } catch (error) {
      console.error('Failed to load image model:', error);
    } finally {
      setIsLoadingImage(false);
    }
  };

  const handleUnloadImageModel = async () => {
    setIsLoadingImage(true);
    try {
      await activeModelService.unloadImageModel();
      onUnloadImageModel?.();
    } catch (error) {
      console.error('Failed to unload image model:', error);
    } finally {
      setIsLoadingImage(false);
    }
  };

  const formatSize = (bytes: number): string => {
    return hardwareService.formatBytes(bytes);
  };

  const isCurrentTextModel = (model: DownloadedModel): boolean => {
    return currentModelPath === model.filePath;
  };

  const isCurrentImageModel = (model: ONNXImageModel): boolean => {
    return activeImageModelId === model.id;
  };

  const isAnyLoading = isLoading || isLoadingImage;

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['40%', '75%']}
      title="Select Model"
    >
      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'text' && styles.tabActive]}
          onPress={() => setActiveTab('text')}
          disabled={isAnyLoading}
        >
          <Icon
            name="message-square"
            size={16}
            color={activeTab === 'text' ? colors.primary : colors.textMuted}
          />
          <Text style={[styles.tabText, activeTab === 'text' && styles.tabTextActive]}>
            Text
          </Text>
          {hasLoadedTextModel && (
            <View style={styles.tabBadge}>
              <View style={styles.tabBadgeDot} />
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'image' && styles.tabActive]}
          onPress={() => setActiveTab('image')}
          disabled={isAnyLoading}
        >
          <Icon
            name="image"
            size={16}
            color={activeTab === 'image' ? colors.info : colors.textMuted}
          />
          <Text style={[
            styles.tabText,
            activeTab === 'image' && styles.tabTextActive,
            activeTab === 'image' && { color: colors.info }
          ]}>
            Image
          </Text>
          {hasLoadedImageModel && (
            <View style={[styles.tabBadge, { backgroundColor: colors.info + '30' }]}>
              <View style={[styles.tabBadgeDot, { backgroundColor: colors.info }]} />
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Loading Banner */}
      {isAnyLoading && (
        <View style={styles.loadingBanner}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Loading model...</Text>
        </View>
      )}

      {/* Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        {activeTab === 'text' ? (
          // Text Models Tab
          <>
            {/* Currently Loaded Text Model */}
            {hasLoadedTextModel && (
              <View style={styles.loadedSection}>
                <View style={styles.loadedHeader}>
                  <Icon name="check-circle" size={14} color={colors.success} />
                  <Text style={styles.loadedLabel}>Currently Loaded</Text>
                </View>
                <View style={styles.loadedModelItem}>
                  <View style={styles.loadedModelInfo}>
                    <Text style={styles.loadedModelName} numberOfLines={1}>
                      {activeTextModel?.name || 'Unknown'}
                    </Text>
                    <Text style={styles.loadedModelMeta}>
                      {activeTextModel?.quantization} • {activeTextModel ? hardwareService.formatModelSize(activeTextModel) : '0 B'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.unloadButton}
                    onPress={onUnloadModel}
                    disabled={isAnyLoading}
                  >
                    <Icon name="power" size={16} color={colors.error} />
                    <Text style={styles.unloadButtonText}>Unload</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Available Text Models */}
            <Text style={styles.sectionTitle}>
              {hasLoadedTextModel ? 'Switch Model' : 'Available Models'}
            </Text>

            {downloadedModels.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name="package" size={40} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>No Text Models</Text>
                <Text style={styles.emptyText}>
                  Download models from the Models tab
                </Text>
              </View>
            ) : (
              downloadedModels.map((model) => {
                const isCurrent = isCurrentTextModel(model);
                return (
                  <TouchableOpacity
                    key={model.id}
                    style={[styles.modelItem, isCurrent && styles.modelItemSelected]}
                    onPress={() => onSelectModel(model)}
                    disabled={isAnyLoading || isCurrent}
                  >
                    <View style={styles.modelInfo}>
                      <Text
                        style={[styles.modelName, isCurrent && styles.modelNameSelected]}
                        numberOfLines={1}
                      >
                        {model.name}
                      </Text>
                      <View style={styles.modelMeta}>
                        <Text style={styles.modelSize}>{hardwareService.formatModelSize(model)}</Text>
                        {model.quantization && (
                          <>
                            <Text style={styles.metaSeparator}>•</Text>
                            <Text style={styles.modelQuant}>{model.quantization}</Text>
                          </>
                        )}
                        {model.isVisionModel && (
                          <>
                            <Text style={styles.metaSeparator}>•</Text>
                            <View style={styles.visionBadge}>
                              <Icon name="eye" size={10} color={colors.info} />
                              <Text style={styles.visionBadgeText}>Vision</Text>
                            </View>
                          </>
                        )}
                      </View>
                    </View>
                    {isCurrent && (
                      <View style={styles.checkmark}>
                        <Icon name="check" size={16} color={colors.background} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </>
        ) : (
          // Image Models Tab
          <>
            {/* Currently Loaded Image Model */}
            {hasLoadedImageModel && (
              <View style={[styles.loadedSection, { borderColor: colors.info + '40' }]}>
                <View style={styles.loadedHeader}>
                  <Icon name="check-circle" size={14} color={colors.success} />
                  <Text style={styles.loadedLabel}>Currently Loaded</Text>
                </View>
                <View style={styles.loadedModelItem}>
                  <View style={styles.loadedModelInfo}>
                    <Text style={styles.loadedModelName} numberOfLines={1}>
                      {activeImageModel?.name || 'Unknown'}
                    </Text>
                    <Text style={styles.loadedModelMeta}>
                      {activeImageModel?.style || 'Image'} • {formatSize(activeImageModel?.size || 0)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.unloadButton}
                    onPress={handleUnloadImageModel}
                    disabled={isAnyLoading}
                  >
                    {isLoadingImage ? (
                      <ActivityIndicator size="small" color={colors.error} />
                    ) : (
                      <>
                        <Icon name="power" size={16} color={colors.error} />
                        <Text style={styles.unloadButtonText}>Unload</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Available Image Models */}
            <Text style={styles.sectionTitle}>
              {hasLoadedImageModel ? 'Switch Model' : 'Available Models'}
            </Text>

            {downloadedImageModels.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name="image" size={40} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>No Image Models</Text>
                <Text style={styles.emptyText}>
                  Download image models from the Models tab
                </Text>
              </View>
            ) : (
              downloadedImageModels.map((model) => {
                const isCurrent = isCurrentImageModel(model);
                return (
                  <TouchableOpacity
                    key={model.id}
                    style={[
                      styles.modelItem,
                      isCurrent && styles.modelItemSelectedImage
                    ]}
                    onPress={() => handleSelectImageModel(model)}
                    disabled={isAnyLoading || isCurrent}
                  >
                    <View style={styles.modelInfo}>
                      <Text
                        style={[
                          styles.modelName,
                          isCurrent && { color: colors.info }
                        ]}
                        numberOfLines={1}
                      >
                        {model.name}
                      </Text>
                      <View style={styles.modelMeta}>
                        <Text style={styles.modelSize}>{formatSize(model.size)}</Text>
                        {model.style && (
                          <>
                            <Text style={styles.metaSeparator}>•</Text>
                            <Text style={styles.modelStyle}>{model.style}</Text>
                          </>
                        )}
                      </View>
                    </View>
                    {isCurrent && (
                      <View style={[styles.checkmark, { backgroundColor: colors.info }]}>
                        <Icon name="check" size={16} color={colors.background} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </>
        )}
      </ScrollView>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  tabBar: {
    flexDirection: 'row' as const,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.surface,
    gap: 8,
  },
  tabActive: {
    backgroundColor: colors.primary + '20',
  },
  tabText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.primary,
  },
  tabBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary + '30',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  tabBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  loadingBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.primary + '20',
    paddingVertical: 10,
    gap: 10,
  },
  loadingText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
  },
  content: {
    padding: 16,
  },
  contentContainer: {
    paddingBottom: 24,
  },
  loadedSection: {
    marginBottom: 20,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  loadedHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 10,
  },
  loadedLabel: {
    ...TYPOGRAPHY.label,
    color: colors.success,
    textTransform: 'uppercase' as const,
  },
  loadedModelItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  loadedModelInfo: {
    flex: 1,
  },
  loadedModelName: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    marginBottom: 2,
  },
  loadedModelMeta: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  unloadButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.error + '15',
    gap: 6,
  },
  unloadButtonText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.error,
  },
  sectionTitle: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    marginBottom: 12,
    textTransform: 'uppercase' as const,
  },
  emptyState: {
    alignItems: 'center' as const,
    paddingVertical: 40,
    gap: 12,
  },
  emptyTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
  },
  modelItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  modelItemSelected: {
    backgroundColor: colors.primary + '15',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  modelItemSelectedImage: {
    backgroundColor: colors.info + '15',
    borderWidth: 1,
    borderColor: colors.info,
  },
  modelInfo: {
    flex: 1,
  },
  modelName: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    marginBottom: 4,
  },
  modelNameSelected: {
    color: colors.primary,
  },
  modelMeta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  modelSize: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  metaSeparator: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginHorizontal: 6,
  },
  modelQuant: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
  },
  modelStyle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
  },
  visionBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.info + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  visionBadgeText: {
    ...TYPOGRAPHY.label,
    color: colors.info,
  },
  checkmark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});
