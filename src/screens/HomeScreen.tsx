import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, ModelCard } from '../components';
import { COLORS } from '../constants';
import { useAppStore, useChatStore } from '../stores';
import { modelManager, llmService, hardwareService } from '../services';
import { DownloadedModel, Conversation } from '../types';
import { RootStackParamList, MainTabParamList } from '../navigation/types';
import { CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

type HomeScreenNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type HomeScreenProps = {
  navigation: HomeScreenNavigationProp;
};

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const [isLoadingModel, setIsLoadingModel] = useState(false);

  const {
    downloadedModels,
    setDownloadedModels,
    activeModelId,
    setActiveModelId,
    deviceInfo,
    setDeviceInfo,
  } = useAppStore();

  const { conversations, createConversation, setActiveConversation, deleteConversation } = useChatStore();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    // Load device info if not already loaded
    if (!deviceInfo) {
      const info = await hardwareService.getDeviceInfo();
      setDeviceInfo(info);
    }

    // Load downloaded models
    const models = await modelManager.getDownloadedModels();
    setDownloadedModels(models);
  };

  const handleSelectModel = async (model: DownloadedModel) => {
    if (activeModelId === model.id) {
      // Already selected, start chat
      startNewChat(model.id);
      return;
    }

    setIsLoadingModel(true);
    try {
      await llmService.loadModel(model.filePath);
      setActiveModelId(model.id);
      Alert.alert('Model Loaded', `${model.name} is ready to use!`);
    } catch (error) {
      Alert.alert('Error', `Failed to load model: ${(error as Error).message}`);
    } finally {
      setIsLoadingModel(false);
    }
  };

  const handleDeleteModel = async (model: DownloadedModel) => {
    Alert.alert(
      'Delete Model',
      `Are you sure you want to delete ${model.name}? This will free up ${hardwareService.formatBytes(model.fileSize)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (activeModelId === model.id) {
                await llmService.unloadModel();
                setActiveModelId(null);
              }
              await modelManager.deleteModel(model.id);
              const models = await modelManager.getDownloadedModels();
              setDownloadedModels(models);
            } catch (error) {
              Alert.alert('Error', 'Failed to delete model.');
            }
          },
        },
      ]
    );
  };

  const startNewChat = (modelId: string) => {
    const conversationId = createConversation(modelId);
    setActiveConversation(conversationId);
    navigation.navigate('Chat');
  };

  const continueChat = (conversationId: string) => {
    setActiveConversation(conversationId);
    navigation.navigate('Chat');
  };

  const handleDeleteConversation = (conversation: Conversation) => {
    Alert.alert(
      'Delete Conversation',
      `Are you sure you want to delete "${conversation.title}"?`,
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
      <Text style={styles.deleteActionText}>Delete</Text>
    </TouchableOpacity>
  );

  const activeModel = downloadedModels.find((m) => m.id === activeModelId);
  const recentConversations = conversations.slice(0, 5);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Local LLM</Text>
          <Text style={styles.subtitle}>Private AI on your device</Text>
        </View>

        {/* Active Model Section */}
        <Card style={styles.activeModelCard}>
          <Text style={styles.sectionTitle}>Active Model</Text>
          {activeModel ? (
            <View>
              <View style={styles.activeModelInfo}>
                <View style={styles.activeModelTextContainer}>
                  <Text style={styles.activeModelName} numberOfLines={1}>{activeModel.name}</Text>
                  <Text style={styles.activeModelDetails}>
                    {activeModel.quantization} -{' '}
                    {hardwareService.formatBytes(activeModel.fileSize)}
                  </Text>
                </View>
                <Button
                  title="Chat"
                  size="small"
                  onPress={() => startNewChat(activeModel.id)}
                  loading={isLoadingModel}
                  style={styles.newChatButton}
                />
              </View>
            </View>
          ) : (
            <View style={styles.noModelContainer}>
              <Text style={styles.noModelText}>
                No model selected. Select a model below or download one.
              </Text>
              <Button
                title="Browse Models"
                variant="outline"
                size="small"
                onPress={() => navigation.navigate('Models')}
              />
            </View>
          )}
        </Card>

        {/* Recent Conversations */}
        {recentConversations.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Conversations</Text>
            <Text style={styles.sectionHint}>Swipe left to delete</Text>
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
                      {conv.messages.length} messages -{' '}
                      {formatDate(conv.updatedAt)}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>{'>'}</Text>
                </TouchableOpacity>
              </Swipeable>
            ))}
          </View>
        )}

        {/* Downloaded Models */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your Models</Text>
            <Button
              title="Browse More"
              variant="ghost"
              size="small"
              onPress={() => navigation.navigate('Models')}
            />
          </View>

          {downloadedModels.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No Models Downloaded</Text>
              <Text style={styles.emptyText}>
                Download a model to start chatting privately on your device.
              </Text>
              <Button
                title="Download a Model"
                onPress={() => navigation.navigate('Models')}
                style={styles.emptyButton}
              />
            </Card>
          ) : (
            downloadedModels.map((model) => (
              <ModelCard
                key={model.id}
                model={{
                  id: model.id,
                  name: model.name,
                  author: model.author,
                  credibility: model.credibility,
                }}
                downloadedModel={model}
                isDownloaded
                isActive={activeModelId === model.id}
                onSelect={() => handleSelectModel(model)}
                onDelete={() => handleDeleteModel(model)}
              />
            ))
          )}
        </View>

        {/* Privacy Card */}
        <Card style={styles.privacyCard}>
          <Text style={styles.privacyIcon}>🔒</Text>
          <Text style={styles.privacyTitle}>Your Privacy is Protected</Text>
          <Text style={styles.privacyText}>
            All conversations are processed entirely on your device. No data
            leaves your phone.
          </Text>
        </Card>
      </ScrollView>
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
  if (days < 7) return `${days} days ago`;
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
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 4,
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
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 12,
  },
  activeModelCard: {
    marginBottom: 24,
    backgroundColor: COLORS.primary + '20',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  activeModelInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  activeModelTextContainer: {
    flex: 1,
    minWidth: 0,
  },
  activeModelName: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  activeModelDetails: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  newChatButton: {
    flexShrink: 0,
    minWidth: 70,
  },
  noModelContainer: {
    alignItems: 'center',
    gap: 12,
  },
  noModelText: {
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  conversationInfo: {
    flex: 1,
  },
  conversationTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  conversationMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  chevron: {
    fontSize: 18,
    color: COLORS.textMuted,
  },
  emptyCard: {
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  emptyButton: {
    minWidth: 200,
  },
  privacyCard: {
    alignItems: 'center',
    backgroundColor: COLORS.secondary + '15',
    borderWidth: 1,
    borderColor: COLORS.secondary + '40',
  },
  privacyIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  privacyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.secondary,
    marginBottom: 4,
  },
  privacyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  deleteAction: {
    backgroundColor: COLORS.error,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: 12,
    marginBottom: 8,
    marginLeft: 8,
  },
  deleteActionText: {
    color: COLORS.text,
    fontWeight: '600',
    fontSize: 14,
  },
});
