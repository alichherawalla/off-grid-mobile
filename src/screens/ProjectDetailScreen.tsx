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
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { COLORS } from '../constants';
import { useChatStore, useProjectStore, useAppStore } from '../stores';
import { Conversation } from '../types';
import { ProjectsStackParamList } from '../navigation/types';

type NavigationProp = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectDetail'>;
type RouteProps = RouteProp<ProjectsStackParamList, 'ProjectDetail'>;

export const ProjectDetailScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { projectId } = route.params;

  const { getProject, deleteProject } = useProjectStore();
  const { conversations, deleteConversation, setActiveConversation, createConversation } = useChatStore();
  const { downloadedModels, activeModelId } = useAppStore();

  const project = getProject(projectId);
  const hasModels = downloadedModels.length > 0;

  // Get chats for this project
  const projectChats = conversations
    .filter((c) => c.personaId === projectId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const getProjectColor = () => {
    if (project?.icon && project.icon.startsWith('#')) {
      return project.icon;
    }
    return COLORS.primary;
  };

  const handleChatPress = (conversation: Conversation) => {
    setActiveConversation(conversation.id);
    // Navigate to chat in the Chats tab stack
    // For now, we'll use a workaround by navigating to the parent navigator
    navigation.getParent()?.navigate('ChatsTab', {
      screen: 'Chat',
      params: { conversationId: conversation.id },
    });
  };

  const handleNewChat = () => {
    if (!hasModels) {
      Alert.alert('No Model', 'Please download a model first from the Models tab.');
      return;
    }
    // Create a new conversation with this project
    const modelId = activeModelId || downloadedModels[0]?.id;
    if (modelId) {
      const newConversationId = createConversation(modelId, undefined, projectId);
      navigation.getParent()?.navigate('ChatsTab', {
        screen: 'Chat',
        params: { conversationId: newConversationId, projectId },
      });
    }
  };

  const handleEditProject = () => {
    navigation.navigate('ProjectEdit', { projectId });
  };

  const handleDeleteProject = () => {
    Alert.alert(
      'Delete Project',
      `Delete "${project?.name}"? This will not delete the chats associated with this project.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteProject(projectId);
            navigation.goBack();
          },
        },
      ]
    );
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
    const lastMessage = item.messages[item.messages.length - 1];

    return (
      <TouchableOpacity
        style={styles.chatItem}
        onPress={() => handleChatPress(item)}
        onLongPress={() => handleDeleteChat(item)}
      >
        <View style={styles.chatIcon}>
          <Icon name="message-circle" size={18} color={COLORS.primary} />
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
        </View>
        <Icon name="chevron-right" size={18} color={COLORS.textMuted} />
      </TouchableOpacity>
    );
  };

  if (!project) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Project not found</Text>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.errorLink}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const color = getProjectColor();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={[styles.projectIcon, { backgroundColor: color + '30' }]}>
            <Text style={[styles.projectIconText, { color }]}>
              {project.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
        </View>
        <TouchableOpacity onPress={handleEditProject} style={styles.editButton}>
          <Icon name="edit-2" size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Project Info */}
      <View style={styles.projectInfo}>
        {project.description ? (
          <Text style={styles.projectDescription}>{project.description}</Text>
        ) : null}
        <View style={styles.projectStats}>
          <View style={styles.statItem}>
            <Icon name="message-circle" size={16} color={COLORS.textMuted} />
            <Text style={styles.statText}>{projectChats.length} chats</Text>
          </View>
        </View>
      </View>

      {/* Chats Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Chats</Text>
        <TouchableOpacity
          style={[styles.newChatButton, !hasModels && styles.newChatButtonDisabled]}
          onPress={handleNewChat}
        >
          <Icon name="plus" size={16} color={hasModels ? COLORS.text : COLORS.textMuted} />
          <Text style={[styles.newChatText, !hasModels && styles.newChatTextDisabled]}>New Chat</Text>
        </TouchableOpacity>
      </View>

      {projectChats.length === 0 ? (
        <View style={styles.emptyChats}>
          <Icon name="message-circle" size={24} color={COLORS.textMuted} />
          <Text style={styles.emptyChatsText}>No chats in this project yet</Text>
          {hasModels && (
            <TouchableOpacity style={styles.startChatButton} onPress={handleNewChat}>
              <Text style={styles.startChatText}>Start a Chat</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={projectChats}
          renderItem={renderChat}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.chatList}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Delete Project Button */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteProject}>
          <Icon name="trash-2" size={18} color={COLORS.error} />
          <Text style={styles.deleteButtonText}>Delete Project</Text>
        </TouchableOpacity>
      </View>
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
  backButton: {
    padding: 4,
    marginRight: 12,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  projectIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  projectIconText: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
  },
  editButton: {
    padding: 8,
  },
  projectInfo: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  projectDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  projectStats: {
    flexDirection: 'row',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  newChatButtonDisabled: {
    backgroundColor: COLORS.surface,
  },
  newChatText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  newChatTextDisabled: {
    color: COLORS.textMuted,
  },
  chatList: {
    paddingHorizontal: 16,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  chatIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  chatContent: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  chatTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
    flex: 1,
    marginRight: 8,
  },
  chatDate: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  chatPreview: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  emptyChats: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyChatsText: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginTop: 12,
    marginBottom: 16,
  },
  startChatButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  startChatText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    gap: 8,
  },
  deleteButtonText: {
    color: COLORS.error,
    fontSize: 15,
    fontWeight: '500',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  errorLink: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '500',
  },
});
