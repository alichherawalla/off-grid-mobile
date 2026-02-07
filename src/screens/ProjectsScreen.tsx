import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { COLORS, TYPOGRAPHY, SPACING, FONTS } from '../constants';
import { useProjectStore, useChatStore } from '../stores';
import { Project } from '../types';
import { ProjectsStackParamList } from '../navigation/types';

type NavigationProp = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectsList'>;

export const ProjectsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
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

  const renderProject = ({ item }: { item: Project }) => {
    const chatCount = getChatCount(item.id);

    return (
      <TouchableOpacity
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
            <Icon name="message-circle" size={10} color={COLORS.textMuted} />
            <Text style={styles.projectMetaText}>
              {chatCount} {chatCount === 1 ? 'chat' : 'chats'}
            </Text>
          </View>
        </View>
        <Icon name="chevron-right" size={14} color={COLORS.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Projects</Text>
        <TouchableOpacity style={styles.newButton} onPress={handleNewProject}>
          <Icon name="plus" size={16} color={COLORS.textSecondary} />
          <Text style={styles.newButtonText}>New</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.subtitle}>
        Projects group related chats with shared context and instructions.
      </Text>

      {projects.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Icon name="folder" size={20} color={COLORS.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No Projects Yet</Text>
          <Text style={styles.emptyText}>
            Create a project to organize your chats by topic, like "Spanish Learning" or "Code Review".
          </Text>
          <TouchableOpacity style={styles.emptyButton} onPress={handleNewProject}>
            <Icon name="plus" size={14} color={COLORS.textSecondary} />
            <Text style={styles.emptyButtonText}>Create Project</Text>
          </TouchableOpacity>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
  },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 6,
    gap: SPACING.xs,
  },
  newButtonText: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
    fontWeight: '400',
  },
  subtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  list: {
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    borderRadius: 6,
    marginBottom: SPACING.sm,
  },
  projectIcon: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  projectIconText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    fontWeight: '400',
  },
  projectContent: {
    flex: 1,
  },
  projectName: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
    fontWeight: '400',
    marginBottom: SPACING.xs,
  },
  projectDescription: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  projectMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  projectMetaText: {
    ...TYPOGRAPHY.label,
    color: COLORS.textMuted,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xxl,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  emptyTitle: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
    fontWeight: '400',
    marginBottom: SPACING.sm,
  },
  emptyText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: SPACING.xl,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: 6,
    gap: SPACING.sm,
  },
  emptyButtonText: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
    fontWeight: '400',
  },
});
