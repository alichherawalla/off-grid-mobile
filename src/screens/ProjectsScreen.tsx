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
import { COLORS } from '../constants';
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
    return conversations.filter((c) => c.personaId === projectId).length;
  };

  // Get color for project
  const getProjectColor = (project: Project) => {
    if (project.icon && project.icon.startsWith('#')) {
      return project.icon;
    }
    return COLORS.primary;
  };

  const handleProjectPress = (project: Project) => {
    navigation.navigate('ProjectDetail', { projectId: project.id });
  };

  const handleNewProject = () => {
    navigation.navigate('ProjectEdit', {});
  };

  const renderProject = ({ item }: { item: Project }) => {
    const color = getProjectColor(item);
    const chatCount = getChatCount(item.id);

    return (
      <TouchableOpacity
        style={styles.projectItem}
        onPress={() => handleProjectPress(item)}
      >
        <View style={[styles.projectIcon, { backgroundColor: color + '30' }]}>
          <Text style={[styles.projectIconText, { color }]}>
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
            <Icon name="message-circle" size={12} color={COLORS.textMuted} />
            <Text style={styles.projectMetaText}>
              {chatCount} {chatCount === 1 ? 'chat' : 'chats'}
            </Text>
          </View>
        </View>
        <Icon name="chevron-right" size={20} color={COLORS.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Projects</Text>
        <TouchableOpacity style={styles.newButton} onPress={handleNewProject}>
          <Icon name="plus" size={20} color={COLORS.text} />
          <Text style={styles.newButtonText}>New</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.subtitle}>
        Projects group related chats with shared context and instructions.
      </Text>

      {projects.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Icon name="folder" size={32} color={COLORS.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No Projects Yet</Text>
          <Text style={styles.emptyText}>
            Create a project to organize your chats by topic, like "Spanish Learning" or "Code Review".
          </Text>
          <TouchableOpacity style={styles.emptyButton} onPress={handleNewProject}>
            <Icon name="plus" size={18} color={COLORS.text} />
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
  newButtonText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  list: {
    padding: 16,
    paddingTop: 0,
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  projectIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  projectIconText: {
    fontSize: 20,
    fontWeight: '600',
  },
  projectContent: {
    flex: 1,
  },
  projectName: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  projectDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  projectMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  projectMetaText: {
    fontSize: 12,
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
