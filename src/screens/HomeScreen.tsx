import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  InteractionManager,
} from 'react-native';
import { AppSheet } from '../components/AppSheet';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { Button, Card, CustomAlert, initialAlertState, showAlert, hideAlert } from '../components';
import type { AlertState } from '../components';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { FONTS, TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore, useChatStore } from '../stores';
import { modelManager, hardwareService, activeModelService, ResourceUsage } from '../services';
import { Conversation, DownloadedModel, ONNXImageModel } from '../types';
import { ChatsStackParamList } from '../navigation/types';
import { NavigatorScreenParams } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

type MainTabParamListWithNested = {
  HomeTab: undefined;
  ChatsTab: NavigatorScreenParams<ChatsStackParamList>;
  ProjectsTab: undefined;
  ModelsTab: undefined;
  SettingsTab: undefined;
};

type HomeScreenNavigationProp = BottomTabNavigationProp<MainTabParamListWithNested, 'HomeTab'>;

type HomeScreenProps = {
  navigation: HomeScreenNavigationProp;
};

type ModelPickerType = 'text' | 'image' | null;

type LoadingState = {
  isLoading: boolean;
  type: 'text' | 'image' | null;
  modelName: string | null;
};

// Track if we've synced native state to avoid repeated calls
let hasInitializedNativeSync = false;

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [pickerType, setPickerType] = useState<ModelPickerType>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>({
    isLoading: false,
    type: null,
    modelName: null,
  });
  const [isEjecting, setIsEjecting] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [memoryInfo, setMemoryInfo] = useState<ResourceUsage | null>(null);
  const isFirstMount = useRef(true);

  const {
    downloadedModels,
    setDownloadedModels,
    activeModelId,
    setActiveModelId,
    downloadedImageModels,
    setDownloadedImageModels,
    activeImageModelId,
    setActiveImageModelId,
    deviceInfo,
    setDeviceInfo,
    generatedImages,
  } = useAppStore();

  const { conversations, createConversation, setActiveConversation, deleteConversation } = useChatStore();

  useEffect(() => {
    // Defer heavy operations until after navigation animations complete
    const task = InteractionManager.runAfterInteractions(() => {
      loadData();
      // Only sync native state once per app session to avoid lag on screen transitions
      if (!hasInitializedNativeSync) {
        hasInitializedNativeSync = true;
        activeModelService.syncWithNativeState();
      }
    });

    isFirstMount.current = false;

    return () => task.cancel();
  }, []);

  // Refresh memory info periodically and when models change
  const refreshMemoryInfo = useCallback(async () => {
    try {
      const info = await activeModelService.getResourceUsage();
      setMemoryInfo(info);
    } catch (error) {
      console.warn('[HomeScreen] Failed to get memory info:', error);
    }
  }, []);

  // Refresh memory when models are loaded/unloaded (subscribe to changes)
  useEffect(() => {
    // Initial fetch
    refreshMemoryInfo();

    // Subscribe to model changes to refresh when models load/unload
    const unsubscribe = activeModelService.subscribe(() => {
      refreshMemoryInfo();
    });

    return () => unsubscribe();
  }, [refreshMemoryInfo]);

  const loadData = async () => {
    if (!deviceInfo) {
      const info = await hardwareService.getDeviceInfo();
      setDeviceInfo(info);
    }
    const models = await modelManager.getDownloadedModels();
    setDownloadedModels(models);
    const imageModels = await modelManager.getDownloadedImageModels();
    setDownloadedImageModels(imageModels);
  };

  const handleSelectTextModel = async (model: DownloadedModel) => {
    if (activeModelId === model.id) return;

    // Check memory before loading
    const memoryCheck = await activeModelService.checkMemoryForModel(model.id, 'text');

    if (!memoryCheck.canLoad) {
      // Critical: Not enough memory, don't allow loading
      setAlertState(showAlert('Insufficient Memory', memoryCheck.message));
      return;
    }

    if (memoryCheck.severity === 'warning') {
      // Warning: Ask user to confirm
      setAlertState(showAlert(
        'Low Memory Warning',
        memoryCheck.message,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Load Anyway',
            style: 'default',
            onPress: () => {
              setAlertState(hideAlert());
              proceedWithTextModelLoad(model);
            },
          },
        ]
      ));
      return;
    }

    // Safe to load
    proceedWithTextModelLoad(model);
  };

  const proceedWithTextModelLoad = async (model: DownloadedModel) => {
    setLoadingState({ isLoading: true, type: 'text', modelName: model.name });
    setPickerType(null); // Close modal when loading starts

    // Give UI time to update before starting heavy native operation
    // This prevents the app from appearing frozen
    await new Promise(resolve => requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 100);
      });
    }));

    try {
      await activeModelService.loadTextModel(model.id);
    } catch (error) {
      setAlertState(showAlert('Error', `Failed to load model: ${(error as Error).message}`));
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
  };

  const handleUnloadTextModel = async () => {
    console.log('[HomeScreen] handleUnloadTextModel called, activeModelId:', activeModelId);
    setLoadingState({ isLoading: true, type: 'text', modelName: null });
    setPickerType(null); // Close modal
    try {
      await activeModelService.unloadTextModel();
      console.log('[HomeScreen] unloadTextModel completed');
    } catch (error) {
      console.log('[HomeScreen] unloadTextModel error:', error);
      setAlertState(showAlert('Error', 'Failed to unload model'));
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
  };

  const handleSelectImageModel = async (model: ONNXImageModel) => {
    if (activeImageModelId === model.id) return;

    // Check memory before loading
    const memoryCheck = await activeModelService.checkMemoryForModel(model.id, 'image');

    if (!memoryCheck.canLoad) {
      // Critical: Not enough memory, don't allow loading
      setAlertState(showAlert('Insufficient Memory', memoryCheck.message));
      return;
    }

    if (memoryCheck.severity === 'warning') {
      // Warning: Ask user to confirm
      setAlertState(showAlert(
        'Low Memory Warning',
        memoryCheck.message,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Load Anyway',
            style: 'default',
            onPress: () => {
              setAlertState(hideAlert());
              proceedWithImageModelLoad(model);
            },
          },
        ]
      ));
      return;
    }

    // Safe to load
    proceedWithImageModelLoad(model);
  };

  const proceedWithImageModelLoad = async (model: ONNXImageModel) => {
    setLoadingState({ isLoading: true, type: 'image', modelName: model.name });
    setPickerType(null); // Close modal when loading starts

    // Give UI time to update before starting heavy native operation
    await new Promise(resolve => requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 100);
      });
    }));

    try {
      await activeModelService.loadImageModel(model.id);
    } catch (error) {
      setAlertState(showAlert('Error', `Failed to load model: ${(error as Error).message}`));
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
  };

  const handleUnloadImageModel = async () => {
    setLoadingState({ isLoading: true, type: 'image', modelName: null });
    setPickerType(null); // Close modal
    try {
      await activeModelService.unloadImageModel();
    } catch (error) {
      setAlertState(showAlert('Error', 'Failed to unload model'));
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
  };

  const handleEjectAll = () => {
    const hasModels = activeModelId || activeImageModelId;
    if (!hasModels) return;

    setAlertState(showAlert(
      'Eject All Models',
      'Unload all active models to free up memory?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Eject All',
          style: 'destructive',
          onPress: async () => {
            setAlertState(hideAlert());
            setIsEjecting(true);
            try {
              const results = await activeModelService.unloadAllModels();
              const count = (results.textUnloaded ? 1 : 0) + (results.imageUnloaded ? 1 : 0);
              if (count > 0) {
                setAlertState(showAlert('Done', `Unloaded ${count} model${count > 1 ? 's' : ''}`));
              }
            } catch (error) {
              setAlertState(showAlert('Error', 'Failed to unload models'));
            } finally {
              setIsEjecting(false);
            }
          },
        },
      ]
    ));
  };

  const startNewChat = () => {
    if (!activeModelId) return;
    const conversationId = createConversation(activeModelId);
    setActiveConversation(conversationId);
    navigation.navigate('ChatsTab', { screen: 'Chat', params: { conversationId } });
  };

  const continueChat = (conversationId: string) => {
    setActiveConversation(conversationId);
    navigation.navigate('ChatsTab', { screen: 'Chat', params: { conversationId } });
  };

  const handleDeleteConversation = (conversation: Conversation) => {
    setAlertState(showAlert(
      'Delete Conversation',
      `Delete "${conversation.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setAlertState(hideAlert());
            deleteConversation(conversation.id);
          },
        },
      ]
    ));
  };

  const renderRightActions = (conversation: Conversation) => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => handleDeleteConversation(conversation)}
    >
      <Icon name="trash-2" size={16} color={colors.text} />
    </TouchableOpacity>
  );

  const activeTextModel = downloadedModels.find((m) => m.id === activeModelId);
  const activeImageModel = downloadedImageModels.find((m) => m.id === activeImageModelId);
  const recentConversations = conversations.slice(0, 4);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View testID="home-screen" style={styles.scrollView}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Local LLM</Text>
        </View>

        {/* Active Models Section */}
        <AnimatedEntry index={0} staggerMs={50} trigger={focusTrigger}>
        <View style={styles.modelsRow}>
          {/* Text Model */}
          <AnimatedPressable
            style={styles.modelCard}
            onPress={() => setPickerType('text')}
            hapticType="selectionClick"
          >
            <View style={styles.modelCardHeader}>
              <Icon name="message-square" size={16} color={colors.textMuted} />
              <Text style={styles.modelCardLabel}>Text</Text>
              {loadingState.isLoading && loadingState.type === 'text' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Icon name="chevron-down" size={14} color={colors.textMuted} />
              )}
            </View>
            {loadingState.isLoading && loadingState.type === 'text' ? (
              <>
                <Text style={styles.modelCardName} numberOfLines={1}>
                  {loadingState.modelName || 'Unloading...'}
                </Text>
                <Text style={styles.modelCardLoading}>Loading...</Text>
              </>
            ) : activeTextModel ? (
              <>
                <Text style={styles.modelCardName} numberOfLines={1}>
                  {activeTextModel.name}
                </Text>
                <Text style={styles.modelCardMeta}>
                  {activeTextModel.quantization}
                </Text>
              </>
            ) : (
              <Text style={styles.modelCardEmpty}>
                {downloadedModels.length > 0 ? 'Tap to select' : 'No models'}
              </Text>
            )}
          </AnimatedPressable>

          {/* Image Model */}
          <AnimatedPressable
            style={styles.modelCard}
            onPress={() => setPickerType('image')}
            testID="image-model-card"
            hapticType="selectionClick"
          >
            <View style={styles.modelCardHeader}>
              <Icon name="image" size={16} color={colors.textMuted} />
              <Text style={styles.modelCardLabel}>Image</Text>
              {loadingState.isLoading && loadingState.type === 'image' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Icon name="chevron-down" size={14} color={colors.textMuted} />
              )}
            </View>
            {loadingState.isLoading && loadingState.type === 'image' ? (
              <>
                <Text style={styles.modelCardName} numberOfLines={1}>
                  {loadingState.modelName || 'Unloading...'}
                </Text>
                <Text style={styles.modelCardLoading}>Loading...</Text>
              </>
            ) : activeImageModel ? (
              <>
                <Text style={styles.modelCardName} numberOfLines={1}>
                  {activeImageModel.name}
                </Text>
                <Text style={styles.modelCardMeta}>
                  {activeImageModel.style || 'Ready'}
                </Text>
              </>
            ) : (
              <Text style={styles.modelCardEmpty}>
                {downloadedImageModels.length > 0 ? 'Tap to select' : 'No models'}
              </Text>
            )}
          </AnimatedPressable>
        </View>
        </AnimatedEntry>

        {/* Memory Usage Indicator - Shows loaded models and their estimated RAM */}
        {(activeTextModel || activeImageModel) && (
          <View style={styles.memoryIndicator}>
            <View style={styles.memoryHeader}>
              <Icon name="cpu" size={14} color={colors.textMuted} />
              <Text style={styles.memoryTitle}>Loaded Models</Text>
              <TouchableOpacity onPress={refreshMemoryInfo} style={styles.refreshButton}>
                <Icon name="refresh-cw" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {activeTextModel && (
              <View style={styles.memoryModelRow}>
                <Icon name="message-square" size={12} color={colors.textMuted} />
                <Text style={styles.memoryModelName} numberOfLines={1}>
                  {activeTextModel.name}{activeTextModel.isVisionModel ? ' + Vision' : ''}
                </Text>
                <Text style={styles.memoryModelSize}>
                  ~{(((activeTextModel.fileSize + (activeTextModel.mmProjFileSize || 0)) * 1.5) / (1024 * 1024 * 1024)).toFixed(1)} GB
                </Text>
              </View>
            )}
            {activeImageModel && (
              <View style={styles.memoryModelRow}>
                <Icon name="image" size={12} color={colors.textMuted} />
                <Text style={styles.memoryModelName} numberOfLines={1}>{activeImageModel.name}</Text>
                <Text style={styles.memoryModelSize}>
                  ~{((activeImageModel.size * 1.8) / (1024 * 1024 * 1024)).toFixed(1)} GB
                </Text>
              </View>
            )}
            {activeTextModel && activeImageModel && (
              <View style={styles.memoryTotalRow}>
                <Text style={styles.memoryTotalLabel}>Total estimated RAM</Text>
                <Text style={styles.memoryTotalValue}>
                  ~{((((activeTextModel.fileSize + (activeTextModel.mmProjFileSize || 0)) * 1.5) + (activeImageModel.size * 1.8)) / (1024 * 1024 * 1024)).toFixed(1)} GB
                </Text>
              </View>
            )}
            {activeTextModel && activeImageModel && (
              <Text style={styles.memoryWarningText}>
                Running both models uses significant memory. If the app becomes slow, try unloading one.
              </Text>
            )}
          </View>
        )}

        {/* Eject All - Show when models are loaded OR loading (so user can cancel) */}
        {(activeModelId || activeImageModelId || loadingState.isLoading) && (
          <TouchableOpacity
            style={styles.ejectAllButton}
            onPress={handleEjectAll}
            disabled={isEjecting}
          >
            {isEjecting ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <>
                <Icon name="power" size={14} color={colors.error} />
                <Text style={styles.ejectAllText}>
                  {loadingState.isLoading ? 'Cancel Loading' : 'Eject All Models'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* New Chat Button */}
        {activeTextModel ? (
          <Button
            title="New Chat"
            onPress={startNewChat}
            style={styles.newChatButton}
            testID="new-chat-button"
          />
        ) : (
          <Card style={styles.setupCard} testID="setup-card">
            <Text style={styles.setupText}>
              {downloadedModels.length > 0
                ? 'Select a text model to start chatting'
                : 'Download a text model to start chatting'}
            </Text>
            <Button
              title={downloadedModels.length > 0 ? "Select Model" : "Browse Models"}
              variant="outline"
              size="small"
              onPress={() => downloadedModels.length > 0 ? setPickerType('text') : navigation.navigate('ModelsTab')}
              testID="browse-models-button"
            />
          </Card>
        )}

        {/* Image Gallery */}
        <AnimatedPressable
          style={styles.galleryCard}
          onPress={() => (navigation as any).navigate('Gallery')}
          hapticType="selectionClick"
        >
          <Icon name="grid" size={18} color={colors.primary} />
          <View style={styles.galleryCardInfo}>
            <Text style={styles.galleryCardTitle}>Image Gallery</Text>
            <Text style={styles.galleryCardMeta}>
              {generatedImages.length} image{generatedImages.length !== 1 ? 's' : ''}
            </Text>
          </View>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </AnimatedPressable>

        {/* Recent Conversations */}
        {recentConversations.length > 0 && (
          <AnimatedEntry index={2} staggerMs={50} trigger={focusTrigger}>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent</Text>
              <TouchableOpacity onPress={() => navigation.navigate('ChatsTab')} testID="conversation-list-button">
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            </View>
            {recentConversations.map((conv, index) => (
              <Swipeable
                key={conv.id}
                renderRightActions={() => renderRightActions(conv)}
                overshootRight={false}
                containerStyle={{ overflow: 'visible' }}
              >
                <AnimatedListItem
                  index={index}
                  staggerMs={40}
                  trigger={focusTrigger}
                  style={styles.conversationItem}
                  onPress={() => continueChat(conv.id)}
                  testID={`conversation-item-${index}`}
                >
                  <View style={styles.conversationInfo}>
                    <Text style={styles.conversationTitle} numberOfLines={1}>
                      {conv.title}
                    </Text>
                    <Text style={styles.conversationMeta}>
                      {conv.messages.length} messages · {formatDate(conv.updatedAt)}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={16} color={colors.textMuted} />
                </AnimatedListItem>
              </Swipeable>
            ))}
          </View>
          </AnimatedEntry>
        )}

        {/* Model Stats */}
        <AnimatedEntry index={3} staggerMs={50} trigger={focusTrigger}>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{downloadedModels.length}</Text>
            <Text style={styles.statLabel}>Text models</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{downloadedImageModels.length}</Text>
            <Text style={styles.statLabel}>Image models</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{conversations.length}</Text>
            <Text style={styles.statLabel}>Chats</Text>
          </View>
        </View>
        </AnimatedEntry>
      </ScrollView>
      </View>

      {/* Model Picker Sheet */}
      <AppSheet
        visible={pickerType !== null}
        onClose={() => setPickerType(null)}
        title={pickerType === 'text' ? 'Text Models' : 'Image Models'}
        snapPoints={['70%']}
      >
            <ScrollView style={styles.modalScroll}>
              {pickerType === 'text' && (
                <>
                  {downloadedModels.length === 0 ? (
                    <View style={styles.emptyPicker}>
                      <Text style={styles.emptyPickerText}>No text models downloaded</Text>
                      <Button
                        title="Browse Models"
                        variant="outline"
                        size="small"
                        onPress={() => {
                          setPickerType(null);
                          navigation.navigate('ModelsTab');
                        }}
                      />
                    </View>
                  ) : (
                    <>
                      {activeModelId && (
                        <TouchableOpacity
                          style={styles.unloadButton}
                          onPress={handleUnloadTextModel}
                          disabled={loadingState.isLoading}
                        >
                          <Icon name="power" size={16} color={colors.error} />
                          <Text style={styles.unloadButtonText}>Unload current model</Text>
                        </TouchableOpacity>
                      )}
                      {downloadedModels.map((model) => {
                        // Estimate runtime memory (file size * 1.5 for KV cache/activations)
                        // Include mmproj file size for vision models
                        const totalSize = model.fileSize + (model.mmProjFileSize || 0);
                        const estimatedMemoryGB = (totalSize * 1.5) / (1024 * 1024 * 1024);
                        const memoryFits = memoryInfo
                          ? estimatedMemoryGB < memoryInfo.memoryAvailable / (1024 * 1024 * 1024) - 1.5
                          : true;
                        return (
                          <TouchableOpacity
                            key={model.id}
                            testID="model-item"
                            style={[
                              styles.pickerItem,
                              activeModelId === model.id && styles.pickerItemActive,
                              !memoryFits && styles.pickerItemWarning,
                            ]}
                            onPress={() => handleSelectTextModel(model)}
                            disabled={loadingState.isLoading}
                          >
                            <View style={styles.pickerItemInfo}>
                              <Text style={styles.pickerItemName}>
                                {model.name}{model.isVisionModel ? ' 👁' : ''}
                              </Text>
                              <Text style={styles.pickerItemMeta}>
                                {model.quantization} · {hardwareService.formatModelSize(model)}
                                {model.isVisionModel && ' (Vision)'}
                              </Text>
                              <Text style={[styles.pickerItemMemory, !memoryFits && styles.pickerItemMemoryWarning]}>
                                ~{estimatedMemoryGB.toFixed(1)} GB RAM {!memoryFits && '(may not fit)'}
                              </Text>
                            </View>
                            {activeModelId === model.id && (
                              <Icon name="check" size={18} color={colors.text} />
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  )}
                </>
              )}

              {pickerType === 'image' && (
                <>
                  {downloadedImageModels.length === 0 ? (
                    <View style={styles.emptyPicker}>
                      <Text style={styles.emptyPickerText}>No image models downloaded</Text>
                      <Button
                        title="Browse Models"
                        variant="outline"
                        size="small"
                        onPress={() => {
                          setPickerType(null);
                          navigation.navigate('ModelsTab');
                        }}
                      />
                    </View>
                  ) : (
                    <>
                      {activeImageModelId && (
                        <TouchableOpacity
                          style={styles.unloadButton}
                          onPress={handleUnloadImageModel}
                          disabled={loadingState.isLoading}
                        >
                          <Icon name="power" size={16} color={colors.error} />
                          <Text style={styles.unloadButtonText}>Unload current model</Text>
                        </TouchableOpacity>
                      )}
                      {downloadedImageModels.map((model) => {
                        // Estimate runtime memory (file size * 1.8 for ONNX runtime)
                        const estimatedMemoryGB = (model.size * 1.8) / (1024 * 1024 * 1024);
                        const memoryFits = memoryInfo
                          ? estimatedMemoryGB < memoryInfo.memoryAvailable / (1024 * 1024 * 1024) - 1.5
                          : true;
                        return (
                          <TouchableOpacity
                            key={model.id}
                            testID="model-item"
                            style={[
                              styles.pickerItem,
                              activeImageModelId === model.id && styles.pickerItemActive,
                              !memoryFits && styles.pickerItemWarning,
                            ]}
                            onPress={() => handleSelectImageModel(model)}
                            disabled={loadingState.isLoading}
                          >
                            <View style={styles.pickerItemInfo}>
                              <Text style={styles.pickerItemName}>{model.name}</Text>
                              <Text style={styles.pickerItemMeta}>
                                {model.style || 'Image'} · {hardwareService.formatBytes(model.size)}
                              </Text>
                              <Text style={[styles.pickerItemMemory, !memoryFits && styles.pickerItemMemoryWarning]}>
                                ~{estimatedMemoryGB.toFixed(1)} GB RAM {!memoryFits && '(may not fit)'}
                              </Text>
                            </View>
                            {activeImageModelId === model.id && (
                              <Icon name="check" size={18} color={colors.text} />
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.browseMoreButton}
              onPress={() => {
                setPickerType(null);
                navigation.navigate('ModelsTab');
              }}
            >
              <Text style={styles.browseMoreText}>Browse more models</Text>
              <Icon name="arrow-right" size={16} color={colors.textMuted} />
            </TouchableOpacity>
      </AppSheet>

      {/* Full-screen loading overlay - blocks all touches during model loading */}
      <Modal
        visible={loadingState.isLoading}
        transparent
        animationType="fade"
        statusBarTranslucent
      >
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingTitle}>
              {loadingState.type === 'text' ? 'Loading Text Model' : 'Loading Image Model'}
            </Text>
            <Text style={styles.loadingModelName} numberOfLines={2}>
              {loadingState.modelName || 'Please wait...'}
            </Text>
            <Text style={styles.loadingHint}>
              This may take a moment for larger models.{'\n'}
              The app will be unresponsive during loading.
            </Text>
          </View>
        </View>
      </Modal>

      {/* Custom Alert Modal */}
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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
  },
  modelsRow: {
    flexDirection: 'row' as const,
    gap: 12,
    marginBottom: 16,
  },
  modelCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    ...shadows.small,
  },
  modelCardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 8,
  },
  modelCardLabel: {
    ...TYPOGRAPHY.labelSmall,
    flex: 1,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
  },
  modelCardName: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
  },
  modelCardMeta: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: 3,
  },
  modelCardEmpty: {
    ...TYPOGRAPHY.h3,
    color: colors.textMuted,
  },
  modelCardLoading: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.primary,
    marginTop: 2,
  },
  // Memory indicator styles
  memoryIndicator: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    ...shadows.small,
  },
  memoryHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 8,
  },
  memoryTitle: {
    ...TYPOGRAPHY.meta,
    flex: 1,
    color: colors.textMuted,
  },
  refreshButton: {
    padding: 4,
  },
  memoryModelRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 4,
  },
  memoryModelName: {
    ...TYPOGRAPHY.bodySmall,
    flex: 1,
    color: colors.text,
  },
  memoryModelSize: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
  },
  memoryTotalRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 8,
    paddingTop: 8,
  },
  memoryTotalLabel: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
  },
  memoryTotalValue: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
  },
  memoryWarningText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: 6,
  },
  ejectAllButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 10,
    marginBottom: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  ejectAllText: {
    fontSize: 14,
    color: colors.error,
    fontWeight: '500' as const,
  },
  newChatButton: {
    marginBottom: 24,
  },
  galleryCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    gap: 12,
    ...shadows.small,
  },
  galleryCardInfo: {
    flex: 1,
  },
  galleryCardTitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '600' as const,
    color: colors.text,
  },
  galleryCardMeta: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  setupCard: {
    alignItems: 'center' as const,
    padding: 20,
    marginBottom: 24,
    gap: 12,
  },
  setupText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
    textAlign: 'center' as const,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 12,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
  },
  seeAll: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  conversationItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    ...shadows.small,
  },
  conversationInfo: {
    flex: 1,
  },
  conversationTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
  },
  conversationMeta: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: 3,
  },
  deleteAction: {
    backgroundColor: colors.error,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    width: 50,
    borderRadius: 10,
    marginBottom: 6,
    marginLeft: 8,
  },
  statsRow: {
    flexDirection: 'row' as const,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    ...shadows.small,
  },
  statItem: {
    flex: 1,
    alignItems: 'center' as const,
  },
  statValue: {
    ...TYPOGRAPHY.display,
    color: colors.text,
  },
  statLabel: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
    marginTop: SPACING.xs,
    textTransform: 'uppercase' as const,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end' as const,
  },
  modalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%' as const,
  },
  modalHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
  },
  modalScroll: {
    padding: 16,
  },
  pickerItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  pickerItemActive: {
    backgroundColor: colors.surfaceLight,
  },
  pickerItemInfo: {
    flex: 1,
  },
  pickerItemName: {
    ...TYPOGRAPHY.body,
    fontSize: 15,
    fontWeight: '500' as const,
    color: colors.text,
  },
  pickerItemMeta: {
    ...TYPOGRAPHY.h3,
    color: colors.textMuted,
    marginTop: 2,
  },
  pickerItemMemory: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: 2,
  },
  pickerItemMemoryWarning: {
    color: colors.warning,
  },
  pickerItemWarning: {
    borderWidth: 1,
    borderColor: colors.warning,
  },
  unloadButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: 12,
    marginBottom: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  unloadButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.error,
  },
  emptyPicker: {
    alignItems: 'center' as const,
    padding: 24,
    gap: 12,
  },
  emptyPickerText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
  },
  browseMoreButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  browseMoreText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
  },
  // Loading overlay styles
  loadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  loadingCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: SPACING.xxl,
    alignItems: 'center' as const,
    marginHorizontal: 40,
    maxWidth: 300,
    ...shadows.large,
  },
  loadingTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    marginTop: SPACING.xl,
  },
  loadingModelName: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
    marginTop: SPACING.sm,
    textAlign: 'center' as const,
  },
  loadingHint: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: SPACING.lg,
    textAlign: 'center' as const,
    lineHeight: 18,
  },
});
