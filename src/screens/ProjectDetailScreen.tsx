import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING, FONTS } from '../constants';
import { useChatStore, useProjectStore, useAppStore } from '../stores';
import { Conversation } from '../types';
import { ProjectsStackParamList } from '../navigation/types';

type NavigationProp = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectDetail'>;
type RouteProps = RouteProp<ProjectsStackParamList, 'ProjectDetail'>;

export const ProjectDetailScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { projectId } = route.params;
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const { getProject, deleteProject } = useProjectStore();
  const { conversations, deleteConversation, setActiveConversation, createConversation } = useChatStore();
  const { downloadedModels, activeModelId } = useAppStore();

  const project = getProject(projectId);
  const hasModels = downloadedModels.length > 0;

  // Get chats for this project
  const projectChats = conversations
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

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
      setAlertState(showAlert('No Model', 'Please download a model first from the Models tab.'));
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
    setAlertState(showAlert(
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
    ));
  };

  const handleDeleteChat = (conversation: Conversation) => {
    setAlertState(showAlert(
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
    ));
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
          <Icon name="message-circle" size={14} color={colors.textMuted} />
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
        <Icon name="chevron-right" size={14} color={colors.textMuted} />
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.projectIcon}>
            <Text style={styles.projectIconText}>
              {project.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
        </View>
        <TouchableOpacity onPress={handleEditProject} style={styles.editButton}>
          <Icon name="edit-2" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Project Info */}
      <View style={styles.projectInfo}>
        {project.description ? (
          <Text style={styles.projectDescription}>{project.description}</Text>
        ) : null}
        <View style={styles.projectStats}>
          <View style={styles.statItem}>
            <Icon name="message-circle" size={16} color={colors.textMuted} />
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
          <Icon name="plus" size={16} color={hasModels ? colors.primary : colors.textMuted} />
          <Text style={[styles.newChatText, !hasModels && styles.newChatTextDisabled]}>New Chat</Text>
        </TouchableOpacity>
      </View>

      {projectChats.length === 0 ? (
        <View style={styles.emptyChats}>
          <Icon name="message-circle" size={24} color={colors.textMuted} />
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
          <Icon name="trash-2" size={16} color={colors.error} />
          <Text style={styles.deleteButtonText}>Delete Project</Text>
        </TouchableOpacity>
      </View>
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
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
  backButton: {
    padding: SPACING.xs,
    marginRight: SPACING.md,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  projectIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.sm,
  },
  projectIconText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
    fontWeight: '400' as const,
  },
  headerTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    fontWeight: '400' as const,
    flex: 1,
  },
  editButton: {
    padding: SPACING.sm,
  },
  projectInfo: {
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  projectDescription: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: SPACING.md,
  },
  projectStats: {
    flexDirection: 'row' as const,
  },
  statItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
  },
  statText: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
    fontWeight: '400' as const,
  },
  newChatButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 6,
    gap: SPACING.xs,
  },
  newChatButtonDisabled: {
    borderColor: colors.border,
    opacity: 0.5,
  },
  newChatText: {
    ...TYPOGRAPHY.body,
    fontWeight: '400' as const,
    color: colors.primary,
  },
  newChatTextDisabled: {
    color: colors.textMuted,
  },
  chatList: {
    paddingHorizontal: SPACING.lg,
  },
  chatItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: SPACING.md,
    borderRadius: 6,
    marginBottom: SPACING.sm,
    ...shadows.small,
  },
  chatIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.md,
  },
  chatContent: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: SPACING.xs,
  },
  chatTitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '400' as const,
    flex: 1,
    marginRight: SPACING.sm,
  },
  chatDate: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
  },
  chatPreview: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  emptyChats: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: SPACING.xxl,
  },
  emptyChatsText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: SPACING.md,
    marginBottom: SPACING.lg,
  },
  startChatButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: 6,
  },
  startChatText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
    fontWeight: '400' as const,
  },
  footer: {
    padding: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  deleteButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  deleteButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.error,
    fontWeight: '400' as const,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  errorText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    marginBottom: SPACING.md,
  },
  errorLink: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
    fontWeight: '400' as const,
  },
});
