import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { COLORS } from '../constants';
import { useChatStore, useProjectStore, useAppStore } from '../stores';
import { Conversation } from '../types';
import { ChatsStackParamList } from '../navigation/types';

type NavigationProp = NativeStackNavigationProp<ChatsStackParamList, 'ChatsList'>;

export const ChatsListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { conversations, deleteConversation, setActiveConversation } = useChatStore();
  const { getProject } = useProjectStore();
  const { downloadedModels } = useAppStore();

  const hasModels = downloadedModels.length > 0;

  const handleChatPress = (conversation: Conversation) => {
    setActiveConversation(conversation.id);
    navigation.navigate('Chat', { conversationId: conversation.id });
  };

  const handleNewChat = () => {
    if (!hasModels) {
      Alert.alert('No Model', 'Please download a model first from the Models tab.');
      return;
    }
    navigation.navigate('Chat', {});
  };

  const handleDeleteChat = (conversation: Conversation) => {
    Alert.alert(
      'Delete Chat',
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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const renderChat = ({ item }: { item: Conversation }) => {
    const project = item.personaId ? getProject(item.personaId) : null;
    const lastMessage = item.messages[item.messages.length - 1];

    return (
      <TouchableOpacity
        style={styles.chatItem}
        onPress={() => handleChatPress(item)}
        onLongPress={() => handleDeleteChat(item)}
      >
        <View style={styles.chatIcon}>
          <Icon name="message-circle" size={20} color={COLORS.primary} />
        </View>
        <View style={styles.chatContent}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.chatDate}>{formatDate(item.updatedAt)}</Text>
          </View>
          {lastMessage && (
            <Text style={styles.chatPreview} numberOfLines={1}>
              {lastMessage.role === 'user' ? 'You: ' : ''}{lastMessage.content}
            </Text>
          )}
          {project && (
            <View style={styles.projectBadge}>
              <Text style={styles.projectBadgeText}>{project.name}</Text>
            </View>
          )}
        </View>
        <Icon name="chevron-right" size={20} color={COLORS.textMuted} />
      </TouchableOpacity>
    );
  };

  // Sort conversations by updatedAt (most recent first)
  const sortedConversations = [...conversations].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Chats</Text>
        <TouchableOpacity
          style={[styles.newButton, !hasModels && styles.newButtonDisabled]}
          onPress={handleNewChat}
        >
          <Icon name="plus" size={20} color={hasModels ? COLORS.text : COLORS.textMuted} />
          <Text style={[styles.newButtonText, !hasModels && styles.newButtonTextDisabled]}>
            New
          </Text>
        </TouchableOpacity>
      </View>

      {sortedConversations.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Icon name="message-circle" size={32} color={COLORS.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No Chats Yet</Text>
          <Text style={styles.emptyText}>
            {hasModels
              ? 'Start a new conversation to begin chatting with your local AI.'
              : 'Download a model from the Models tab to start chatting.'}
          </Text>
          {hasModels && (
            <TouchableOpacity style={styles.emptyButton} onPress={handleNewChat}>
              <Icon name="plus" size={18} color={COLORS.text} />
              <Text style={styles.emptyButtonText}>New Chat</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={sortedConversations}
          renderItem={renderChat}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  newButtonDisabled: {
    backgroundColor: COLORS.surface,
  },
  newButtonText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  newButtonTextDisabled: {
    color: COLORS.textMuted,
  },
  list: {
    padding: 16,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  chatIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  chatContent: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
    marginRight: 8,
  },
  chatDate: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  chatPreview: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  projectBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 6,
  },
  projectBadgeText: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  emptyButtonText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
