import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  Modal,
  Dimensions,
  Alert,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import RNFS from 'react-native-fs';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { COLORS } from '../constants';
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
    Alert.alert(
      'Delete Image',
      'Are you sure you want to delete this image?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await onnxImageGeneratorService.deleteGeneratedImage(image.id);
            removeGeneratedImage(image.id);
            if (selectedImage?.id === image.id) {
              setSelectedImage(null);
            }
          },
        },
      ]
    );
  }, [selectedImage, removeGeneratedImage]);

  const handleSaveImage = useCallback(async (image: GeneratedImage) => {
    try {
      if (Platform.OS === 'android') {
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
      }

      const sourcePath = image.imagePath;
      const picturesDir = Platform.OS === 'android'
        ? `${RNFS.ExternalStorageDirectoryPath}/Pictures/LocalLLM`
        : `${RNFS.DocumentDirectoryPath}/LocalLLM_Images`;

      if (!(await RNFS.exists(picturesDir))) {
        await RNFS.mkdir(picturesDir);
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `generated_${timestamp}.png`;
      const destPath = `${picturesDir}/${fileName}`;

      await RNFS.copyFile(sourcePath, destPath);

      Alert.alert(
        'Image Saved',
        Platform.OS === 'android'
          ? `Saved to Pictures/LocalLLM/${fileName}`
          : `Saved to ${fileName}`
      );
    } catch (error: any) {
      Alert.alert('Error', `Failed to save image: ${error?.message || 'Unknown error'}`);
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

  const renderGridItem = ({ item }: { item: GeneratedImage }) => (
    <TouchableOpacity
      style={styles.gridItem}
      onPress={() => setSelectedImage(item)}
      onLongPress={() => handleDelete(item)}
      activeOpacity={0.8}
    >
      <Image
        source={{ uri: `file://${item.imagePath}` }}
        style={styles.gridImage}
      />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="x" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{screenTitle}</Text>
        <Text style={styles.countBadge}>
          {displayImages.length}
        </Text>
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
              <Icon name="x" size={16} color={COLORS.error} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Grid */}
      {displayImages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="image" size={48} color={COLORS.textMuted} />
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
              <Image
                source={{ uri: `file://${selectedImage.imagePath}` }}
                style={styles.fullscreenImage}
                resizeMode="contain"
              />

              {/* Details panel */}
              {showDetails && (
                <View style={styles.detailsPanel}>
                  <Text style={styles.detailsTitle}>Details</Text>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Prompt</Text>
                    <Text style={styles.detailValue} numberOfLines={3}>
                      {selectedImage.prompt}
                    </Text>
                  </View>
                  {selectedImage.negativePrompt ? (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Negative</Text>
                      <Text style={styles.detailValue} numberOfLines={2}>
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
                </View>
              )}

              {/* Action buttons */}
              <View style={styles.viewerActions}>
                <TouchableOpacity
                  style={styles.viewerButton}
                  onPress={() => setShowDetails(!showDetails)}
                >
                  <Icon name="info" size={22} color={COLORS.text} />
                  <Text style={styles.viewerButtonText}>Info</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.viewerButton}
                  onPress={() => handleSaveImage(selectedImage)}
                >
                  <Icon name="download" size={22} color={COLORS.text} />
                  <Text style={styles.viewerButtonText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.viewerButton}
                  onPress={() => handleDelete(selectedImage)}
                >
                  <Icon name="trash-2" size={22} color={COLORS.error} />
                  <Text style={[styles.viewerButtonText, { color: COLORS.error }]}>Delete</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.viewerButton}
                  onPress={() => {
                    setSelectedImage(null);
                    setShowDetails(false);
                  }}
                >
                  <Icon name="x" size={22} color={COLORS.text} />
                  <Text style={styles.viewerButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  closeButton: {
    padding: 4,
    marginRight: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
  },
  countBadge: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  // Active generation banner
  genBanner: {
    backgroundColor: COLORS.surface,
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    padding: 12,
  },
  genBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  genPreview: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
  },
  genBannerInfo: {
    flex: 1,
  },
  genBannerTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  genBannerPrompt: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  genProgressBar: {
    height: 4,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  genProgressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  genSteps: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  genCancelButton: {
    padding: 6,
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
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceLight,
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
  // Fullscreen viewer
  viewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  viewerContent: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height * 0.65,
  },
  viewerActions: {
    flexDirection: 'row',
    position: 'absolute',
    bottom: 60,
    gap: 20,
  },
  viewerButton: {
    alignItems: 'center',
    padding: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    minWidth: 70,
  },
  viewerButtonText: {
    color: COLORS.text,
    marginTop: 4,
    fontSize: 11,
    fontWeight: '500',
  },
  // Details panel
  detailsPanel: {
    position: 'absolute',
    top: 80,
    left: 16,
    right: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
  },
  detailsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  detailRow: {
    marginBottom: 10,
  },
  detailLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
  },
  detailsMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  detailChip: {
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  detailChipText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  detailDate: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 10,
  },
});
