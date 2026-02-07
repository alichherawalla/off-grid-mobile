import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { Card, Button } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { COLORS, TYPOGRAPHY, SPACING } from '../constants';
import { useWhisperStore } from '../stores';
import { WHISPER_MODELS } from '../services';

export const VoiceSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const {
    downloadedModelId: whisperModelId,
    isDownloading: isWhisperDownloading,
    downloadProgress: whisperProgress,
    downloadModel: downloadWhisperModel,
    deleteModel: deleteWhisperModel,
    error: whisperError,
    clearError: clearWhisperError,
  } = useWhisperStore();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={20} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Voice Transcription</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          <Text style={styles.description}>
            Download a Whisper model to enable on-device voice input. All transcription happens locally - no data is sent to any server.
          </Text>

          {whisperModelId ? (
            <View style={styles.modelInfo}>
              <View style={styles.modelHeader}>
                <Text style={styles.modelName}>
                  {WHISPER_MODELS.find(m => m.id === whisperModelId)?.name || whisperModelId}
                </Text>
                <Text style={styles.modelStatus}>Downloaded</Text>
              </View>
              <Button
                title="Remove Model"
                variant="outline"
                size="small"
                onPress={() => {
                  setAlertState(showAlert(
                    'Remove Whisper Model',
                    'This will disable voice input until you download a model again.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => {
                          setAlertState(hideAlert());
                          deleteWhisperModel();
                        },
                      },
                    ]
                  ));
                }}
                style={styles.removeButton}
              />
            </View>
          ) : isWhisperDownloading ? (
            <View style={styles.downloading}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.downloadingText}>
                Downloading... {Math.round(whisperProgress * 100)}%
              </Text>
              <View style={styles.progressBar}>
                <View
                  style={[styles.progressFill, { width: `${whisperProgress * 100}%` }]}
                />
              </View>
            </View>
          ) : (
            <View style={styles.modelList}>
              <Text style={styles.selectLabel}>Select a model to download:</Text>
              {WHISPER_MODELS.slice(0, 3).map((model) => (
                <TouchableOpacity
                  key={model.id}
                  style={styles.modelOption}
                  onPress={() => downloadWhisperModel(model.id)}
                >
                  <View style={styles.modelOptionInfo}>
                    <Text style={styles.modelOptionName}>{model.name}</Text>
                    <Text style={styles.modelOptionSize}>{model.size} MB</Text>
                  </View>
                  <Text style={styles.modelOptionDesc}>{model.description}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {whisperError && (
            <TouchableOpacity onPress={clearWhisperError}>
              <Text style={styles.error}>{whisperError}</Text>
            </TouchableOpacity>
          )}
        </Card>

        <Card style={styles.privacyCard}>
          <View style={styles.privacyIconContainer}>
            <Icon name="mic" size={18} color={COLORS.textSecondary} />
          </View>
          <Text style={styles.privacyTitle}>Privacy First</Text>
          <Text style={styles.privacyText}>
            Voice transcription happens entirely on your device. Your audio is never sent to any server or stored anywhere.
          </Text>
        </Card>
      </ScrollView>
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
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
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: SPACING.md,
  },
  backButton: {
    padding: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.h2,
    flex: 1,
    color: COLORS.text,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  description: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: SPACING.lg,
  },
  modelInfo: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.lg,
  },
  modelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  modelName: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
  },
  modelStatus: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase',
    color: COLORS.primary,
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 6,
  },
  removeButton: {
    borderColor: COLORS.error,
  },
  downloading: {
    alignItems: 'center',
    padding: SPACING.lg,
  },
  downloadingText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
  },
  progressBar: {
    width: '100%',
    height: 6,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 3,
    marginTop: SPACING.md,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  modelList: {
    gap: SPACING.sm,
  },
  selectLabel: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase',
    color: COLORS.textMuted,
    marginBottom: SPACING.sm,
    letterSpacing: 0.3,
  },
  modelOption: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modelOptionInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  modelOptionName: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
  },
  modelOptionSize: {
    ...TYPOGRAPHY.meta,
    color: COLORS.primary,
  },
  modelOptionDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  error: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.error,
    marginTop: SPACING.md,
    textAlign: 'center',
  },
  privacyCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  privacyIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  privacyTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  privacyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
