import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  TouchableOpacity,
  Switch,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { Card, Button } from '../components';
import { COLORS } from '../constants';
import { useAppStore, useChatStore, useAuthStore, useWhisperStore } from '../stores';
import { hardwareService, modelManager, llmService, authService, WHISPER_MODELS } from '../services';
import { PassphraseSetupScreen } from './PassphraseSetupScreen';

export const SettingsScreen: React.FC = () => {
  const [storageUsed, setStorageUsed] = useState(0);
  const [availableStorage, setAvailableStorage] = useState(0);
  const [showPassphraseSetup, setShowPassphraseSetup] = useState(false);
  const [isChangingPassphrase, setIsChangingPassphrase] = useState(false);

  const {
    deviceInfo,
    settings: rawSettings,
    updateSettings,
    downloadedModels,
    setOnboardingComplete,
  } = useAppStore();

  const {
    isEnabled: authEnabled,
    setEnabled: setAuthEnabled,
  } = useAuthStore();

  const {
    downloadedModelId: whisperModelId,
    isDownloading: isWhisperDownloading,
    downloadProgress: whisperProgress,
    downloadModel: downloadWhisperModel,
    deleteModel: deleteWhisperModel,
    error: whisperError,
    clearError: clearWhisperError,
  } = useWhisperStore();

  // Ensure settings have default values (for backward compatibility with persisted state)
  const settings = {
    systemPrompt: rawSettings?.systemPrompt ?? 'You are a helpful AI assistant.',
  };

  const { conversations, clearAllConversations } = useChatStore();

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

              // Remove passphrase
              await authService.removePassphrase();
              setAuthEnabled(false);

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

  const handleTogglePassphrase = async () => {
    if (authEnabled) {
      // Disabling passphrase
      Alert.alert(
        'Disable Passphrase Lock',
        'Are you sure you want to disable passphrase protection?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable',
            style: 'destructive',
            onPress: async () => {
              await authService.removePassphrase();
              setAuthEnabled(false);
            },
          },
        ]
      );
    } else {
      // Enabling passphrase
      setIsChangingPassphrase(false);
      setShowPassphraseSetup(true);
    }
  };

  const handleChangePassphrase = () => {
    setIsChangingPassphrase(true);
    setShowPassphraseSetup(true);
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

        {/* Security */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Security</Text>
          <View style={styles.securityRow}>
            <View style={styles.securityInfo}>
              <Text style={styles.securityLabel}>Passphrase Lock</Text>
              <Text style={styles.securityHint}>
                Require passphrase to open app
              </Text>
            </View>
            <Switch
              value={authEnabled}
              onValueChange={handleTogglePassphrase}
              trackColor={{ false: COLORS.surfaceLight, true: COLORS.primary + '80' }}
              thumbColor={authEnabled ? COLORS.primary : COLORS.textMuted}
            />
          </View>
          {authEnabled && (
            <TouchableOpacity
              style={styles.changePassphraseButton}
              onPress={handleChangePassphrase}
            >
              <Text style={styles.changePassphraseText}>Change Passphrase</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.securityNote}>
            When enabled, the app will lock automatically when you switch away or close it.
          </Text>
        </Card>

        {/* Voice Transcription */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Voice Transcription</Text>
          <Text style={styles.voiceDescription}>
            Download a Whisper model to enable on-device voice input. All transcription happens locally - no data is sent to any server.
          </Text>

          {whisperModelId ? (
            <View style={styles.whisperModelInfo}>
              <View style={styles.whisperModelHeader}>
                <Text style={styles.whisperModelName}>
                  {WHISPER_MODELS.find(m => m.id === whisperModelId)?.name || whisperModelId}
                </Text>
                <Text style={styles.whisperModelStatus}>Downloaded</Text>
              </View>
              <Button
                title="Remove Model"
                variant="outline"
                size="small"
                onPress={() => {
                  Alert.alert(
                    'Remove Whisper Model',
                    'This will disable voice input until you download a model again.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: deleteWhisperModel },
                    ]
                  );
                }}
                style={styles.removeWhisperButton}
              />
            </View>
          ) : isWhisperDownloading ? (
            <View style={styles.whisperDownloading}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.whisperDownloadingText}>
                Downloading... {Math.round(whisperProgress * 100)}%
              </Text>
              <View style={styles.whisperProgressBar}>
                <View
                  style={[styles.whisperProgressFill, { width: `${whisperProgress * 100}%` }]}
                />
              </View>
            </View>
          ) : (
            <View style={styles.whisperModels}>
              {WHISPER_MODELS.slice(0, 3).map((model) => (
                <TouchableOpacity
                  key={model.id}
                  style={styles.whisperModelOption}
                  onPress={() => downloadWhisperModel(model.id)}
                >
                  <View style={styles.whisperModelOptionInfo}>
                    <Text style={styles.whisperModelOptionName}>{model.name}</Text>
                    <Text style={styles.whisperModelOptionSize}>{model.size} MB</Text>
                  </View>
                  <Text style={styles.whisperModelOptionDesc}>{model.description}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {whisperError && (
            <TouchableOpacity onPress={clearWhisperError}>
              <Text style={styles.whisperError}>{whisperError}</Text>
            </TouchableOpacity>
          )}
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

        {/* Default System Prompt */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Default System Prompt</Text>
          <Text style={styles.settingHelp}>
            Used when chatting without a project selected. Generation settings are available in the chat interface.
          </Text>
          <TextInput
            style={styles.textArea}
            value={settings.systemPrompt}
            onChangeText={(text) => updateSettings({ systemPrompt: text })}
            multiline
            numberOfLines={4}
            placeholder="Enter system prompt..."
            placeholderTextColor={COLORS.textMuted}
          />
        </Card>

        {/* Privacy */}
        <Card style={styles.privacyCard}>
          <View style={styles.privacyIconContainer}>
            <Icon name="lock" size={24} color={COLORS.secondary} />
          </View>
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

      {/* Passphrase Setup Modal */}
      <Modal
        visible={showPassphraseSetup}
        animationType="slide"
        onRequestClose={() => setShowPassphraseSetup(false)}
      >
        <PassphraseSetupScreen
          isChanging={isChangingPassphrase}
          onComplete={() => setShowPassphraseSetup(false)}
          onCancel={() => setShowPassphraseSetup(false)}
        />
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
  securityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  securityInfo: {
    flex: 1,
  },
  securityLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  securityHint: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  securityNote: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 12,
    lineHeight: 18,
  },
  changePassphraseButton: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  changePassphraseText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  settingHelp: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 12,
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
  privacyIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.secondary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
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
  voiceDescription: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: 16,
  },
  whisperModelInfo: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    padding: 16,
  },
  whisperModelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  whisperModelName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  whisperModelStatus: {
    fontSize: 12,
    color: COLORS.secondary,
    fontWeight: '500',
    backgroundColor: COLORS.secondary + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  removeWhisperButton: {
    borderColor: COLORS.error,
  },
  whisperDownloading: {
    alignItems: 'center',
    padding: 16,
  },
  whisperDownloadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
  whisperProgressBar: {
    width: '100%',
    height: 6,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 3,
    marginTop: 12,
    overflow: 'hidden',
  },
  whisperProgressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  whisperModels: {
    gap: 8,
  },
  whisperModelOption: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  whisperModelOptionInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  whisperModelOptionName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  whisperModelOptionSize: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '500',
  },
  whisperModelOptionDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  whisperError: {
    fontSize: 13,
    color: COLORS.error,
    marginTop: 8,
    textAlign: 'center',
  },
});
