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
import Icon from 'react-native-vector-icons/Feather';
import { Button, Card } from '../components';
import { COLORS } from '../constants';
import { useAppStore, useChatStore } from '../stores';
import { modelManager, hardwareService } from '../services';
import { Conversation } from '../types';
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

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const {
    downloadedModels,
    setDownloadedModels,
    activeModelId,
    downloadedImageModels,
    activeImageModelId,
    deviceInfo,
    setDeviceInfo,
  } = useAppStore();

  const { conversations, createConversation, setActiveConversation, deleteConversation } = useChatStore();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    if (!deviceInfo) {
      const info = await hardwareService.getDeviceInfo();
      setDeviceInfo(info);
    }
    const models = await modelManager.getDownloadedModels();
    setDownloadedModels(models);
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

        {/* Active Models Section */}
        <View style={styles.modelsRow}>
          {/* Text Model */}
          <TouchableOpacity
            style={styles.modelCard}
            onPress={() => navigation.navigate('ModelsTab')}
          >
            <View style={styles.modelCardHeader}>
              <Icon name="message-square" size={16} color={COLORS.textMuted} />
              <Text style={styles.modelCardLabel}>Text</Text>
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
              <Text style={styles.modelCardEmpty}>No model</Text>
            )}
          </TouchableOpacity>

          {/* Image Model */}
          <TouchableOpacity
            style={styles.modelCard}
            onPress={() => navigation.navigate('ModelsTab')}
          >
            <View style={styles.modelCardHeader}>
              <Icon name="image" size={16} color={COLORS.textMuted} />
              <Text style={styles.modelCardLabel}>Image</Text>
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
              <Text style={styles.modelCardEmpty}>No model</Text>
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
              Download a text model to start chatting
            </Text>
            <Button
              title="Browse Models"
              variant="outline"
              size="small"
              onPress={() => navigation.navigate('ModelsTab')}
            />
          </Card>
        )}

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
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
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
});
