import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  TouchableOpacity,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Button } from '../components';
import { COLORS } from '../constants';
import { useAppStore, useChatStore, usePersonaStore } from '../stores';
import { hardwareService, modelManager, llmService } from '../services';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';

export const SettingsScreen: React.FC = () => {
  const [storageUsed, setStorageUsed] = useState(0);
  const [availableStorage, setAvailableStorage] = useState(0);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const {
    deviceInfo,
    settings: rawSettings,
    updateSettings,
    downloadedModels,
    setOnboardingComplete,
  } = useAppStore();

  // Ensure settings have default values (for backward compatibility with persisted state)
  const settings = {
    systemPrompt: rawSettings?.systemPrompt ?? 'You are a helpful AI assistant.',
    temperature: rawSettings?.temperature ?? 0.7,
    maxTokens: rawSettings?.maxTokens ?? 512,
    topP: rawSettings?.topP ?? 0.9,
    repeatPenalty: rawSettings?.repeatPenalty ?? 1.1,
    contextLength: rawSettings?.contextLength ?? 2048,
  };

  const { conversations, clearAllConversations } = useChatStore();
  const { personas } = usePersonaStore();

  useEffect(() => {
    loadStorageInfo();
  }, [downloadedModels]);

  const loadStorageInfo = async () => {
    const used = await modelManager.getStorageUsed();
    const available = await modelManager.getAvailableStorage();
    setStorageUsed(used);
    setAvailableStorage(available);
  };

  const handleClearConversations = () => {
    Alert.alert(
      'Clear All Conversations',
      'This will delete all your chat history. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearAllConversations();
            Alert.alert('Done', 'All conversations have been cleared.');
          },
        },
      ]
    );
  };

  const handleResetApp = () => {
    Alert.alert(
      'Reset App',
      'This will delete all data including downloaded models, conversations, and settings. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              // Unload current model
              await llmService.unloadModel();

              // Delete all models
              for (const model of downloadedModels) {
                await modelManager.deleteModel(model.id).catch(() => {});
              }

              // Clear conversations
              clearAllConversations();

              // Reset onboarding
              setOnboardingComplete(false);

              Alert.alert(
                'App Reset',
                'Please restart the app to complete the reset.'
              );
            } catch (error) {
              Alert.alert('Error', 'Failed to reset app.');
            }
          },
        },
      ]
    );
  };

  const totalRamGB = hardwareService.getTotalMemoryGB();
  const deviceTier = hardwareService.getDeviceTier();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        {/* Device Info */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Device Information</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Model</Text>
            <Text style={styles.infoValue}>{deviceInfo?.deviceModel}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>System</Text>
            <Text style={styles.infoValue}>
              {deviceInfo?.systemName} {deviceInfo?.systemVersion}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Total RAM</Text>
            <Text style={styles.infoValue}>{totalRamGB.toFixed(1)} GB</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Device Tier</Text>
            <Text style={[styles.infoValue, styles.tierBadge]}>
              {deviceTier.charAt(0).toUpperCase() + deviceTier.slice(1)}
            </Text>
          </View>
        </Card>

        {/* Storage */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Storage</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Models Downloaded</Text>
            <Text style={styles.infoValue}>{downloadedModels.length}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Storage Used</Text>
            <Text style={styles.infoValue}>
              {hardwareService.formatBytes(storageUsed)}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Available</Text>
            <Text style={styles.infoValue}>
              {hardwareService.formatBytes(availableStorage)}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Conversations</Text>
            <Text style={styles.infoValue}>{conversations.length}</Text>
          </View>
        </Card>

        {/* Personas */}
        <Card style={styles.section}>
          <View style={styles.personasHeader}>
            <View>
              <Text style={styles.sectionTitle}>Personas</Text>
              <Text style={styles.personasSubtitle}>
                {personas.length} persona{personas.length !== 1 ? 's' : ''} available
              </Text>
            </View>
            <TouchableOpacity
              style={styles.manageButton}
              onPress={() => navigation.navigate('Personas')}
            >
              <Text style={styles.manageButtonText}>Manage</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.personasHelp}>
            Create custom personas with specific behaviors and apply them to your chats.
          </Text>
        </Card>

        {/* Model Settings */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Model Settings</Text>

          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>System Prompt</Text>
            <TextInput
              style={styles.textArea}
              value={settings.systemPrompt}
              onChangeText={(text) => updateSettings({ systemPrompt: text })}
              multiline
              numberOfLines={4}
              placeholder="Enter system prompt..."
              placeholderTextColor={COLORS.textMuted}
            />
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingHeader}>
              <Text style={styles.settingLabel}>Temperature</Text>
              <Text style={styles.settingValue}>
                {settings.temperature.toFixed(2)}
              </Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={2}
              step={0.05}
              value={settings.temperature}
              onValueChange={(value) => updateSettings({ temperature: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surfaceLight}
              thumbTintColor={COLORS.primary}
            />
            <Text style={styles.settingHelp}>
              Lower = more focused, Higher = more creative (0-2)
            </Text>
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingHeader}>
              <Text style={styles.settingLabel}>Max Tokens</Text>
              <Text style={styles.settingValue}>{settings.maxTokens}</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={64}
              maximumValue={4096}
              step={64}
              value={settings.maxTokens}
              onValueChange={(value) => updateSettings({ maxTokens: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surfaceLight}
              thumbTintColor={COLORS.primary}
            />
            <Text style={styles.settingHelp}>
              Maximum length of generated responses (64-4096)
            </Text>
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingHeader}>
              <Text style={styles.settingLabel}>Top P (Nucleus Sampling)</Text>
              <Text style={styles.settingValue}>
                {settings.topP.toFixed(2)}
              </Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={0.1}
              maximumValue={1}
              step={0.05}
              value={settings.topP}
              onValueChange={(value) => updateSettings({ topP: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surfaceLight}
              thumbTintColor={COLORS.primary}
            />
            <Text style={styles.settingHelp}>
              Controls diversity. Lower = more focused (0.1-1.0)
            </Text>
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingHeader}>
              <Text style={styles.settingLabel}>Repeat Penalty</Text>
              <Text style={styles.settingValue}>
                {settings.repeatPenalty.toFixed(2)}
              </Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={2}
              step={0.05}
              value={settings.repeatPenalty}
              onValueChange={(value) => updateSettings({ repeatPenalty: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surfaceLight}
              thumbTintColor={COLORS.primary}
            />
            <Text style={styles.settingHelp}>
              Penalizes repetition. Higher = less repetitive (1.0-2.0)
            </Text>
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingHeader}>
              <Text style={styles.settingLabel}>Context Length</Text>
              <Text style={styles.settingValue}>{settings.contextLength}</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={512}
              maximumValue={8192}
              step={256}
              value={settings.contextLength}
              onValueChange={(value) => updateSettings({ contextLength: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surfaceLight}
              thumbTintColor={COLORS.primary}
            />
            <Text style={styles.settingHelp}>
              How much conversation history to remember (512-8192)
            </Text>
          </View>

          <Button
            title="Reset to Defaults"
            variant="outline"
            size="small"
            onPress={() => {
              updateSettings({
                temperature: 0.7,
                maxTokens: 512,
                topP: 0.9,
                repeatPenalty: 1.1,
                contextLength: 2048,
              });
            }}
            style={styles.resetButton}
          />
        </Card>

        {/* Privacy */}
        <Card style={styles.privacyCard}>
          <Text style={styles.privacyIcon}>🔒</Text>
          <Text style={styles.privacyTitle}>Privacy First</Text>
          <Text style={styles.privacyText}>
            All your data stays on this device. No conversations, prompts, or
            personal information is ever sent to any server. Your AI assistant is
            truly private.
          </Text>
        </Card>

        {/* Data Management */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Data Management</Text>

          <Button
            title="Clear All Conversations"
            variant="outline"
            onPress={handleClearConversations}
            style={styles.dangerButton}
          />

          <Button
            title="Reset App"
            variant="outline"
            onPress={handleResetApp}
            style={{...styles.dangerButton, marginBottom: 0}}
          />
        </Card>

        {/* About */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Version</Text>
            <Text style={styles.infoValue}>1.0.0</Text>
          </View>
          <Text style={styles.aboutText}>
            Local LLM is an open-source project that brings AI to your device
            without compromising your privacy. Models are sourced from Hugging
            Face and run entirely on your device using llama.cpp.
          </Text>
        </Card>
      </ScrollView>
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
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 24,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  infoLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  tierBadge: {
    backgroundColor: COLORS.primary + '30',
    color: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  settingItem: {
    marginBottom: 16,
  },
  settingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  settingValue: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  settingHelp: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  slider: {
    width: '100%',
    height: 40,
    marginVertical: 4,
  },
  resetButton: {
    marginTop: 8,
  },
  textArea: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    padding: 12,
    color: COLORS.text,
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  privacyCard: {
    alignItems: 'center',
    backgroundColor: COLORS.secondary + '15',
    borderWidth: 1,
    borderColor: COLORS.secondary + '40',
    marginBottom: 16,
  },
  privacyIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  privacyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.secondary,
    marginBottom: 8,
  },
  privacyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  dangerButton: {
    borderColor: COLORS.error,
    marginBottom: 12,
  },
  aboutText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginTop: 8,
  },
  personasHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  personasSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  manageButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  manageButtonText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  personasHelp: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
});
