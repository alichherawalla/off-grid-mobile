import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { COLORS } from '../constants';
import { useProjectStore } from '../stores';
import { ProjectsStackParamList } from '../navigation/types';

type NavigationProp = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectEdit'>;
type RouteProps = RouteProp<ProjectsStackParamList, 'ProjectEdit'>;

// Color options for project icons
const ICON_COLORS = [
  '#6366F1', // Indigo
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Violet
  '#06B6D4', // Cyan
  '#EC4899', // Pink
  '#84CC16', // Lime
];

export const ProjectEditScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const projectId = route.params?.projectId;

  const { getProject, createProject, updateProject } = useProjectStore();
  const existingProject = projectId ? getProject(projectId) : null;

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    systemPrompt: '',
    iconColor: ICON_COLORS[0],
  });

  useEffect(() => {
    if (existingProject) {
      setFormData({
        name: existingProject.name,
        description: existingProject.description,
        systemPrompt: existingProject.systemPrompt,
        iconColor: existingProject.icon?.startsWith('#') ? existingProject.icon : ICON_COLORS[0],
      });
    }
  }, [existingProject]);

  const handleSave = () => {
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Please enter a name for the project');
      return;
    }
    if (!formData.systemPrompt.trim()) {
      Alert.alert('Error', 'Please enter a system prompt');
      return;
    }

    if (existingProject) {
      updateProject(existingProject.id, {
        name: formData.name.trim(),
        description: formData.description.trim(),
        systemPrompt: formData.systemPrompt.trim(),
        icon: formData.iconColor,
      });
    } else {
      createProject({
        name: formData.name.trim(),
        description: formData.description.trim(),
        systemPrompt: formData.systemPrompt.trim(),
        icon: formData.iconColor,
      });
    }

    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {existingProject ? 'Edit Project' : 'New Project'}
          </Text>
          <TouchableOpacity onPress={handleSave} style={styles.headerButton}>
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
        >
          {/* Color Picker */}
          <Text style={styles.label}>Color</Text>
          <View style={styles.colorPicker}>
            {ICON_COLORS.map((color) => (
              <TouchableOpacity
                key={color}
                style={[
                  styles.colorOption,
                  { backgroundColor: color },
                  formData.iconColor === color && styles.colorOptionSelected,
                ]}
                onPress={() => setFormData({ ...formData, iconColor: color })}
              >
                {formData.iconColor === color && (
                  <Icon name="check" size={18} color={COLORS.text} />
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* Preview */}
          {formData.name.trim() && (
            <View style={styles.preview}>
              <View style={[styles.previewIcon, { backgroundColor: formData.iconColor + '30' }]}>
                <Text style={[styles.previewIconText, { color: formData.iconColor }]}>
                  {formData.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={styles.previewName}>{formData.name}</Text>
            </View>
          )}

          {/* Name */}
          <Text style={styles.label}>Name *</Text>
          <TextInput
            style={styles.input}
            value={formData.name}
            onChangeText={(text) => setFormData({ ...formData, name: text })}
            placeholder="e.g., Spanish Learning, Code Review"
            placeholderTextColor={COLORS.textMuted}
          />

          {/* Description */}
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={styles.input}
            value={formData.description}
            onChangeText={(text) => setFormData({ ...formData, description: text })}
            placeholder="Brief description of this project"
            placeholderTextColor={COLORS.textMuted}
          />

          {/* System Prompt */}
          <Text style={styles.label}>System Prompt *</Text>
          <Text style={styles.hint}>
            This context is sent to the AI at the start of every chat in this project.
          </Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={formData.systemPrompt}
            onChangeText={(text) => setFormData({ ...formData, systemPrompt: text })}
            placeholder="Enter the instructions or context for the AI..."
            placeholderTextColor={COLORS.textMuted}
            multiline
            textAlignVertical="top"
          />

          <Text style={styles.tip}>
            Tip: Be specific about what you want the AI to do, how it should respond, and any context it needs.
          </Text>

          <View style={styles.bottomPadding} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  keyboardAvoid: {
    flex: 1,
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
  headerButton: {
    padding: 4,
  },
  cancelText: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
  },
  saveText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 100,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
    marginTop: 16,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 14,
    color: COLORS.text,
    fontSize: 16,
  },
  textArea: {
    minHeight: 180,
    maxHeight: 280,
    textAlignVertical: 'top',
  },
  colorPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorOptionSelected: {
    borderWidth: 3,
    borderColor: COLORS.text,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: 12,
    borderRadius: 10,
    marginTop: 16,
  },
  previewIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  previewIconText: {
    fontSize: 18,
    fontWeight: '600',
  },
  previewName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  tip: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 12,
    lineHeight: 18,
  },
  bottomPadding: {
    height: 40,
  },
});
