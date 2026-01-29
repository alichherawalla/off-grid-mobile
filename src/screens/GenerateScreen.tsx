import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Image,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Linking,
  Platform,
  Modal,
  FlatList,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import RNFS from 'react-native-fs';
import { Card, Button } from '../components';
import { COLORS } from '../constants';
import { imageGeneratorService, huggingFaceService } from '../services';
import { GeneratedImage, ImageGenerationProgress } from '../types';

const { width: screenWidth } = Dimensions.get('window');
const imagePreviewSize = screenWidth - 64;

export const GenerateScreen: React.FC = () => {
  // Form state
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [steps, setSteps] = useState(20);
  const [guidanceScale, setGuidanceScale] = useState(7.5);
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [seed, setSeed] = useState<number | undefined>(undefined);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<ImageGenerationProgress | null>(null);
  const [generatedImage, setGeneratedImage] = useState<GeneratedImage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Model state
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [modelPath, setModelPath] = useState<string>('');
  const [showModelSetup, setShowModelSetup] = useState(false);

  // Folder browser state
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [currentBrowserPath, setCurrentBrowserPath] = useState('/storage/emulated/0');
  const [folderContents, setFolderContents] = useState<Array<{ name: string; isDirectory: boolean; path: string }>>([]);
  const [isLoadingFolder, setIsLoadingFolder] = useState(false);

  // Gallery state
  const [galleryImages, setGalleryImages] = useState<GeneratedImage[]>([]);
  const [showGallery, setShowGallery] = useState(false);

  useEffect(() => {
    checkAvailability();
    loadGallery();
  }, []);

  const checkAvailability = async () => {
    const available = imageGeneratorService.isAvailable();
    setIsAvailable(available);

    if (available) {
      const loaded = await imageGeneratorService.isModelLoaded();
      setIsModelLoaded(loaded);

      // Get the loaded model path if any
      const loadedPath = await imageGeneratorService.getLoadedModelPath();
      if (loadedPath) {
        setModelPath(loadedPath);
      }
    }
  };

  const handleLoadModel = async () => {
    if (!modelPath.trim()) {
      Alert.alert('Error', 'Please enter the model folder path');
      return;
    }

    setIsLoadingModel(true);
    try {
      await imageGeneratorService.loadModel(modelPath.trim());
      setIsModelLoaded(true);
      setShowModelSetup(false);
      Alert.alert('Success', 'Image generation model loaded successfully!');
    } catch (error) {
      Alert.alert('Error', `Failed to load model: ${(error as Error).message}`);
    } finally {
      setIsLoadingModel(false);
    }
  };

  const handleUnloadModel = async () => {
    try {
      await imageGeneratorService.unloadModel();
      setIsModelLoaded(false);
      setModelPath('');
    } catch (error) {
      Alert.alert('Error', `Failed to unload model: ${(error as Error).message}`);
    }
  };

  const handleBrowseFolder = async () => {
    setCurrentBrowserPath('/storage/emulated/0');
    await loadFolderContents('/storage/emulated/0');
    setShowFolderBrowser(true);
  };

  const loadFolderContents = async (path: string) => {
    setIsLoadingFolder(true);
    try {
      const items = await RNFS.readDir(path);
      const folders = items
        .filter(item => item.isDirectory())
        .map(item => ({
          name: item.name,
          isDirectory: true,
          path: item.path,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setFolderContents(folders);
      setCurrentBrowserPath(path);
    } catch (error) {
      Alert.alert('Error', `Cannot access folder: ${(error as Error).message}`);
    } finally {
      setIsLoadingFolder(false);
    }
  };

  const handleFolderSelect = (folder: { name: string; path: string }) => {
    loadFolderContents(folder.path);
  };

  const handleGoUp = () => {
    const parentPath = currentBrowserPath.split('/').slice(0, -1).join('/') || '/storage/emulated/0';
    loadFolderContents(parentPath);
  };

  const handleSelectCurrentFolder = () => {
    setModelPath(currentBrowserPath);
    setShowFolderBrowser(false);
  };

  const loadGallery = async () => {
    const images = await imageGeneratorService.getGeneratedImages();
    setGalleryImages(images);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      Alert.alert('Error', 'Please enter a prompt');
      return;
    }

    if (!isModelLoaded) {
      Alert.alert(
        'No Model Loaded',
        'Please download and select an image generation model first from the Models tab.'
      );
      return;
    }

    setIsGenerating(true);
    setProgress(null);
    setError(null);
    setGeneratedImage(null);

    try {
      const result = await imageGeneratorService.generateImage(
        {
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim() || undefined,
          steps,
          guidanceScale,
          width,
          height,
          seed,
        },
        (prog) => {
          setProgress(prog);
        },
        (image) => {
          setGeneratedImage(image);
          loadGallery();
        },
        (err) => {
          setError(err.message);
        }
      );

      setGeneratedImage(result);
      loadGallery();
    } catch (err) {
      setError((err as Error).message);
      Alert.alert('Generation Failed', (err as Error).message);
    } finally {
      setIsGenerating(false);
      setProgress(null);
    }
  };

  const handleCancel = async () => {
    await imageGeneratorService.cancelGeneration();
    setIsGenerating(false);
    setProgress(null);
  };

  const handleRandomSeed = () => {
    setSeed(Math.floor(Math.random() * 2147483647));
  };

  const handleDeleteImage = async (imageId: string) => {
    Alert.alert(
      'Delete Image',
      'Are you sure you want to delete this image?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await imageGeneratorService.deleteGeneratedImage(imageId);
            loadGallery();
            if (generatedImage?.id === imageId) {
              setGeneratedImage(null);
            }
          },
        },
      ]
    );
  };

  if (!isAvailable) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
          <Text style={styles.title}>Image Generation</Text>
          <Card style={styles.unavailableCard}>
            <Text style={styles.unavailableIcon}>🎨</Text>
            <Text style={styles.unavailableTitle}>Setup Required</Text>
            <Text style={styles.unavailableText}>
              Image generation requires the native MediaPipe module to be built.
              {'\n\n'}
              To enable this feature:
              {'\n'}1. Stop Metro bundler
              {'\n'}2. Run: npx react-native run-android
              {'\n'}3. Wait for the app to rebuild completely
              {'\n\n'}
              This is only needed once after adding the image generation feature.
              iOS support may be added in a future update.
            </Text>
          </Card>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Generate</Text>
          <TouchableOpacity
            style={styles.galleryButton}
            onPress={() => setShowGallery(!showGallery)}
          >
            <Text style={styles.galleryButtonText}>
              {showGallery ? 'Create' : `Gallery (${galleryImages.length})`}
            </Text>
          </TouchableOpacity>
        </View>

        {!isModelLoaded && !showModelSetup && (
          <Card style={styles.modelSetupCard}>
            <Text style={styles.modelSetupTitle}>Setup Required</Text>
            <Text style={styles.modelSetupText}>
              Image generation requires a MediaPipe-compatible Stable Diffusion model.
            </Text>
            <Text style={styles.modelSetupSteps}>
              To get started:{'\n'}
              1. Download a MediaPipe SD model from Google's repository{'\n'}
              2. Extract to your device storage{'\n'}
              3. Note the folder path (e.g., /storage/emulated/0/Download/sd-model)
            </Text>
            <Button
              title="Load Model from Device"
              onPress={() => setShowModelSetup(true)}
              style={styles.modelSetupButton}
            />
            <Button
              title="Get MediaPipe Models"
              variant="outline"
              size="small"
              onPress={() => {
                Linking.openURL('https://developers.google.com/mediapipe/solutions/vision/image_generator/android');
              }}
              style={styles.modelSetupButton}
            />
            <Text style={styles.modelSetupNote}>
              All processing happens locally on your device. No data is sent externally.
            </Text>
          </Card>
        )}

        {!isModelLoaded && showModelSetup && (
          <Card style={styles.modelSetupCard}>
            <Text style={styles.modelSetupTitle}>Load Model</Text>
            <Text style={styles.modelSetupText}>
              Select or enter the path to your MediaPipe SD model folder:
            </Text>

            <TouchableOpacity
              style={styles.browseFolderButton}
              onPress={handleBrowseFolder}
            >
              <Text style={styles.browseFolderIcon}>📁</Text>
              <Text style={styles.browseFolderText}>Browse for Model Folder</Text>
            </TouchableOpacity>

            <Text style={styles.orDivider}>— or enter path manually —</Text>

            <TextInput
              style={styles.modelPathInput}
              value={modelPath}
              onChangeText={setModelPath}
              placeholder="/storage/emulated/0/Download/sd-model"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.modelPathHint}>
              The folder should contain model weight files (bins.*, etc.)
            </Text>
            <View style={styles.modelSetupActions}>
              <Button
                title="Cancel"
                variant="outline"
                size="small"
                onPress={() => setShowModelSetup(false)}
                style={styles.modelSetupActionButton}
              />
              <Button
                title={isLoadingModel ? "Loading..." : "Load Model"}
                size="small"
                onPress={handleLoadModel}
                disabled={isLoadingModel || !modelPath.trim()}
                loading={isLoadingModel}
                style={styles.modelSetupActionButton}
              />
            </View>
          </Card>
        )}

        {isModelLoaded && (
          <Card style={styles.modelLoadedCard}>
            <View style={styles.modelLoadedHeader}>
              <Text style={styles.modelLoadedIcon}>✓</Text>
              <View style={styles.modelLoadedInfo}>
                <Text style={styles.modelLoadedTitle}>Model Loaded</Text>
                <Text style={styles.modelLoadedPath} numberOfLines={1}>
                  {modelPath}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleUnloadModel}>
              <Text style={styles.unloadButton}>Unload</Text>
            </TouchableOpacity>
          </Card>
        )}

        {showGallery ? (
          // Gallery View
          <View style={styles.gallery}>
            {galleryImages.length === 0 ? (
              <Card style={styles.emptyCard}>
                <Text style={styles.emptyText}>No generated images yet</Text>
              </Card>
            ) : (
              galleryImages.map((image) => (
                <TouchableOpacity
                  key={image.id}
                  style={styles.galleryItem}
                  onPress={() => {
                    setGeneratedImage(image);
                    setShowGallery(false);
                  }}
                  onLongPress={() => handleDeleteImage(image.id)}
                >
                  <Image
                    source={{ uri: `file://${image.imagePath}` }}
                    style={styles.galleryImage}
                  />
                </TouchableOpacity>
              ))
            )}
          </View>
        ) : (
          // Generation View
          <>
            {/* Generated Image Preview */}
            {generatedImage && (
              <Card style={styles.previewCard}>
                <Image
                  source={{ uri: `file://${generatedImage.imagePath}` }}
                  style={styles.previewImage}
                  resizeMode="contain"
                />
                <Text style={styles.previewPrompt} numberOfLines={2}>
                  {generatedImage.prompt}
                </Text>
              </Card>
            )}

            {/* Progress */}
            {isGenerating && (
              <Card style={styles.progressCard}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.progressText}>
                  {progress
                    ? `Step ${progress.step} of ${progress.totalSteps}`
                    : 'Starting generation...'}
                </Text>
                {progress && (
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${progress.progress * 100}%` },
                      ]}
                    />
                  </View>
                )}
                <Button
                  title="Cancel"
                  variant="outline"
                  size="small"
                  onPress={handleCancel}
                  style={styles.cancelButton}
                />
              </Card>
            )}

            {/* Prompt Input */}
            <Card style={styles.section}>
              <Text style={styles.sectionTitle}>Prompt</Text>
              <TextInput
                style={styles.promptInput}
                value={prompt}
                onChangeText={setPrompt}
                placeholder="Describe the image you want to create..."
                placeholderTextColor={COLORS.textMuted}
                multiline
                numberOfLines={3}
              />

              <Text style={[styles.sectionTitle, { marginTop: 16 }]}>
                Negative Prompt (Optional)
              </Text>
              <TextInput
                style={styles.promptInput}
                value={negativePrompt}
                onChangeText={setNegativePrompt}
                placeholder="What to avoid in the image..."
                placeholderTextColor={COLORS.textMuted}
                multiline
                numberOfLines={2}
              />
            </Card>

            {/* Settings */}
            <Card style={styles.section}>
              <Text style={styles.sectionTitle}>Settings</Text>

              {/* Steps */}
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Steps</Text>
                <Text style={styles.settingValue}>{steps}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={10}
                maximumValue={50}
                step={1}
                value={steps}
                onValueChange={setSteps}
                minimumTrackTintColor={COLORS.primary}
                maximumTrackTintColor={COLORS.surfaceLight}
                thumbTintColor={COLORS.primary}
              />

              {/* Guidance Scale */}
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Guidance Scale</Text>
                <Text style={styles.settingValue}>{guidanceScale.toFixed(1)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={1}
                maximumValue={20}
                step={0.5}
                value={guidanceScale}
                onValueChange={setGuidanceScale}
                minimumTrackTintColor={COLORS.primary}
                maximumTrackTintColor={COLORS.surfaceLight}
                thumbTintColor={COLORS.primary}
              />

              {/* Size */}
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Size</Text>
                <Text style={styles.settingValue}>{width}x{height}</Text>
              </View>
              <View style={styles.sizeButtons}>
                {[
                  { w: 512, h: 512, label: 'Square' },
                  { w: 512, h: 768, label: 'Portrait' },
                  { w: 768, h: 512, label: 'Landscape' },
                ].map((size) => (
                  <TouchableOpacity
                    key={size.label}
                    style={[
                      styles.sizeButton,
                      width === size.w && height === size.h && styles.sizeButtonActive,
                    ]}
                    onPress={() => {
                      setWidth(size.w);
                      setHeight(size.h);
                    }}
                  >
                    <Text
                      style={[
                        styles.sizeButtonText,
                        width === size.w && height === size.h && styles.sizeButtonTextActive,
                      ]}
                    >
                      {size.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Seed */}
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Seed</Text>
                <TouchableOpacity onPress={handleRandomSeed}>
                  <Text style={styles.randomButton}>Random</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.seedInput}
                value={seed?.toString() || ''}
                onChangeText={(text) => {
                  const num = parseInt(text, 10);
                  setSeed(isNaN(num) ? undefined : num);
                }}
                placeholder="Random"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="number-pad"
              />
            </Card>

            {/* Generate Button */}
            <Button
              title={isGenerating ? 'Generating...' : 'Generate Image'}
              onPress={handleGenerate}
              disabled={isGenerating || !prompt.trim() || !isModelLoaded}
              loading={isGenerating}
              style={styles.generateButton}
            />

            {error && (
              <Card style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </Card>
            )}
          </>
        )}
      </ScrollView>

      {/* Folder Browser Modal */}
      <Modal
        visible={showFolderBrowser}
        animationType="slide"
        onRequestClose={() => setShowFolderBrowser(false)}
      >
        <SafeAreaView style={styles.folderBrowserContainer}>
          <View style={styles.folderBrowserHeader}>
            <TouchableOpacity onPress={() => setShowFolderBrowser(false)}>
              <Text style={styles.folderBrowserCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.folderBrowserTitle}>Select Folder</Text>
            <TouchableOpacity onPress={handleSelectCurrentFolder}>
              <Text style={styles.folderBrowserSelect}>Select</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.currentPathContainer}>
            <Text style={styles.currentPathLabel}>Current:</Text>
            <Text style={styles.currentPath} numberOfLines={2}>
              {currentBrowserPath}
            </Text>
          </View>

          {currentBrowserPath !== '/storage/emulated/0' && (
            <TouchableOpacity style={styles.goUpButton} onPress={handleGoUp}>
              <Text style={styles.goUpIcon}>⬆️</Text>
              <Text style={styles.goUpText}>Go Up</Text>
            </TouchableOpacity>
          )}

          {isLoadingFolder ? (
            <ActivityIndicator size="large" color={COLORS.primary} style={styles.folderLoading} />
          ) : (
            <FlatList
              data={folderContents}
              keyExtractor={(item) => item.path}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.folderItem}
                  onPress={() => handleFolderSelect(item)}
                >
                  <Text style={styles.folderIcon}>📁</Text>
                  <Text style={styles.folderName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.folderArrow}>›</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.noFolders}>No folders found</Text>
              }
              contentContainerStyle={styles.folderList}
            />
          )}

          <View style={styles.folderBrowserFooter}>
            <Text style={styles.folderBrowserHint}>
              Navigate to your model folder, then tap "Select"
            </Text>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  galleryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
  },
  galleryButtonText: {
    color: COLORS.primary,
    fontWeight: '600',
    fontSize: 14,
  },
  warningCard: {
    backgroundColor: COLORS.warning + '20',
    borderWidth: 1,
    borderColor: COLORS.warning,
    marginBottom: 16,
  },
  warningText: {
    color: COLORS.warning,
    fontSize: 14,
    textAlign: 'center',
  },
  modelSetupCard: {
    marginBottom: 16,
    padding: 16,
  },
  modelSetupTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  modelSetupText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 12,
  },
  modelSetupSteps: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
    backgroundColor: COLORS.surfaceLight,
    padding: 12,
    borderRadius: 8,
  },
  modelSetupButton: {
    marginBottom: 12,
  },
  modelSetupNote: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  browseFolderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 10,
  },
  browseFolderIcon: {
    fontSize: 20,
  },
  browseFolderText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  orDivider: {
    textAlign: 'center',
    color: COLORS.textMuted,
    fontSize: 12,
    marginBottom: 12,
  },
  modelPathInput: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    padding: 14,
    color: COLORS.text,
    fontSize: 14,
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  modelPathHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 16,
  },
  modelSetupActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modelSetupActionButton: {
    flex: 1,
  },
  modelLoadedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    backgroundColor: COLORS.secondary + '15',
    borderWidth: 1,
    borderColor: COLORS.secondary + '40',
  },
  modelLoadedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  modelLoadedIcon: {
    fontSize: 20,
    color: COLORS.secondary,
  },
  modelLoadedInfo: {
    flex: 1,
  },
  modelLoadedTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.secondary,
  },
  modelLoadedPath: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  unloadButton: {
    fontSize: 13,
    color: COLORS.error,
    fontWeight: '500',
  },
  unavailableCard: {
    alignItems: 'center',
    padding: 32,
  },
  unavailableIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  unavailableTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  unavailableText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  promptInput: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    padding: 12,
    color: COLORS.text,
    fontSize: 15,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  settingLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  settingValue: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  slider: {
    width: '100%',
    height: 40,
    marginBottom: 12,
  },
  sizeButtons: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  sizeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
  },
  sizeButtonActive: {
    backgroundColor: COLORS.primary,
  },
  sizeButtonText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  sizeButtonTextActive: {
    color: COLORS.text,
  },
  seedInput: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    padding: 12,
    color: COLORS.text,
    fontSize: 14,
  },
  randomButton: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  generateButton: {
    marginTop: 8,
  },
  previewCard: {
    marginBottom: 16,
    alignItems: 'center',
    padding: 8,
  },
  previewImage: {
    width: imagePreviewSize,
    height: imagePreviewSize,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceLight,
  },
  previewPrompt: {
    marginTop: 8,
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  progressCard: {
    alignItems: 'center',
    padding: 24,
    marginBottom: 16,
  },
  progressText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.text,
  },
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 4,
    marginTop: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
  },
  cancelButton: {
    marginTop: 16,
  },
  errorCard: {
    backgroundColor: COLORS.error + '20',
    borderWidth: 1,
    borderColor: COLORS.error,
    marginTop: 16,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 14,
    textAlign: 'center',
  },
  gallery: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  galleryItem: {
    width: (screenWidth - 48) / 3,
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  galleryImage: {
    width: '100%',
    height: '100%',
  },
  emptyCard: {
    width: '100%',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 16,
  },
  // Folder browser styles
  folderBrowserContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  folderBrowserHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  folderBrowserCancel: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  folderBrowserTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  folderBrowserSelect: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '600',
  },
  currentPathContainer: {
    padding: 16,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  currentPathLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  currentPath: {
    fontSize: 13,
    color: COLORS.text,
    fontFamily: 'monospace',
  },
  goUpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: COLORS.surfaceLight,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 10,
  },
  goUpIcon: {
    fontSize: 16,
  },
  goUpText: {
    fontSize: 15,
    color: COLORS.primary,
    fontWeight: '500',
  },
  folderList: {
    padding: 8,
  },
  folderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    marginBottom: 6,
  },
  folderIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  folderName: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
  },
  folderArrow: {
    fontSize: 18,
    color: COLORS.textMuted,
  },
  noFolders: {
    textAlign: 'center',
    color: COLORS.textMuted,
    fontSize: 14,
    paddingVertical: 32,
  },
  folderLoading: {
    marginTop: 32,
  },
  folderBrowserFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  folderBrowserHint: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
