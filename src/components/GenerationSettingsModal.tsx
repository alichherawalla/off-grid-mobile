import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS } from '../constants';
import { useAppStore } from '../stores';
import { llmService } from '../services';

interface SettingConfig {
  key: keyof typeof DEFAULT_SETTINGS;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  description?: string;
}

const DEFAULT_SETTINGS = {
  temperature: 0.7,
  maxTokens: 512,
  topP: 0.9,
  repeatPenalty: 1.1,
  contextLength: 2048,
  nThreads: 6,
  nBatch: 256,
};

const SETTINGS_CONFIG: SettingConfig[] = [
  {
    key: 'temperature',
    label: 'Temperature',
    min: 0,
    max: 2,
    step: 0.05,
    format: (v) => v.toFixed(2),
    description: 'Higher = more creative, Lower = more focused',
  },
  {
    key: 'maxTokens',
    label: 'Max Tokens',
    min: 64,
    max: 8192,
    step: 64,
    format: (v) => v >= 1024 ? `${(v / 1024).toFixed(1)}K` : v.toString(),
    description: 'Maximum length of generated response',
  },
  {
    key: 'topP',
    label: 'Top P',
    min: 0.1,
    max: 1.0,
    step: 0.05,
    format: (v) => v.toFixed(2),
    description: 'Nucleus sampling threshold',
  },
  {
    key: 'repeatPenalty',
    label: 'Repeat Penalty',
    min: 1.0,
    max: 2.0,
    step: 0.05,
    format: (v) => v.toFixed(2),
    description: 'Penalize repeated tokens',
  },
  {
    key: 'contextLength',
    label: 'Context Length',
    min: 512,
    max: 32768,
    step: 512,
    format: (v) => v >= 1024 ? `${(v / 1024).toFixed(1)}K` : v.toString(),
    description: 'Max conversation memory (requires model reload)',
  },
  {
    key: 'nThreads',
    label: 'CPU Threads',
    min: 1,
    max: 12,
    step: 1,
    format: (v) => v.toString(),
    description: 'Parallel threads for inference',
  },
  {
    key: 'nBatch',
    label: 'Batch Size',
    min: 32,
    max: 512,
    step: 32,
    format: (v) => v.toString(),
    description: 'Tokens processed per batch',
  },
];

interface GenerationSettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

export const GenerationSettingsModal: React.FC<GenerationSettingsModalProps> = ({
  visible,
  onClose,
}) => {
  const { settings, updateSettings } = useAppStore();
  const [localSettings, setLocalSettings] = useState({ ...settings });
  const [performanceStats, setPerformanceStats] = useState(llmService.getPerformanceStats());

  useEffect(() => {
    if (visible) {
      setLocalSettings({ ...settings });
      setPerformanceStats(llmService.getPerformanceStats());
    }
  }, [visible, settings]);

  const handleSliderChange = (key: keyof typeof DEFAULT_SETTINGS, value: number) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSliderComplete = (key: keyof typeof DEFAULT_SETTINGS, value: number) => {
    updateSettings({ [key]: value });
  };

  const handleResetDefaults = () => {
    setLocalSettings((prev) => ({
      ...prev,
      ...DEFAULT_SETTINGS,
    }));
    updateSettings(DEFAULT_SETTINGS);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title}>Generation Settings</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeButton}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Performance Stats */}
          {performanceStats.lastTokensPerSecond > 0 && (
            <View style={styles.statsBar}>
              <Text style={styles.statsLabel}>Last Generation:</Text>
              <Text style={styles.statsValue}>
                {performanceStats.lastTokensPerSecond.toFixed(1)} tok/s
              </Text>
              <Text style={styles.statsSeparator}>•</Text>
              <Text style={styles.statsValue}>
                {performanceStats.lastTokenCount} tokens
              </Text>
              <Text style={styles.statsSeparator}>•</Text>
              <Text style={styles.statsValue}>
                {performanceStats.lastGenerationTime.toFixed(1)}s
              </Text>
            </View>
          )}

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {SETTINGS_CONFIG.map((config) => (
              <View key={config.key} style={styles.settingItem}>
                <View style={styles.settingHeader}>
                  <Text style={styles.settingLabel}>{config.label}</Text>
                  <Text style={styles.settingValue}>
                    {config.format(localSettings[config.key] as number)}
                  </Text>
                </View>
                {config.description && (
                  <Text style={styles.settingDescription}>{config.description}</Text>
                )}
                <Slider
                  style={styles.slider}
                  minimumValue={config.min}
                  maximumValue={config.max}
                  step={config.step}
                  value={localSettings[config.key] as number}
                  onValueChange={(value) => handleSliderChange(config.key, value)}
                  onSlidingComplete={(value) => handleSliderComplete(config.key, value)}
                  minimumTrackTintColor={COLORS.primary}
                  maximumTrackTintColor={COLORS.surface}
                  thumbTintColor={COLORS.primary}
                />
                <View style={styles.sliderLabels}>
                  <Text style={styles.sliderMinMax}>{config.format(config.min)}</Text>
                  <Text style={styles.sliderMinMax}>{config.format(config.max)}</Text>
                </View>
              </View>
            ))}

            {/* Reset Button */}
            <TouchableOpacity style={styles.resetButton} onPress={handleResetDefaults}>
              <Text style={styles.resetButtonText}>Reset to Defaults</Text>
            </TouchableOpacity>

            <View style={styles.bottomPadding} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  closeButton: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '500',
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 6,
    flexWrap: 'wrap',
  },
  statsLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  statsValue: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  statsSeparator: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  content: {
    padding: 16,
  },
  settingItem: {
    marginBottom: 24,
  },
  settingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  settingValue: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  settingDescription: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 8,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
  },
  sliderMinMax: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  resetButton: {
    backgroundColor: COLORS.surface,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  resetButtonText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  bottomPadding: {
    height: 40,
  },
});
