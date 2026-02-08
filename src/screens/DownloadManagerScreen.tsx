import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { Card, Button } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { COLORS, TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore } from '../stores';
import { modelManager, backgroundDownloadService, activeModelService, hardwareService } from '../services';
import { DownloadedModel, BackgroundDownloadInfo, ONNXImageModel } from '../types';
import { useNavigation } from '@react-navigation/native';

type DownloadItem = {
  type: 'active' | 'completed';
  modelType: 'text' | 'image';
  downloadId?: number;
  modelId: string;
  fileName: string;
  author: string;
  quantization: string;
  fileSize: number;
  bytesDownloaded: number;
  progress: number;
  status: string;
  downloadedAt?: string;
  filePath?: string;
};

export const DownloadManagerScreen: React.FC = () => {
  const navigation = useNavigation();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeDownloads, setActiveDownloads] = useState<BackgroundDownloadInfo[]>([]);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const cancelledKeysRef = useRef<Set<string>>(new Set());

  const {
    downloadedModels,
    setDownloadedModels,
    downloadProgress,
    setDownloadProgress,
    removeDownloadedModel,
    activeBackgroundDownloads,
    setBackgroundDownload,
    downloadedImageModels,
    setDownloadedImageModels,
    removeDownloadedImageModel,
  } = useAppStore();

  // Load active background downloads on mount
  useEffect(() => {
    loadActiveDownloads();

    // Always start polling on Android to catch completed/stuck downloads
    if (Platform.OS === 'android') {
      modelManager.startBackgroundDownloadPolling();
    }

    return () => {
      modelManager.stopBackgroundDownloadPolling();
    };
  }, []);

  // Subscribe to background download events
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const unsubProgress = backgroundDownloadService.onAnyProgress((event) => {
      const key = `${event.modelId}/${event.fileName}`;
      if (cancelledKeysRef.current.has(key)) return;
      setDownloadProgress(key, {
        progress: event.totalBytes > 0 ? event.bytesDownloaded / event.totalBytes : 0,
        bytesDownloaded: event.bytesDownloaded,
        totalBytes: event.totalBytes,
      });
    });

    const unsubComplete = backgroundDownloadService.onAnyComplete(async (event) => {
      // Clear progress
      setDownloadProgress(`${event.modelId}/${event.fileName}`, null);

      // Reload downloads
      await loadActiveDownloads();
      const models = await modelManager.getDownloadedModels();
      setDownloadedModels(models);
    });

    const unsubError = backgroundDownloadService.onAnyError((event) => {
      setDownloadProgress(`${event.modelId}/${event.fileName}`, null);
      setBackgroundDownload(event.downloadId, null);
      setAlertState(showAlert('Download Failed', event.reason || 'Unknown error'));
    });

    return () => {
      unsubProgress();
      unsubComplete();
      unsubError();
    };
  }, []);

  const loadActiveDownloads = async () => {
    if (Platform.OS === 'android') {
      const downloads = await modelManager.getActiveBackgroundDownloads();
      setActiveDownloads(downloads.filter(d => d.status === 'running' || d.status === 'pending' || d.status === 'paused'));
    }
  };

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadActiveDownloads();
    const models = await modelManager.getDownloadedModels();
    setDownloadedModels(models);
    const imageModels = await modelManager.getDownloadedImageModels();
    setDownloadedImageModels(imageModels);
    setIsRefreshing(false);
  }, []);

  const handleRemoveDownload = async (item: DownloadItem) => {
    setAlertState(showAlert(
      'Remove Download',
      'Are you sure you want to remove this download?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes',
          style: 'destructive',
          onPress: async () => {
            setAlertState(hideAlert());
            try {
              // Mark as cancelled so polling events don't re-add it
              const key = `${item.modelId}/${item.fileName}`;
              cancelledKeysRef.current.add(key);

              // Clear from progress tracking immediately (optimistic update)
              setDownloadProgress(key, null);

              // Find downloadId - either from the item or by cross-referencing active downloads
              let downloadId = item.downloadId;
              if (!downloadId) {
                const match = activeDownloads.find(d => {
                  const meta = activeBackgroundDownloads[d.downloadId];
                  return meta && meta.fileName === item.fileName;
                });
                if (match) downloadId = match.downloadId;
              }

              // Remove from local activeDownloads state immediately
              if (downloadId) {
                setActiveDownloads(prev => prev.filter(d => d.downloadId !== downloadId));
                setBackgroundDownload(downloadId, null);
                await modelManager.cancelBackgroundDownload(downloadId);
              }

              // Wait a bit for native cancellation to complete, then reload
              setTimeout(async () => {
                await loadActiveDownloads();
                // Only clear cancelled key if native cancel succeeded
                if (downloadId) {
                  cancelledKeysRef.current.delete(key);
                }
              }, 1000);
            } catch (error) {
              setAlertState(showAlert('Error', 'Failed to remove download'));
            }
          },
        },
      ]
    ));
  };

  const handleDeleteModel = async (model: DownloadedModel) => {
    const totalSize = hardwareService.getModelTotalSize(model);
    setAlertState(showAlert(
      'Delete Model',
      `Are you sure you want to delete "${model.fileName}"? This will free up ${formatBytes(totalSize)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setAlertState(hideAlert());
            try {
              await modelManager.deleteModel(model.id);
              removeDownloadedModel(model.id);
            } catch (error) {
              setAlertState(showAlert('Error', 'Failed to delete model'));
            }
          },
        },
      ]
    ));
  };

  const handleDeleteImageModel = async (model: ONNXImageModel) => {
    setAlertState(showAlert(
      'Delete Image Model',
      `Are you sure you want to delete "${model.name}"? This will free up ${formatBytes(model.size)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setAlertState(hideAlert());
            try {
              // Unload if this is the active model
              await activeModelService.unloadImageModel();
              await modelManager.deleteImageModel(model.id);
              removeDownloadedImageModel(model.id);
            } catch (error) {
              setAlertState(showAlert('Error', 'Failed to delete image model'));
            }
          },
        },
      ]
    ));
  };

  // Combine RNFS downloads and background downloads
  const getDownloadItems = (): DownloadItem[] => {
    const items: DownloadItem[] = [];

    // Add active RNFS downloads (iOS and foreground Android)
    Object.entries(downloadProgress).forEach(([key, progress]) => {
      const [modelId, fileName] = key.split('/').slice(-2);
      const fullModelId = key.substring(0, key.lastIndexOf('/'));

      // Skip invalid entries (undefined, null, or malformed keys)
      if (!fileName || !fullModelId || fileName === 'undefined' || fullModelId === 'undefined' ||
          isNaN(progress.totalBytes) || isNaN(progress.bytesDownloaded)) {
        console.warn('[DownloadManager] Skipping invalid download entry:', key, progress);
        return;
      }

      items.push({
        type: 'active',
        modelType: 'text',
        modelId: fullModelId,
        fileName,
        author: fullModelId.split('/')[0] || 'Unknown',
        quantization: extractQuantization(fileName),
        fileSize: progress.totalBytes,
        bytesDownloaded: progress.bytesDownloaded,
        progress: progress.progress,
        status: 'downloading',
      });
    });

    // Add active background downloads (Android)
    activeDownloads.forEach((download) => {
      const metadata = activeBackgroundDownloads[download.downloadId];
      if (!metadata) return;

      // Skip if already tracked via RNFS progress
      const key = `${metadata.modelId}/${metadata.fileName}`;
      if (downloadProgress[key]) return;

      // Skip invalid entries
      if (!metadata.fileName || !metadata.modelId ||
          metadata.fileName === 'undefined' || metadata.modelId === 'undefined' ||
          isNaN(metadata.totalBytes) || isNaN(download.bytesDownloaded)) {
        console.warn('[DownloadManager] Skipping invalid background download:', metadata);
        return;
      }

      items.push({
        type: 'active',
        modelType: 'text',
        downloadId: download.downloadId,
        modelId: metadata.modelId,
        fileName: download.title || metadata.fileName,
        author: metadata.author,
        quantization: metadata.quantization,
        fileSize: metadata.totalBytes,
        bytesDownloaded: download.bytesDownloaded,
        progress: metadata.totalBytes > 0 ? download.bytesDownloaded / metadata.totalBytes : 0,
        status: download.status,
      });
    });

    // Add completed text model downloads
    downloadedModels.forEach((model) => {
      const totalSize = hardwareService.getModelTotalSize(model);
      items.push({
        type: 'completed',
        modelType: 'text',
        modelId: model.id,
        fileName: model.fileName,
        author: model.author,
        quantization: model.quantization,
        fileSize: totalSize,
        bytesDownloaded: totalSize,
        progress: 1,
        status: 'completed',
        downloadedAt: model.downloadedAt,
        filePath: model.filePath,
      });
    });

    // Add completed image model downloads
    downloadedImageModels.forEach((model) => {
      items.push({
        type: 'completed',
        modelType: 'image',
        modelId: model.id,
        fileName: model.name,
        author: 'Image Generation',
        quantization: '', // No quantization badge for image models
        fileSize: model.size,
        bytesDownloaded: model.size,
        progress: 1,
        status: 'completed',
        filePath: model.modelPath,
      });
    });

    return items;
  };

  const items = getDownloadItems();
  const activeItems = items.filter(i => i.type === 'active');
  const completedItems = items.filter(i => i.type === 'completed');

  const renderActiveItem = ({ item }: { item: DownloadItem }) => (
    <Card style={styles.downloadCard}>
      <View style={styles.downloadHeader}>
        <View style={styles.downloadInfo}>
          <Text style={styles.fileName} numberOfLines={1}>
            {item.fileName}
          </Text>
          <Text style={styles.modelId} numberOfLines={1}>
            {item.author}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => handleRemoveDownload(item)}
        >
          <Icon name="x" size={20} color={COLORS.error} />
        </TouchableOpacity>
      </View>

      <View style={styles.progressContainer}>
        <View style={styles.progressBarBackground}>
          <View
            style={[styles.progressBarFill, { width: `${Math.round(item.progress * 100)}%` as const }]}
          />
        </View>
        <Text style={styles.progressText}>
          {formatBytes(item.bytesDownloaded)} / {formatBytes(item.fileSize)}
        </Text>
      </View>

      <View style={styles.downloadMeta}>
        <View style={styles.quantBadge}>
          <Text style={styles.quantText}>{item.quantization}</Text>
        </View>
        <Text style={styles.statusText}>
          {item.status === 'running' ? 'Downloading...' :
           item.status === 'pending' ? 'Starting...' :
           item.status === 'paused' ? 'Paused' :
           item.status === 'unknown' ? 'Stuck - Remove & retry' : item.status}
        </Text>
      </View>
    </Card>
  );

  const renderCompletedItem = ({ item }: { item: DownloadItem }) => (
    <Card style={styles.downloadCard}>
      <View style={styles.downloadHeader}>
        <View style={styles.modelTypeIcon}>
          <Icon
            name={item.modelType === 'image' ? 'image' : 'message-square'}
            size={16}
            color={item.modelType === 'image' ? COLORS.info : COLORS.primary}
          />
        </View>
        <View style={styles.downloadInfo}>
          <Text style={styles.fileName} numberOfLines={1}>
            {item.fileName}
          </Text>
          <Text style={styles.modelId} numberOfLines={1}>
            {item.author}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.deleteButton}
          testID="delete-model-button"
          onPress={() => {
            if (item.modelType === 'image') {
              const model = downloadedImageModels.find(m => m.id === item.modelId);
              if (model) handleDeleteImageModel(model);
            } else {
              const model = downloadedModels.find(m => m.id === item.modelId);
              if (model) handleDeleteModel(model);
            }
          }}
        >
          <Icon name="trash-2" size={18} color={COLORS.error} />
        </TouchableOpacity>
      </View>

      <View style={styles.downloadMeta}>
        {item.quantization && (
          <View style={[styles.quantBadge, item.modelType === 'image' && styles.imageBadge]}>
            <Text style={[styles.quantText, item.modelType === 'image' && styles.imageQuantText]}>
              {item.quantization}
            </Text>
          </View>
        )}
        <Text style={styles.sizeText}>{formatBytes(item.fileSize)}</Text>
        {item.downloadedAt && (
          <Text style={styles.dateText}>
            {new Date(item.downloadedAt).toLocaleDateString()}
          </Text>
        )}
      </View>
    </Card>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="downloaded-models-screen">
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Download Manager</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={[{ key: 'content' }]}
        renderItem={() => (
          <View style={styles.content}>
            {/* Active Downloads Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Icon name="download" size={18} color={COLORS.primary} />
                <Text style={styles.sectionTitle}>Active Downloads</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{activeItems.length}</Text>
                </View>
              </View>

              {activeItems.length > 0 ? (
                activeItems.map((item, index) => (
                  <View key={`active-${index}`}>
                    {renderActiveItem({ item })}
                  </View>
                ))
              ) : (
                <Card style={styles.emptyCard}>
                  <Icon name="inbox" size={32} color={COLORS.textMuted} />
                  <Text style={styles.emptyText}>No active downloads</Text>
                </Card>
              )}
            </View>

            {/* Completed Downloads Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Icon name="check-circle" size={18} color={COLORS.success} />
                <Text style={styles.sectionTitle}>Downloaded Models</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{completedItems.length}</Text>
                </View>
              </View>

              {completedItems.length > 0 ? (
                completedItems.map((item, index) => (
                  <View key={`completed-${index}`}>
                    {renderCompletedItem({ item })}
                  </View>
                ))
              ) : (
                <Card style={styles.emptyCard}>
                  <Icon name="package" size={32} color={COLORS.textMuted} />
                  <Text style={styles.emptyText}>No models downloaded yet</Text>
                  <Text style={styles.emptySubtext}>
                    Go to the Models tab to browse and download models
                  </Text>
                </Card>
              )}
            </View>

            {/* Storage Info */}
            {completedItems.length > 0 && (
              <View style={styles.storageSection}>
                <View style={styles.storageRow}>
                  <Icon name="hard-drive" size={16} color={COLORS.textMuted} />
                  <Text style={styles.storageText}>
                    Total storage used: {formatBytes(
                      completedItems.reduce((sum, item) => sum + item.fileSize, 0)
                    )}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}
        keyExtractor={(item) => item.key}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
          />
        }
        contentContainerStyle={styles.listContent}
      />
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </SafeAreaView>
  );
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 0)} ${sizes[i]}`;
}

function extractQuantization(fileName: string): string {
  const upperName = fileName.toUpperCase();
  const patterns = ['Q2_K', 'Q3_K_S', 'Q3_K_M', 'Q4_0', 'Q4_K_S', 'Q4_K_M', 'Q5_K_S', 'Q5_K_M', 'Q6_K', 'Q8_0'];
  for (const pattern of patterns) {
    if (upperName.includes(pattern.replace('_', ''))) return pattern;
    if (upperName.includes(pattern)) return pattern;
  }
  const match = fileName.match(/[QqFf]\d+[_]?[KkMmSs]*/);
  return match ? match[0].toUpperCase() : 'Unknown';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  backButton: {
    padding: SPACING.sm,
    marginRight: SPACING.sm,
  },
  title: {
    ...TYPOGRAPHY.h2,
    flex: 1,
    color: COLORS.text,
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  listContent: {
    paddingBottom: SPACING.xxl,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.text,
    flex: 1,
  },
  countBadge: {
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.xs,
    borderRadius: 12,
  },
  countText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
  },
  downloadCard: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
  },
  downloadHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
  },
  modelTypeIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm + 2,
  },
  downloadInfo: {
    flex: 1,
  },
  fileName: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
    marginBottom: SPACING.xs / 2, // 2px - minimal spacing between filename and author
  },
  modelId: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
  },
  cancelButton: {
    padding: SPACING.sm,
    marginRight: -SPACING.sm,
    marginTop: -SPACING.xs,
  },
  deleteButton: {
    padding: SPACING.sm,
    marginRight: -SPACING.sm,
    marginTop: -SPACING.xs,
  },
  progressContainer: {
    marginBottom: SPACING.md,
  },
  progressBarBackground: {
    height: 6,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 3,
    marginBottom: SPACING.xs + 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  progressText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
  },
  downloadMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  quantBadge: {
    backgroundColor: COLORS.primary + '25',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 6,
  },
  quantText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.primary,
  },
  imageBadge: {
    backgroundColor: COLORS.info + '25',
  },
  imageQuantText: {
    color: COLORS.info,
  },
  statusText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
  },
  sizeText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
  },
  dateText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
  },
  emptyCard: {
    marginHorizontal: SPACING.lg,
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
    gap: SPACING.sm,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
  },
  emptySubtext: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  storageSection: {
    paddingHorizontal: SPACING.lg,
  },
  storageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    padding: SPACING.lg,
    borderRadius: 12,
  },
  storageText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
  },
});
