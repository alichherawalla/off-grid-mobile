import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { AppSheet } from './AppSheet';
import { COLORS, TYPOGRAPHY, SPACING } from '../constants';
import { Project } from '../types';

interface ProjectSelectorSheetProps {
  visible: boolean;
  onClose: () => void;
  projects: Project[];
  activeProject: Project | null;
  onSelectProject: (project: Project | null) => void;
}

export const ProjectSelectorSheet: React.FC<ProjectSelectorSheetProps> = ({
  visible,
  onClose,
  projects,
  activeProject,
  onSelectProject,
}) => {
  const handleSelect = (project: Project | null) => {
    onSelectProject(project);
    onClose();
  };

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['45%']}
      title="Select Project"
    >
      <ScrollView style={styles.projectList}>
        {/* Default option */}
        <TouchableOpacity
          style={[
            styles.projectOption,
            !activeProject && styles.projectOptionSelected,
          ]}
          onPress={() => handleSelect(null)}
        >
          <View style={styles.projectOptionIcon}>
            <Text style={styles.projectOptionIconText}>D</Text>
          </View>
          <View style={styles.projectOptionInfo}>
            <Text style={styles.projectOptionName}>Default</Text>
            <Text style={styles.projectOptionDesc} numberOfLines={1}>
              Use default system prompt from settings
            </Text>
          </View>
          {!activeProject && (
            <Text style={styles.projectCheckmark}>✓</Text>
          )}
        </TouchableOpacity>

        {projects.map((project) => (
          <TouchableOpacity
            key={project.id}
            style={[
              styles.projectOption,
              activeProject?.id === project.id && styles.projectOptionSelected,
            ]}
            onPress={() => handleSelect(project)}
          >
            <View style={styles.projectOptionIcon}>
              <Text style={styles.projectOptionIconText}>
                {project.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.projectOptionInfo}>
              <Text style={styles.projectOptionName}>{project.name}</Text>
              <Text style={styles.projectOptionDesc} numberOfLines={1}>
                {project.description}
              </Text>
            </View>
            {activeProject?.id === project.id && (
              <Text style={styles.projectCheckmark}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </AppSheet>
  );
};

const styles = StyleSheet.create({
  projectList: {
    padding: 16,
  },
  projectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: COLORS.surface,
  },
  projectOptionSelected: {
    backgroundColor: COLORS.primary + '20',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  projectOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  projectOptionIconText: {
    ...TYPOGRAPHY.h2,
    fontWeight: '600',
    color: COLORS.primary,
  },
  projectOptionInfo: {
    flex: 1,
  },
  projectOptionName: {
    ...TYPOGRAPHY.h2,
    fontWeight: '600',
    color: COLORS.text,
  },
  projectOptionDesc: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  projectCheckmark: {
    ...TYPOGRAPHY.h1,
    fontSize: 18,
    color: COLORS.primary,
    fontWeight: '600',
    marginLeft: SPACING.sm,
  },
});
