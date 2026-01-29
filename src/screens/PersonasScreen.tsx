import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Card, Button } from '../components';
import { COLORS } from '../constants';
import { usePersonaStore } from '../stores';
import { Persona } from '../types';

const PERSONA_ICONS = ['🤖', '✍️', '💻', '📚', '🎨', '🔬', '💼', '🎭', '🧠', '🌟', '🎯', '🔮'];

export const PersonasScreen: React.FC = () => {
  const navigation = useNavigation();
  const { personas, createPersona, updatePersona, deletePersona, duplicatePersona } = usePersonaStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    systemPrompt: '',
    icon: '🤖',
  });

  const handleCreateNew = () => {
    setEditingPersona(null);
    setFormData({
      name: '',
      description: '',
      systemPrompt: '',
      icon: '🤖',
    });
    setIsEditing(true);
  };

  const handleEdit = (persona: Persona) => {
    setEditingPersona(persona);
    setFormData({
      name: persona.name,
      description: persona.description,
      systemPrompt: persona.systemPrompt,
      icon: persona.icon || '🤖',
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Please enter a name for the persona');
      return;
    }
    if (!formData.systemPrompt.trim()) {
      Alert.alert('Error', 'Please enter a system prompt');
      return;
    }

    if (editingPersona) {
      updatePersona(editingPersona.id, {
        name: formData.name.trim(),
        description: formData.description.trim(),
        systemPrompt: formData.systemPrompt.trim(),
        icon: formData.icon,
      });
    } else {
      createPersona({
        name: formData.name.trim(),
        description: formData.description.trim(),
        systemPrompt: formData.systemPrompt.trim(),
        icon: formData.icon,
      });
    }

    setIsEditing(false);
  };

  const handleDelete = (persona: Persona) => {
    const isDefault = persona.id.startsWith('default-') ||
      ['creative-writer', 'code-expert', 'tutor'].includes(persona.id);

    if (isDefault) {
      Alert.alert('Cannot Delete', 'Default personas cannot be deleted.');
      return;
    }

    Alert.alert(
      'Delete Persona',
      `Are you sure you want to delete "${persona.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deletePersona(persona.id),
        },
      ]
    );
  };

  const handleDuplicate = (persona: Persona) => {
    duplicatePersona(persona.id);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backButtonText}>{'< Back'}</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Personas</Text>
          </View>
          <Button
            title="+ New"
            size="small"
            onPress={handleCreateNew}
          />
        </View>

        <Text style={styles.subtitle}>
          Create custom personas with specific behaviors and apply them to your chats.
        </Text>

        {personas.map((persona) => (
          <Card key={persona.id} style={styles.personaCard}>
            <TouchableOpacity
              style={styles.personaHeader}
              onPress={() => handleEdit(persona)}
            >
              <Text style={styles.personaIcon}>{persona.icon || '🤖'}</Text>
              <View style={styles.personaInfo}>
                <Text style={styles.personaName}>{persona.name}</Text>
                <Text style={styles.personaDescription} numberOfLines={1}>
                  {persona.description}
                </Text>
              </View>
            </TouchableOpacity>

            <Text style={styles.promptPreview} numberOfLines={3}>
              {persona.systemPrompt}
            </Text>

            <View style={styles.personaActions}>
              <TouchableOpacity
                style={styles.personaAction}
                onPress={() => handleEdit(persona)}
              >
                <Text style={styles.personaActionText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.personaAction}
                onPress={() => handleDuplicate(persona)}
              >
                <Text style={styles.personaActionText}>Duplicate</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.personaAction}
                onPress={() => handleDelete(persona)}
              >
                <Text style={[styles.personaActionText, styles.deleteAction]}>
                  Delete
                </Text>
              </TouchableOpacity>
            </View>
          </Card>
        ))}
      </ScrollView>

      {/* Edit/Create Modal */}
      <Modal
        visible={isEditing}
        animationType="slide"
        onRequestClose={() => setIsEditing(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setIsEditing(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editingPersona ? 'Edit Persona' : 'New Persona'}
            </Text>
            <TouchableOpacity onPress={handleSave}>
              <Text style={styles.modalSave}>Save</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            {/* Icon Picker */}
            <Text style={styles.fieldLabel}>Icon</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.iconPicker}
            >
              {PERSONA_ICONS.map((icon) => (
                <TouchableOpacity
                  key={icon}
                  style={[
                    styles.iconOption,
                    formData.icon === icon && styles.iconOptionSelected,
                  ]}
                  onPress={() => setFormData({ ...formData, icon })}
                >
                  <Text style={styles.iconOptionText}>{icon}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Name */}
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.textInput}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              placeholder="e.g., Creative Writer"
              placeholderTextColor={COLORS.textMuted}
            />

            {/* Description */}
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={styles.textInput}
              value={formData.description}
              onChangeText={(text) => setFormData({ ...formData, description: text })}
              placeholder="Brief description of this persona"
              placeholderTextColor={COLORS.textMuted}
            />

            {/* System Prompt */}
            <Text style={styles.fieldLabel}>System Prompt</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={formData.systemPrompt}
              onChangeText={(text) => setFormData({ ...formData, systemPrompt: text })}
              placeholder="Enter the instructions for how the AI should behave..."
              placeholderTextColor={COLORS.textMuted}
              multiline
              numberOfLines={8}
              textAlignVertical="top"
            />

            <Text style={styles.helpText}>
              The system prompt defines how the AI will behave in conversations
              using this persona. Be specific about the tone, expertise, and
              style you want.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '500',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
  personaCard: {
    marginBottom: 12,
  },
  personaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  personaIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  personaInfo: {
    flex: 1,
  },
  personaName: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  personaDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  promptPreview: {
    fontSize: 13,
    color: COLORS.textMuted,
    backgroundColor: COLORS.surfaceLight,
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  personaActions: {
    flexDirection: 'row',
    gap: 16,
  },
  personaAction: {
    paddingVertical: 4,
  },
  personaActionText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  deleteAction: {
    color: COLORS.error,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalCancel: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalSave: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
    marginTop: 16,
  },
  textInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    color: COLORS.text,
    fontSize: 16,
  },
  textArea: {
    minHeight: 150,
    textAlignVertical: 'top',
  },
  iconPicker: {
    flexDirection: 'row',
  },
  iconOption: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  iconOptionSelected: {
    backgroundColor: COLORS.primary,
  },
  iconOptionText: {
    fontSize: 24,
  },
  helpText: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 12,
    lineHeight: 18,
  },
});
