import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { COLORS } from '../constants';
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
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.modal} onStartShouldSetResponder={() => true}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Select Model</Text>
            <TouchableOpacity onPress={onClose} disabled={isAnyLoading}>
              <Text style={[styles.closeButton, isAnyLoading && styles.disabled]}>
                Done
              </Text>
            </TouchableOpacity>
          </View>

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
                color={activeTab === 'text' ? COLORS.primary : COLORS.textMuted}
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
                color={activeTab === 'image' ? COLORS.secondary : COLORS.textMuted}
              />
              <Text style={[
                styles.tabText,
                activeTab === 'image' && styles.tabTextActive,
                activeTab === 'image' && { color: COLORS.secondary }
              ]}>
                Image
              </Text>
              {hasLoadedImageModel && (
                <View style={[styles.tabBadge, { backgroundColor: COLORS.secondary + '30' }]}>
                  <View style={[styles.tabBadgeDot, { backgroundColor: COLORS.secondary }]} />
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Loading Banner */}
          {isAnyLoading && (
            <View style={styles.loadingBanner}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.loadingText}>Loading model...</Text>
            </View>
          )}

          {/* Content */}
          <ScrollView style={styles.content}>
            {activeTab === 'text' ? (
              // Text Models Tab
              <>
                {/* Currently Loaded Text Model */}
                {hasLoadedTextModel && (
                  <View style={styles.loadedSection}>
                    <View style={styles.loadedHeader}>
                      <Icon name="check-circle" size={14} color={COLORS.success} />
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
                        <Icon name="power" size={16} color={COLORS.error} />
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
                    <Icon name="package" size={40} color={COLORS.textMuted} />
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
                                  <Icon name="eye" size={10} color={COLORS.secondary} />
                                  <Text style={styles.visionBadgeText}>Vision</Text>
                                </View>
                              </>
                            )}
                          </View>
                        </View>
                        {isCurrent && (
                          <View style={styles.checkmark}>
                            <Icon name="check" size={16} color={COLORS.background} />
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
                  <View style={[styles.loadedSection, { borderColor: COLORS.secondary + '40' }]}>
                    <View style={styles.loadedHeader}>
                      <Icon name="check-circle" size={14} color={COLORS.success} />
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
                          <ActivityIndicator size="small" color={COLORS.error} />
                        ) : (
                          <>
                            <Icon name="power" size={16} color={COLORS.error} />
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
                    <Icon name="image" size={40} color={COLORS.textMuted} />
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
                              isCurrent && { color: COLORS.secondary }
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
                          <View style={[styles.checkmark, { backgroundColor: COLORS.secondary }]}>
                            <Icon name="check" size={16} color={COLORS.background} />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </>
            )}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  closeButton: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '500',
  },
  disabled: {
    opacity: 0.5,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    gap: 8,
  },
  tabActive: {
    backgroundColor: COLORS.primary + '20',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  tabTextActive: {
    color: COLORS.primary,
  },
  tabBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  loadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary + '20',
    paddingVertical: 10,
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  content: {
    padding: 16,
  },
  loadedSection: {
    marginBottom: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
  },
  loadedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  loadedLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.success,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  loadedModelItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadedModelInfo: {
    flex: 1,
  },
  loadedModelName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  loadedModelMeta: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  unloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: COLORS.error + '15',
    gap: 6,
  },
  unloadButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.error,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  modelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: COLORS.surface,
  },
  modelItemSelected: {
    backgroundColor: COLORS.primary + '15',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  modelItemSelectedImage: {
    backgroundColor: COLORS.secondary + '15',
    borderWidth: 1,
    borderColor: COLORS.secondary,
  },
  modelInfo: {
    flex: 1,
  },
  modelName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  modelNameSelected: {
    color: COLORS.primary,
  },
  modelMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modelSize: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  metaSeparator: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginHorizontal: 6,
  },
  modelQuant: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontFamily: 'monospace',
  },
  modelStyle: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  visionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.secondary + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  visionBadgeText: {
    fontSize: 11,
    color: COLORS.secondary,
    fontWeight: '600',
  },
  checkmark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
