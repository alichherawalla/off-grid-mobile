import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { COLORS, TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore, useChatStore } from '../stores';
import { hardwareService, modelManager } from '../services';

interface OrphanedFile {
  name: string;
  path: string;
  size: number;
}

export const StorageSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const [storageUsed, setStorageUsed] = useState(0);
  const [availableStorage, setAvailableStorage] = useState(0);
  const [orphanedFiles, setOrphanedFiles] = useState<OrphanedFile[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const { downloadedModels, downloadedImageModels, activeBackgroundDownloads, setBackgroundDownload, clearBackgroundDownloads } = useAppStore();
  const { conversations } = useChatStore();

  const imageStorageUsed = downloadedImageModels.reduce((total, m) => total + (m.size || 0), 0);

  // Find stale download entries (entries with missing/invalid data)
  const staleDownloads = Object.entries(activeBackgroundDownloads).filter(([_, info]) => {
    return !info || !info.modelId || !info.fileName || !info.totalBytes;
  });

  useEffect(() => {
    loadStorageInfo();
    scanForOrphanedFiles();
  }, [downloadedModels, downloadedImageModels]);

  const loadStorageInfo = async () => {
    const used = await modelManager.getStorageUsed();
    const available = await modelManager.getAvailableStorage();
    setStorageUsed(used + imageStorageUsed);
    setAvailableStorage(available);
  };

  const scanForOrphanedFiles = useCallback(async () => {
    setIsScanning(true);
    try {
      const orphaned = await modelManager.getOrphanedFiles();
      setOrphanedFiles(orphaned);
    } catch (error) {
      console.error('Error scanning for orphaned files:', error);
    } finally {
      setIsScanning(false);
    }
  }, []);

  const handleDeleteOrphanedFile = useCallback((file: OrphanedFile) => {
    setAlertState(showAlert(
      'Delete Orphaned File',
      `Delete "${file.name}"?\n\nThis will free up ${hardwareService.formatBytes(file.size)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setAlertState(hideAlert());
            setIsDeleting(file.path);
            try {
              await modelManager.deleteOrphanedFile(file.path);
              setOrphanedFiles(prev => prev.filter(f => f.path !== file.path));
              loadStorageInfo();
            } catch (error) {
              setAlertState(showAlert('Error', 'Failed to delete file'));
            } finally {
              setIsDeleting(null);
            }
          },
        },
      ]
    ));
  }, []);

  const handleDeleteAllOrphaned = useCallback(() => {
    if (orphanedFiles.length === 0) return;

    const totalSize = orphanedFiles.reduce((sum, f) => sum + f.size, 0);
    setAlertState(showAlert(
      'Delete All Orphaned Files',
      `Delete ${orphanedFiles.length} orphaned file(s)?\n\nThis will free up ${hardwareService.formatBytes(totalSize)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            setAlertState(hideAlert());
            setIsScanning(true);
            for (const file of orphanedFiles) {
              try {
                await modelManager.deleteOrphanedFile(file.path);
              } catch (error) {
                console.error('Failed to delete:', file.path);
              }
            }
            setOrphanedFiles([]);
            loadStorageInfo();
            setIsScanning(false);
          },
        },
      ]
    ));
  }, [orphanedFiles]);

  const handleClearStaleDownload = useCallback((downloadId: number) => {
    setBackgroundDownload(downloadId, null);
  }, [setBackgroundDownload]);

  const handleClearAllStaleDownloads = useCallback(() => {
    setAlertState(showAlert(
      'Clear Stale Downloads',
      `Clear ${staleDownloads.length} stale download entry(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => {
            setAlertState(hideAlert());
            for (const [downloadId] of staleDownloads) {
              setBackgroundDownload(Number(downloadId), null);
            }
          },
        },
      ]
    ));
  }, [staleDownloads, setBackgroundDownload]);

  const totalStorage = storageUsed + availableStorage;
  const usedPercentage = totalStorage > 0 ? (storageUsed / totalStorage) * 100 : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={20} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Storage</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Storage Usage</Text>

          <View style={styles.storageBar}>
            <View style={[styles.storageUsed, { width: `${Math.min(usedPercentage, 100)}%` }]} />
          </View>

          <View style={styles.storageLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: COLORS.primary }]} />
              <Text style={styles.legendText}>Used: {hardwareService.formatBytes(storageUsed)}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: COLORS.surfaceLight }]} />
              <Text style={styles.legendText}>Free: {hardwareService.formatBytes(availableStorage)}</Text>
            </View>
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Breakdown</Text>

          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="cpu" size={18} color={COLORS.primary} />
              <Text style={styles.infoLabel}>LLM Models</Text>
            </View>
            <Text style={styles.infoValue}>{downloadedModels.length}</Text>
          </View>

          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="image" size={18} color={COLORS.primary} />
              <Text style={styles.infoLabel}>Image Models</Text>
            </View>
            <Text style={styles.infoValue}>{downloadedImageModels.length}</Text>
          </View>

          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Icon name="hard-drive" size={18} color={COLORS.primary} />
              <Text style={styles.infoLabel}>Model Storage</Text>
            </View>
            <Text style={styles.infoValue}>{hardwareService.formatBytes(storageUsed)}</Text>
          </View>

          <View style={[styles.infoRow, styles.lastRow]}>
            <View style={styles.infoRowLeft}>
              <Icon name="message-circle" size={18} color={COLORS.primary} />
              <Text style={styles.infoLabel}>Conversations</Text>
            </View>
            <Text style={styles.infoValue}>{conversations.length}</Text>
          </View>
        </Card>

        {downloadedModels.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>LLM Models</Text>
            {downloadedModels.map((model, index) => (
              <View
                key={model.id}
                style={[
                  styles.modelRow,
                  index === downloadedModels.length - 1 && styles.lastRow
                ]}
              >
                <View style={styles.modelInfo}>
                  <Text style={styles.modelName} numberOfLines={1}>{model.name}</Text>
                  <Text style={styles.modelMeta}>{model.quantization}</Text>
                </View>
                <Text style={styles.modelSize}>{hardwareService.formatModelSize(model)}</Text>
              </View>
            ))}
          </Card>
        )}

        {downloadedImageModels.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Image Models</Text>
            {downloadedImageModels.map((model, index) => (
              <View
                key={model.id}
                style={[
                  styles.modelRow,
                  index === downloadedImageModels.length - 1 && styles.lastRow
                ]}
              >
                <View style={styles.modelInfo}>
                  <Text style={styles.modelName} numberOfLines={1}>{model.name}</Text>
                  <Text style={styles.modelMeta}>{model.backend === 'qnn' ? 'Qualcomm NPU' : 'CPU'}{model.style ? ` • ${model.style}` : ''}</Text>
                </View>
                <Text style={styles.modelSize}>{hardwareService.formatBytes(model.size)}</Text>
              </View>
            ))}
          </Card>
        )}

        {/* Stale Downloads Section */}
        {staleDownloads.length > 0 && (
          <Card style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Stale Downloads</Text>
              <TouchableOpacity
                style={styles.clearAllButton}
                onPress={handleClearAllStaleDownloads}
              >
                <Text style={styles.clearAllText}>Clear All</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.warningText}>
              These download entries have invalid or missing data and can be safely cleared.
            </Text>
            {staleDownloads.map(([downloadId, info]) => (
              <View key={downloadId} style={styles.orphanedRow}>
                <View style={styles.orphanedInfo}>
                  <Text style={styles.orphanedName}>Download #{downloadId}</Text>
                  <Text style={styles.orphanedMeta}>
                    {info?.fileName || 'Unknown file'} • {info?.modelId || 'Unknown model'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleClearStaleDownload(Number(downloadId))}
                >
                  <Icon name="x" size={18} color={COLORS.error} />
                </TouchableOpacity>
              </View>
            ))}
          </Card>
        )}

        {/* Orphaned Files Section */}
        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Orphaned Files</Text>
            <TouchableOpacity
              style={styles.scanButton}
              onPress={scanForOrphanedFiles}
              disabled={isScanning}
            >
              {isScanning ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <Icon name="refresh-cw" size={16} color={COLORS.primary} />
              )}
            </TouchableOpacity>
          </View>

          {orphanedFiles.length === 0 ? (
            <Text style={styles.emptyText}>
              {isScanning ? 'Scanning...' : 'No orphaned files found'}
            </Text>
          ) : (
            <>
              <Text style={styles.warningText}>
                These files/folders exist on disk but aren't tracked as models.
                They may be from failed or cancelled downloads.
              </Text>
              {orphanedFiles.map((file) => (
                <View key={file.path} style={styles.orphanedRow}>
                  <View style={styles.orphanedInfo}>
                    <Text style={styles.orphanedName} numberOfLines={1}>{file.name}</Text>
                    <Text style={styles.orphanedMeta}>{hardwareService.formatBytes(file.size)}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleDeleteOrphanedFile(file)}
                    disabled={isDeleting === file.path}
                  >
                    {isDeleting === file.path ? (
                      <ActivityIndicator size="small" color={COLORS.error} />
                    ) : (
                      <Icon name="trash-2" size={18} color={COLORS.error} />
                    )}
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity
                style={styles.deleteAllButton}
                onPress={handleDeleteAllOrphaned}
              >
                <Icon name="trash-2" size={16} color={COLORS.error} />
                <Text style={styles.deleteAllText}>Delete All Orphaned Files</Text>
              </TouchableOpacity>
            </>
          )}
        </Card>

        <Text style={styles.hint}>
          To free up space, you can delete models from the Models tab.
        </Text>
      </ScrollView>
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
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: SPACING.md,
  },
  backButton: {
    padding: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.h2,
    flex: 1,
    color: COLORS.text,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase',
    color: COLORS.textMuted,
    marginBottom: SPACING.md,
    letterSpacing: 0.3,
  },
  storageBar: {
    height: 12,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: SPACING.md,
  },
  storageUsed: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 6,
  },
  storageLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  infoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  infoLabel: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
  },
  infoValue: {
    ...TYPOGRAPHY.body,
    color: COLORS.primary,
  },
  modelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modelInfo: {
    flex: 1,
    marginRight: SPACING.md,
  },
  modelName: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
  },
  modelMeta: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  modelSize: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  hint: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  clearAllButton: {
    padding: SPACING.sm,
  },
  clearAllText: {
    ...TYPOGRAPHY.body,
    color: COLORS.primary,
  },
  scanButton: {
    padding: SPACING.sm,
  },
  warningText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textMuted,
    marginBottom: SPACING.md,
    lineHeight: 18,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: SPACING.lg,
  },
  orphanedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  orphanedInfo: {
    flex: 1,
    marginRight: SPACING.md,
  },
  orphanedName: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
  },
  orphanedMeta: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  deleteButton: {
    padding: SPACING.sm,
  },
  deleteAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.md,
    paddingVertical: SPACING.md,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.error,
    borderRadius: 8,
  },
  deleteAllText: {
    ...TYPOGRAPHY.body,
    color: COLORS.error,
  },
});
