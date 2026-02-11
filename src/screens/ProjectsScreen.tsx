import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING, FONTS } from '../constants';
import { useProjectStore, useChatStore } from '../stores';
import { Project } from '../types';
import { ProjectsStackParamList } from '../navigation/types';

type NavigationProp = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectsList'>;

export const ProjectsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { projects } = useProjectStore();
  const { conversations } = useChatStore();

  // Get chat count for a project
  const getChatCount = (projectId: string) => {
    return conversations.filter((c) => c.projectId === projectId).length;
  };

  const handleProjectPress = (project: Project) => {
    navigation.navigate('ProjectDetail', { projectId: project.id });
  };

  const handleNewProject = () => {
    navigation.navigate('ProjectEdit', {});
  };

  const renderProject = ({ item, index }: { item: Project; index: number }) => {
    const chatCount = getChatCount(item.id);

    return (
      <AnimatedListItem
        index={index}
        trigger={focusTrigger}
        style={styles.projectItem}
        onPress={() => handleProjectPress(item)}
      >
        <View style={styles.projectIcon}>
          <Text style={styles.projectIconText}>
            {item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.projectContent}>
          <Text style={styles.projectName}>{item.name}</Text>
          {item.description ? (
            <Text style={styles.projectDescription} numberOfLines={1}>
              {item.description}
            </Text>
          ) : null}
          <View style={styles.projectMeta}>
            <Icon name="message-circle" size={10} color={colors.textMuted} />
            <Text style={styles.projectMetaText}>
              {chatCount} {chatCount === 1 ? 'chat' : 'chats'}
            </Text>
          </View>
        </View>
        <Icon name="chevron-right" size={14} color={colors.textMuted} />
      </AnimatedListItem>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Projects</Text>
        <TouchableOpacity style={styles.newButton} onPress={handleNewProject}>
          <Icon name="plus" size={16} color={colors.primary} />
          <Text style={styles.newButtonText}>New</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.subtitle}>
        Projects group related chats with shared context and instructions.
      </Text>

      {projects.length === 0 ? (
        <View style={styles.emptyState}>
          <AnimatedEntry index={0} staggerMs={60} trigger={focusTrigger}>
            <View style={styles.emptyIcon}>
              <Icon name="folder" size={20} color={colors.textMuted} />
            </View>
          </AnimatedEntry>
          <AnimatedEntry index={1} staggerMs={60} trigger={focusTrigger}>
            <Text style={styles.emptyTitle}>No Projects Yet</Text>
          </AnimatedEntry>
          <AnimatedEntry index={2} staggerMs={60} trigger={focusTrigger}>
            <Text style={styles.emptyText}>
              Create a project to organize your chats by topic, like "Spanish Learning" or "Code Review".
            </Text>
          </AnimatedEntry>
          <AnimatedEntry index={3} staggerMs={60} trigger={focusTrigger}>
            <TouchableOpacity style={styles.emptyButton} onPress={handleNewProject}>
              <Icon name="plus" size={14} color={colors.primary} />
              <Text style={styles.emptyButtonText}>Create Project</Text>
            </TouchableOpacity>
          </AnimatedEntry>
        </View>
      ) : (
        <FlatList
          data={projects}
          renderItem={renderProject}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
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
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
  },
  newButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 6,
    gap: SPACING.xs,
  },
  newButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
    fontWeight: '400' as const,
  },
  subtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  list: {
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  projectItem: {
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
  projectIcon: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.md,
  },
  projectIconText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
    fontWeight: '400' as const,
  },
  projectContent: {
    flex: 1,
  },
  projectName: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    fontWeight: '400' as const,
    marginBottom: SPACING.xs,
  },
  projectDescription: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginBottom: SPACING.xs,
  },
  projectMeta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
  },
  projectMetaText: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.xxl,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: SPACING.lg,
  },
  emptyTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    fontWeight: '400' as const,
    marginBottom: SPACING.sm,
  },
  emptyText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 18,
    marginBottom: SPACING.xl,
  },
  emptyButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: 6,
    gap: SPACING.sm,
  },
  emptyButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
    fontWeight: '400' as const,
  },
});
