import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  ActivityIndicator,
  AppState,
  AppStateStatus,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { Button, Card } from '../components';
import { COLORS } from '../constants';
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

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const [pickerType, setPickerType] = useState<ModelPickerType>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [resourceUsage, setResourceUsage] = useState<ResourceUsage | null>(null);
  const [isEjecting, setIsEjecting] = useState(false);
  const appState = useRef(AppState.currentState);

  const {
    downloadedModels,
    setDownloadedModels,
    activeModelId,
    setActiveModelId,
    downloadedImageModels,
    activeImageModelId,
    setActiveImageModelId,
    deviceInfo,
    setDeviceInfo,
    generatedImages,
  } = useAppStore();

  const { conversations, createConversation, setActiveConversation, deleteConversation } = useChatStore();

  const refreshResourceUsage = useCallback(async () => {
    try {
      const usage = await activeModelService.getResourceUsage();
      setResourceUsage(usage);
    } catch (error) {
      // Silently fail on resource fetch errors
    }
  }, []);

  useEffect(() => {
    loadData();
    refreshResourceUsage();

    // Refresh resources every 5 seconds when app is active
    const interval = setInterval(refreshResourceUsage, 5000);

    // Handle app state changes
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        refreshResourceUsage();
      }
      appState.current = nextState;
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [refreshResourceUsage]);

  const loadData = async () => {
    if (!deviceInfo) {
      const info = await hardwareService.getDeviceInfo();
      setDeviceInfo(info);
    }
    const models = await modelManager.getDownloadedModels();
    setDownloadedModels(models);
  };

  const handleSelectTextModel = async (model: DownloadedModel) => {
    if (activeModelId === model.id) return;

    setIsLoading(true);
    try {
      // Use activeModelService singleton - prevents duplicate loads
      await activeModelService.loadTextModel(model.id);
    } catch (error) {
      Alert.alert('Error', `Failed to load model: ${(error as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnloadTextModel = async () => {
    setIsLoading(true);
    try {
      await activeModelService.unloadTextModel();
    } catch (error) {
      Alert.alert('Error', 'Failed to unload model');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectImageModel = async (model: ONNXImageModel) => {
    if (activeImageModelId === model.id) return;

    setIsLoading(true);
    try {
      // Use activeModelService singleton - prevents duplicate loads
      await activeModelService.loadImageModel(model.id);
    } catch (error) {
      Alert.alert('Error', `Failed to load model: ${(error as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnloadImageModel = async () => {
    setIsLoading(true);
    try {
      await activeModelService.unloadImageModel();
    } catch (error) {
      Alert.alert('Error', 'Failed to unload model');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEjectAll = async () => {
    const hasModels = activeModelId || activeImageModelId;
    if (!hasModels) return;

    Alert.alert(
      'Eject All Models',
      'Unload all active models to free up memory?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Eject All',
          style: 'destructive',
          onPress: async () => {
            setIsEjecting(true);
            try {
              const results = await activeModelService.unloadAllModels();
              await refreshResourceUsage();
              const count = (results.textUnloaded ? 1 : 0) + (results.imageUnloaded ? 1 : 0);
              if (count > 0) {
                Alert.alert('Done', `Unloaded ${count} model${count > 1 ? 's' : ''}`);
              }
            } catch (error) {
              Alert.alert('Error', 'Failed to unload models');
            } finally {
              setIsEjecting(false);
            }
          },
        },
      ]
    );
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
    Alert.alert(
      'Delete Conversation',
      `Delete "${conversation.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteConversation(conversation.id),
        },
      ]
    );
  };

  const renderRightActions = (conversation: Conversation) => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => handleDeleteConversation(conversation)}
    >
      <Icon name="trash-2" size={16} color={COLORS.text} />
    </TouchableOpacity>
  );

  const activeTextModel = downloadedModels.find((m) => m.id === activeModelId);
  const activeImageModel = downloadedImageModels.find((m) => m.id === activeImageModelId);
  const recentConversations = conversations.slice(0, 4);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Local LLM</Text>
        </View>

        {/* Resource Monitor - Only show when models are loaded */}
        {resourceUsage && (activeModelId || activeImageModelId) && (
          <TouchableOpacity
            style={styles.resourceCard}
            onPress={refreshResourceUsage}
            activeOpacity={0.7}
          >
            <View style={styles.resourceRow}>
              <View style={styles.resourceItem}>
                <View style={styles.resourceHeader}>
                  <Icon name="cpu" size={14} color={COLORS.textMuted} />
                  <Text style={styles.resourceLabel}>Model Memory (est.)</Text>
                  <Icon name="refresh-cw" size={12} color={COLORS.textMuted} style={styles.refreshIcon} />
                </View>
                {resourceUsage.estimatedModelMemory > 0 && (
                  <>
                    <View style={styles.resourceBarContainer}>
                      <View
                        style={[
                          styles.resourceBar,
                          {
                            width: `${Math.min((resourceUsage.estimatedModelMemory / resourceUsage.memoryTotal) * 100, 100)}%`,
                            backgroundColor: (resourceUsage.estimatedModelMemory / resourceUsage.memoryTotal) > 0.6 ? COLORS.warning : COLORS.primary,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.modelMemoryValue}>
                      ~{hardwareService.formatBytes(resourceUsage.estimatedModelMemory)} / {hardwareService.formatBytes(resourceUsage.memoryTotal)} RAM
                    </Text>
                  </>
                )}
              </View>
              <TouchableOpacity
                style={styles.ejectButton}
                onPress={handleEjectAll}
                disabled={isEjecting}
              >
                {isEjecting ? (
                  <ActivityIndicator size="small" color={COLORS.text} />
                ) : (
                  <>
                    <Icon name="power" size={14} color={COLORS.error} />
                    <Text style={styles.ejectButtonText}>Eject All</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}

        {/* Active Models Section */}
        <View style={styles.modelsRow}>
          {/* Text Model */}
          <TouchableOpacity
            style={styles.modelCard}
            onPress={() => setPickerType('text')}
          >
            <View style={styles.modelCardHeader}>
              <Icon name="message-square" size={16} color={COLORS.textMuted} />
              <Text style={styles.modelCardLabel}>Text</Text>
              <Icon name="chevron-down" size={14} color={COLORS.textMuted} />
            </View>
            {activeTextModel ? (
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
          </TouchableOpacity>

          {/* Image Model */}
          <TouchableOpacity
            style={styles.modelCard}
            onPress={() => setPickerType('image')}
          >
            <View style={styles.modelCardHeader}>
              <Icon name="image" size={16} color={COLORS.textMuted} />
              <Text style={styles.modelCardLabel}>Image</Text>
              <Icon name="chevron-down" size={14} color={COLORS.textMuted} />
            </View>
            {activeImageModel ? (
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
          </TouchableOpacity>
        </View>

        {/* New Chat Button */}
        {activeTextModel ? (
          <Button
            title="New Chat"
            onPress={startNewChat}
            style={styles.newChatButton}
          />
        ) : (
          <Card style={styles.setupCard}>
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
            />
          </Card>
        )}

        {/* Image Gallery */}
        <TouchableOpacity
          style={styles.galleryCard}
          onPress={() => (navigation as any).navigate('Gallery')}
          activeOpacity={0.7}
        >
          <Icon name="image" size={18} color={COLORS.primary} />
          <View style={styles.galleryCardInfo}>
            <Text style={styles.galleryCardTitle}>Image Gallery</Text>
            <Text style={styles.galleryCardMeta}>
              {generatedImages.length} image{generatedImages.length !== 1 ? 's' : ''}
            </Text>
          </View>
          <Icon name="chevron-right" size={16} color={COLORS.textMuted} />
        </TouchableOpacity>

        {/* Recent Conversations */}
        {recentConversations.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent</Text>
              <TouchableOpacity onPress={() => navigation.navigate('ChatsTab')}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            </View>
            {recentConversations.map((conv) => (
              <Swipeable
                key={conv.id}
                renderRightActions={() => renderRightActions(conv)}
                overshootRight={false}
              >
                <TouchableOpacity
                  style={styles.conversationItem}
                  onPress={() => continueChat(conv.id)}
                >
                  <View style={styles.conversationInfo}>
                    <Text style={styles.conversationTitle} numberOfLines={1}>
                      {conv.title}
                    </Text>
                    <Text style={styles.conversationMeta}>
                      {conv.messages.length} messages · {formatDate(conv.updatedAt)}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={16} color={COLORS.textMuted} />
                </TouchableOpacity>
              </Swipeable>
            ))}
          </View>
        )}

        {/* Model Stats */}
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
      </ScrollView>

      {/* Model Picker Modal */}
      <Modal
        visible={pickerType !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerType(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setPickerType(null)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {pickerType === 'text' ? 'Text Models' : 'Image Models'}
              </Text>
              <TouchableOpacity onPress={() => setPickerType(null)}>
                <Icon name="x" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            {isLoading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="small" color={COLORS.text} />
                <Text style={styles.loadingText}>Loading model...</Text>
              </View>
            )}

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
                          disabled={isLoading}
                        >
                          <Icon name="power" size={16} color={COLORS.error} />
                          <Text style={styles.unloadButtonText}>Unload current model</Text>
                        </TouchableOpacity>
                      )}
                      {downloadedModels.map((model) => (
                        <TouchableOpacity
                          key={model.id}
                          style={[
                            styles.pickerItem,
                            activeModelId === model.id && styles.pickerItemActive,
                          ]}
                          onPress={() => handleSelectTextModel(model)}
                          disabled={isLoading}
                        >
                          <View style={styles.pickerItemInfo}>
                            <Text style={styles.pickerItemName}>{model.name}</Text>
                            <Text style={styles.pickerItemMeta}>
                              {model.quantization} · {hardwareService.formatBytes(model.fileSize)}
                            </Text>
                          </View>
                          {activeModelId === model.id && (
                            <Icon name="check" size={18} color={COLORS.text} />
                          )}
                        </TouchableOpacity>
                      ))}
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
                          disabled={isLoading}
                        >
                          <Icon name="power" size={16} color={COLORS.error} />
                          <Text style={styles.unloadButtonText}>Unload current model</Text>
                        </TouchableOpacity>
                      )}
                      {downloadedImageModels.map((model) => (
                        <TouchableOpacity
                          key={model.id}
                          style={[
                            styles.pickerItem,
                            activeImageModelId === model.id && styles.pickerItemActive,
                          ]}
                          onPress={() => handleSelectImageModel(model)}
                          disabled={isLoading}
                        >
                          <View style={styles.pickerItemInfo}>
                            <Text style={styles.pickerItemName}>{model.name}</Text>
                            <Text style={styles.pickerItemMeta}>
                              {model.style || 'Image'} · {hardwareService.formatBytes(model.size)}
                            </Text>
                          </View>
                          {activeImageModelId === model.id && (
                            <Icon name="check" size={18} color={COLORS.text} />
                          )}
                        </TouchableOpacity>
                      ))}
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
              <Icon name="arrow-right" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
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
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  resourceCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  resourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resourceItem: {
    flex: 1,
  },
  resourceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  resourceLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  refreshIcon: {
    marginLeft: 'auto',
  },
  resourceBarContainer: {
    height: 6,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  resourceBar: {
    height: '100%',
    borderRadius: 3,
  },
  modelMemoryValue: {
    fontSize: 12,
    color: COLORS.text,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  ejectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  ejectButtonText: {
    fontSize: 12,
    color: COLORS.error,
    fontWeight: '500',
  },
  modelsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  modelCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
  },
  modelCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  modelCardLabel: {
    flex: 1,
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  modelCardName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  modelCardMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  modelCardEmpty: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  newChatButton: {
    marginBottom: 24,
  },
  galleryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    gap: 12,
  },
  galleryCardInfo: {
    flex: 1,
  },
  galleryCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  galleryCardMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  setupCard: {
    alignItems: 'center',
    padding: 20,
    marginBottom: 24,
    gap: 12,
  },
  setupText: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  seeAll: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
  },
  conversationInfo: {
    flex: 1,
  },
  conversationTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  conversationMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  deleteAction: {
    backgroundColor: COLORS.error,
    justifyContent: 'center',
    alignItems: 'center',
    width: 50,
    borderRadius: 10,
    marginBottom: 6,
    marginLeft: 8,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: COLORS.border,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalScroll: {
    padding: 16,
  },
  loadingOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: COLORS.surface,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  pickerItemActive: {
    backgroundColor: COLORS.surfaceLight,
  },
  pickerItemInfo: {
    flex: 1,
  },
  pickerItemName: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
  },
  pickerItemMeta: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  unloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    marginBottom: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
  unloadButtonText: {
    fontSize: 14,
    color: COLORS.error,
  },
  emptyPicker: {
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  emptyPickerText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  browseMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  browseMoreText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
});
