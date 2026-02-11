import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  Modal,
  ScrollView,
  Dimensions,
  Platform,
  PermissionsAndroid,
  Share,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import RNFS from 'react-native-fs';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore, useChatStore } from '../stores';
import { imageGenerationService, onnxImageGeneratorService } from '../services';
import type { ImageGenerationState } from '../services';
import { GeneratedImage } from '../types';
import { RootStackParamList } from '../navigation/types';

type GalleryScreenRouteProp = RouteProp<RootStackParamList, 'Gallery'>;

const { width: screenWidth } = Dimensions.get('window');
const COLUMN_COUNT = 3;
const GRID_SPACING = 4;
const CELL_SIZE = (screenWidth - GRID_SPACING * (COLUMN_COUNT + 1)) / COLUMN_COUNT;

export const GalleryScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<GalleryScreenRouteProp>();
  const conversationId = route.params?.conversationId;

  const { generatedImages, removeGeneratedImage } = useAppStore();

  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  // Multi-select mode state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Collect image attachment IDs from conversation messages for matching
  const conversations = useChatStore(s => s.conversations);
  const chatImageIds = useMemo(() => {
    if (!conversationId) return null;
    const convo = conversations.find(c => c.id === conversationId);
    if (!convo) return new Set<string>();
    const ids = new Set<string>();
    for (const msg of convo.messages) {
      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (att.type === 'image') ids.add(att.id);
        }
      }
    }
    return ids;
  }, [conversationId, conversations]);

  // Filter images when viewing from a specific conversation
  // Match by conversationId field OR by image ID found in chat message attachments
  const displayImages = useMemo(() => {
    if (!conversationId) return generatedImages;
    return generatedImages.filter(
      img => img.conversationId === conversationId || (chatImageIds && chatImageIds.has(img.id))
    );
  }, [generatedImages, conversationId, chatImageIds]);

  const screenTitle = conversationId ? 'Chat Images' : 'Gallery';

  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  // Subscribe to image generation service for active generation banner
  const [imageGenState, setImageGenState] = useState<ImageGenerationState>(
    imageGenerationService.getState()
  );

  useEffect(() => {
    const unsubscribe = imageGenerationService.subscribe((state) => {
      setImageGenState(state);
    });
    return unsubscribe;
  }, []);

  // Sync images from disk into store (adds any missing ones)
  useEffect(() => {
    const syncFromDisk = async () => {
      try {
        const diskImages = await onnxImageGeneratorService.getGeneratedImages();
        if (diskImages.length > 0) {
          const { generatedImages: storeImages, addGeneratedImage } = useAppStore.getState();
          const existingIds = new Set(storeImages.map(img => img.id));
          for (const img of diskImages) {
            if (!existingIds.has(img.id)) {
              addGeneratedImage(img);
            }
          }
        }
      } catch {
        // Silently fail - images will be added as they're generated
      }
    };
    syncFromDisk();
  }, []);

  const handleDelete = useCallback((image: GeneratedImage) => {
    setAlertState(showAlert(
      'Delete Image',
      'Are you sure you want to delete this image?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setAlertState(hideAlert());
            await onnxImageGeneratorService.deleteGeneratedImage(image.id);
            removeGeneratedImage(image.id);
            if (selectedImage?.id === image.id) {
              setSelectedImage(null);
            }
          },
        },
      ]
    ));
  }, [selectedImage, removeGeneratedImage]);

  const toggleSelectMode = useCallback(() => {
    setIsSelectMode(prev => {
      if (prev) {
        setSelectedIds(new Set());
      }
      return !prev;
    });
  }, []);

  const toggleImageSelection = useCallback((imageId: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(imageId)) {
        newSet.delete(imageId);
      } else {
        newSet.add(imageId);
      }
      return newSet;
    });
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;

    setAlertState(showAlert(
      'Delete Images',
      `Are you sure you want to delete ${selectedIds.size} image${selectedIds.size > 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setAlertState(hideAlert());
            for (const imageId of selectedIds) {
              await onnxImageGeneratorService.deleteGeneratedImage(imageId);
              removeGeneratedImage(imageId);
            }
            setSelectedIds(new Set());
            setIsSelectMode(false);
          },
        },
      ]
    ));
  }, [selectedIds, removeGeneratedImage]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(displayImages.map(img => img.id)));
  }, [displayImages]);

  const handleSaveImage = useCallback(async (image: GeneratedImage) => {
    try {
      if (Platform.OS === 'ios') {
        // On iOS, open the native share sheet so the user can save to Photos
        await Share.share({
          url: `file://${image.imagePath}`,
        });
        return;
      }

      // Android: save to Pictures directory
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        {
          title: 'Storage Permission',
          message: 'App needs access to save images',
          buttonNeutral: 'Ask Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );

      const sourcePath = image.imagePath;
      const picturesDir = `${RNFS.ExternalStorageDirectoryPath}/Pictures/LocalLLM`;

      if (!(await RNFS.exists(picturesDir))) {
        await RNFS.mkdir(picturesDir);
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `generated_${timestamp}.png`;
      const destPath = `${picturesDir}/${fileName}`;

      await RNFS.copyFile(sourcePath, destPath);

      setAlertState(showAlert('Image Saved', `Saved to Pictures/LocalLLM/${fileName}`));
    } catch (error: any) {
      setAlertState(showAlert('Error', `Failed to save image: ${error?.message || 'Unknown error'}`));
    }
  }, []);

  const handleCancelGeneration = useCallback(() => {
    imageGenerationService.cancelGeneration().catch(() => {});
  }, []);

  const formatDate = (dateStr: string) => {
    const ts = Number(dateStr);
    const date = isNaN(ts) ? new Date(dateStr) : new Date(ts);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderGridItem = ({ item, index }: { item: GeneratedImage; index: number }) => {
    const isSelected = selectedIds.has(item.id);

    return (
      <AnimatedEntry index={index} staggerMs={40} maxItems={15}>
        <TouchableOpacity
          style={styles.gridItem}
          onPress={() => {
            if (isSelectMode) {
              toggleImageSelection(item.id);
            } else {
              setSelectedImage(item);
            }
          }}
          onLongPress={() => {
            if (!isSelectMode) {
              setIsSelectMode(true);
              setSelectedIds(new Set([item.id]));
            }
          }}
          activeOpacity={0.8}
        >
          <Image
            source={{ uri: `file://${item.imagePath}` }}
            style={styles.gridImage}
          />
          {isSelectMode && (
            <View style={[styles.selectionOverlay, isSelected && styles.selectionOverlaySelected]}>
              <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                {isSelected && <Icon name="check" size={14} color="#fff" />}
              </View>
            </View>
          )}
        </TouchableOpacity>
      </AnimatedEntry>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        {isSelectMode ? (
          <>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={toggleSelectMode}
            >
              <Icon name="x" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.title}>
              {selectedIds.size} selected
            </Text>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={selectAll}
            >
              <Text style={styles.headerButtonText}>All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerButton, selectedIds.size === 0 && styles.headerButtonDisabled]}
              onPress={handleDeleteSelected}
              disabled={selectedIds.size === 0}
            >
              <Icon name="trash-2" size={20} color={selectedIds.size === 0 ? colors.textMuted : colors.error} />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => navigation.goBack()}
            >
              <Icon name="x" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.title}>{screenTitle}</Text>
            <Text style={styles.countBadge}>
              {displayImages.length}
            </Text>
            {displayImages.length > 0 && (
              <TouchableOpacity
                style={styles.headerButton}
                onPress={toggleSelectMode}
              >
                <Icon name="check-square" size={20} color={colors.text} />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {/* Active generation banner */}
      {imageGenState.isGenerating && (
        <View style={styles.genBanner}>
          <View style={styles.genBannerRow}>
            {imageGenState.previewPath && (
              <Image
                source={{ uri: imageGenState.previewPath }}
                style={styles.genPreview}
                resizeMode="cover"
              />
            )}
            <View style={styles.genBannerInfo}>
              <Text style={styles.genBannerTitle} numberOfLines={1}>
                {imageGenState.previewPath ? 'Refining...' : 'Generating...'}
              </Text>
              <Text style={styles.genBannerPrompt} numberOfLines={1}>
                {imageGenState.prompt}
              </Text>
              {imageGenState.progress && (
                <View style={styles.genProgressBar}>
                  <View
                    style={[
                      styles.genProgressFill,
                      { width: `${(imageGenState.progress.step / imageGenState.progress.totalSteps) * 100}%` },
                    ]}
                  />
                </View>
              )}
            </View>
            {imageGenState.progress && (
              <Text style={styles.genSteps}>
                {imageGenState.progress.step}/{imageGenState.progress.totalSteps}
              </Text>
            )}
            <TouchableOpacity
              style={styles.genCancelButton}
              onPress={handleCancelGeneration}
            >
              <Icon name="x" size={16} color={colors.error} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Grid */}
      {displayImages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="image" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>
            {conversationId ? 'No images in this chat' : 'No generated images yet'}
          </Text>
          <Text style={styles.emptyText}>
            Generate images from any chat conversation.
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayImages}
          renderItem={renderGridItem}
          keyExtractor={(item) => item.id}
          numColumns={COLUMN_COUNT}
          contentContainerStyle={styles.gridContainer}
          columnWrapperStyle={styles.gridRow}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Fullscreen Image Viewer Modal */}
      <Modal
        visible={!!selectedImage}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setSelectedImage(null);
          setShowDetails(false);
        }}
      >
        <View style={styles.viewerContainer}>
          <TouchableOpacity
            style={styles.viewerBackdrop}
            activeOpacity={1}
            onPress={() => {
              setSelectedImage(null);
              setShowDetails(false);
            }}
          />
          {selectedImage && (
            <View style={styles.viewerContent}>
              {!showDetails && (
                <Image
                  source={{ uri: `file://${selectedImage.imagePath}` }}
                  style={styles.fullscreenImage}
                  resizeMode="contain"
                />
              )}

              {/* Details bottom sheet (replaces image view) */}
              {showDetails && (
                <View style={styles.detailsSheet}>
                  <View style={styles.detailsSheetHeader}>
                    <Text style={styles.detailsSheetTitle}>Image Details</Text>
                    <TouchableOpacity onPress={() => setShowDetails(false)}>
                      <Text style={styles.detailsSheetClose}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <Image
                    source={{ uri: `file://${selectedImage.imagePath}` }}
                    style={styles.detailsPreview}
                    resizeMode="contain"
                  />
                  <ScrollView style={styles.detailsContent}>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>PROMPT</Text>
                      <Text style={styles.detailValue}>
                        {selectedImage.prompt}
                      </Text>
                    </View>
                    {selectedImage.negativePrompt ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>NEGATIVE</Text>
                        <Text style={styles.detailValue}>
                          {selectedImage.negativePrompt}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.detailsMetaRow}>
                      <View style={styles.detailChip}>
                        <Text style={styles.detailChipText}>{selectedImage.steps} steps</Text>
                      </View>
                      <View style={styles.detailChip}>
                        <Text style={styles.detailChipText}>
                          {selectedImage.width}x{selectedImage.height}
                        </Text>
                      </View>
                      <View style={styles.detailChip}>
                        <Text style={styles.detailChipText}>Seed: {selectedImage.seed}</Text>
                      </View>
                    </View>
                    <Text style={styles.detailDate}>
                      {formatDate(selectedImage.createdAt)}
                    </Text>
                  </ScrollView>
                </View>
              )}

              {/* Action buttons */}
              <View style={styles.viewerActions}>
                <TouchableOpacity
                  style={[styles.viewerButton, showDetails && styles.viewerButtonActive]}
                  onPress={() => setShowDetails(!showDetails)}
                >
                  <Icon name="info" size={22} color={showDetails ? colors.primary : colors.text} />
                  <Text style={[styles.viewerButtonText, showDetails && { color: colors.primary }]}>Info</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.viewerButton}
                  onPress={() => handleSaveImage(selectedImage)}
                >
                  <Icon name="download" size={22} color={colors.text} />
                  <Text style={styles.viewerButtonText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.viewerButton}
                  onPress={() => handleDelete(selectedImage)}
                >
                  <Icon name="trash-2" size={22} color={colors.error} />
                  <Text style={[styles.viewerButtonText, { color: colors.error }]}>Delete</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.viewerButton}
                  onPress={() => {
                    setSelectedImage(null);
                    setShowDetails(false);
                  }}
                >
                  <Icon name="x" size={22} color={colors.text} />
                  <Text style={styles.viewerButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>
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

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
  },
  closeButton: {
    padding: SPACING.xs,
    marginRight: SPACING.md,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    flex: 1,
  },
  countBadge: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginRight: SPACING.sm,
  },
  headerButton: {
    padding: SPACING.sm,
    marginLeft: SPACING.xs,
  },
  headerButtonDisabled: {
    opacity: 0.5,
  },
  headerButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
  },
  // Active generation banner
  genBanner: {
    backgroundColor: colors.surface,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    borderRadius: SPACING.md,
    padding: SPACING.md,
  },
  genBannerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm + 2, // 10
  },
  genPreview: {
    width: 40,
    height: 40,
    borderRadius: SPACING.sm,
    backgroundColor: colors.surfaceLight,
  },
  genBannerInfo: {
    flex: 1,
  },
  genBannerTitle: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    marginTop: 0,
  },
  genBannerPrompt: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: 2,
  },
  genProgressBar: {
    height: 4,
    backgroundColor: colors.surfaceLight,
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden' as const,
  },
  genProgressFill: {
    height: '100%' as const,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  genSteps: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  genCancelButton: {
    padding: SPACING.sm - 2, // 6
  },
  // Grid
  gridContainer: {
    padding: GRID_SPACING,
  },
  gridRow: {
    gap: GRID_SPACING,
    marginBottom: GRID_SPACING,
  },
  gridItem: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: SPACING.sm,
    overflow: 'hidden' as const,
    backgroundColor: colors.surfaceLight,
  },
  gridImage: {
    width: '100%' as const,
    height: '100%' as const,
  },
  selectionOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-start' as const,
    alignItems: 'flex-end' as const,
    padding: SPACING.sm - 2, // 6
  },
  selectionOverlaySelected: {
    backgroundColor: 'rgba(99, 102, 241, 0.25)',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: SPACING.xxl,
  },
  emptyTitle: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    marginTop: SPACING.lg,
  },
  emptyText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    textAlign: 'center' as const,
    marginTop: SPACING.sm,
  },
  // Fullscreen viewer
  viewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  viewerBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  viewerContent: {
    width: '100%' as const,
    height: '100%' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  fullscreenImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height * 0.65,
  },
  viewerActions: {
    flexDirection: 'row' as const,
    position: 'absolute' as const,
    bottom: 60,
    gap: SPACING.lg + 4, // 20
  },
  viewerButton: {
    alignItems: 'center' as const,
    padding: SPACING.md + 2, // 14
    backgroundColor: colors.surface,
    borderRadius: SPACING.md + 2, // 14
    minWidth: 70,
  },
  viewerButtonActive: {
    borderWidth: 1,
    borderColor: colors.primary,
  },
  viewerButtonText: {
    ...TYPOGRAPHY.meta,
    color: colors.text,
    marginTop: SPACING.xs,
  },
  // Details sheet (inside fullscreen viewer)
  detailsSheet: {
    flex: 1,
    width: '100%' as const,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    marginTop: 60,
    overflow: 'hidden' as const,
  },
  detailsSheetHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailsSheetTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
  },
  detailsSheetClose: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
  },
  detailsPreview: {
    width: '100%' as const,
    height: 200,
    backgroundColor: colors.background,
  },
  detailsContent: {
    padding: SPACING.lg,
  },
  detailRow: {
    marginBottom: SPACING.sm + 2, // 10
  },
  detailLabel: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginBottom: 2,
  },
  detailValue: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    lineHeight: 20,
  },
  detailsMetaRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  detailChip: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: SPACING.sm + 2, // 10
    paddingVertical: SPACING.xs,
    borderRadius: SPACING.sm,
  },
  detailChipText: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
  },
  detailDate: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: SPACING.sm + 2, // 10
  },
});
