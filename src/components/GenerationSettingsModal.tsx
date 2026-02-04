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
import Icon from 'react-native-vector-icons/Feather';
import { COLORS } from '../constants';
import { useAppStore } from '../stores';
import { llmService, hardwareService } from '../services';
import { ONNXImageModel } from '../types';

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
  maxTokens: 1024,
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
  const {
    settings,
    updateSettings,
    downloadedModels,
    downloadedImageModels,
    activeImageModelId,
    setActiveImageModelId,
  } = useAppStore();
  const [localSettings, setLocalSettings] = useState({ ...settings });
  const [performanceStats, setPerformanceStats] = useState(llmService.getPerformanceStats());
  const [showImageModelPicker, setShowImageModelPicker] = useState(false);
  const [showClassifierModelPicker, setShowClassifierModelPicker] = useState(false);

  const activeImageModel = downloadedImageModels.find(m => m.id === activeImageModelId);
  const classifierModel = downloadedModels.find(m => m.id === settings.classifierModelId);

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
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.modal} onStartShouldSetResponder={() => true}>
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
            {/* Image Model Selector */}
            <View style={styles.sectionHeader}>
              <Icon name="image" size={18} color={COLORS.primary} />
              <Text style={styles.sectionTitle}>Image Generation</Text>
            </View>
            <TouchableOpacity
              style={styles.modelPickerButton}
              onPress={() => setShowImageModelPicker(!showImageModelPicker)}
            >
              <View style={styles.modelPickerContent}>
                <Text style={styles.modelPickerLabel}>Image Model</Text>
                <Text style={styles.modelPickerValue}>
                  {activeImageModel?.name || 'None selected'}
                </Text>
              </View>
              <Icon
                name={showImageModelPicker ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={COLORS.textSecondary}
              />
            </TouchableOpacity>

            {showImageModelPicker && (
              <View style={styles.modelPickerList}>
                {downloadedImageModels.length === 0 ? (
                  <Text style={styles.noModelsText}>
                    No image models downloaded. Go to Models tab to download one.
                  </Text>
                ) : (
                  <>
                    <TouchableOpacity
                      style={[
                        styles.modelPickerItem,
                        !activeImageModelId && styles.modelPickerItemActive,
                      ]}
                      onPress={() => {
                        setActiveImageModelId(null);
                        setShowImageModelPicker(false);
                      }}
                    >
                      <Text style={styles.modelPickerItemText}>None (disable image gen)</Text>
                      {!activeImageModelId && (
                        <Icon name="check" size={18} color={COLORS.primary} />
                      )}
                    </TouchableOpacity>
                    {downloadedImageModels.map((model) => (
                      <TouchableOpacity
                        key={model.id}
                        style={[
                          styles.modelPickerItem,
                          activeImageModelId === model.id && styles.modelPickerItemActive,
                        ]}
                        onPress={() => {
                          setActiveImageModelId(model.id);
                          setShowImageModelPicker(false);
                        }}
                      >
                        <View>
                          <Text style={styles.modelPickerItemText}>{model.name}</Text>
                          <Text style={styles.modelPickerItemDesc}>{model.style}</Text>
                        </View>
                        {activeImageModelId === model.id && (
                          <Icon name="check" size={18} color={COLORS.primary} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </View>
            )}

            {/* Image Generation Mode Toggle */}
            <View style={styles.modeToggleContainer}>
              <View style={styles.modeToggleInfo}>
                <Text style={styles.modeToggleLabel}>Auto-detect image requests</Text>
                <Text style={styles.modeToggleDesc}>
                  {settings.imageGenerationMode === 'auto'
                    ? 'Detects when you want to generate an image'
                    : 'Use 🎨 button to manually trigger image generation'}
                </Text>
              </View>
              <View style={styles.modeToggleButtons}>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    settings.imageGenerationMode === 'auto' && styles.modeButtonActive,
                  ]}
                  onPress={() => updateSettings({ imageGenerationMode: 'auto' })}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      settings.imageGenerationMode === 'auto' && styles.modeButtonTextActive,
                    ]}
                  >
                    Auto
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    settings.imageGenerationMode === 'manual' && styles.modeButtonActive,
                  ]}
                  onPress={() => updateSettings({ imageGenerationMode: 'manual' })}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      settings.imageGenerationMode === 'manual' && styles.modeButtonTextActive,
                    ]}
                  >
                    Manual
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Auto-detection method (only show when auto mode is enabled) */}
            {settings.imageGenerationMode === 'auto' && (
              <View style={styles.modeToggleContainer}>
                <View style={styles.modeToggleInfo}>
                  <Text style={styles.modeToggleLabel}>Detection Method</Text>
                  <Text style={styles.modeToggleDesc}>
                    {settings.autoDetectMethod === 'pattern'
                      ? 'Fast keyword matching ("draw", "create image", etc.)'
                      : 'Uses current text model for uncertain cases (slower)'}
                  </Text>
                </View>
                <View style={styles.modeToggleButtons}>
                  <TouchableOpacity
                    style={[
                      styles.modeButton,
                      settings.autoDetectMethod === 'pattern' && styles.modeButtonActive,
                    ]}
                    onPress={() => updateSettings({ autoDetectMethod: 'pattern' })}
                  >
                    <Text
                      style={[
                        styles.modeButtonText,
                        settings.autoDetectMethod === 'pattern' && styles.modeButtonTextActive,
                      ]}
                    >
                      Pattern
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modeButton,
                      settings.autoDetectMethod === 'llm' && styles.modeButtonActive,
                    ]}
                    onPress={() => updateSettings({ autoDetectMethod: 'llm' })}
                  >
                    <Text
                      style={[
                        styles.modeButtonText,
                        settings.autoDetectMethod === 'llm' && styles.modeButtonTextActive,
                      ]}
                    >
                      LLM
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Classifier Model Selector - only show when LLM mode is selected */}
            {settings.imageGenerationMode === 'auto' && settings.autoDetectMethod === 'llm' && (
              <>
                <TouchableOpacity
                  style={styles.modelPickerButton}
                  onPress={() => setShowClassifierModelPicker(!showClassifierModelPicker)}
                >
                  <View style={styles.modelPickerContent}>
                    <Text style={styles.modelPickerLabel}>Classifier Model</Text>
                    <Text style={styles.modelPickerValue}>
                      {classifierModel?.name || 'Use current model'}
                    </Text>
                  </View>
                  <Icon
                    name={showClassifierModelPicker ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={COLORS.textSecondary}
                  />
                </TouchableOpacity>

                {showClassifierModelPicker && (
                  <View style={styles.modelPickerList}>
                    <TouchableOpacity
                      style={[
                        styles.modelPickerItem,
                        !settings.classifierModelId && styles.modelPickerItemActive,
                      ]}
                      onPress={() => {
                        updateSettings({ classifierModelId: null });
                        setShowClassifierModelPicker(false);
                      }}
                    >
                      <View>
                        <Text style={styles.modelPickerItemText}>Use current model</Text>
                        <Text style={styles.modelPickerItemDesc}>No model switching needed</Text>
                      </View>
                      {!settings.classifierModelId && (
                        <Icon name="check" size={18} color={COLORS.primary} />
                      )}
                    </TouchableOpacity>
                    {downloadedModels.map((model) => (
                      <TouchableOpacity
                        key={model.id}
                        style={[
                          styles.modelPickerItem,
                          settings.classifierModelId === model.id && styles.modelPickerItemActive,
                        ]}
                        onPress={() => {
                          updateSettings({ classifierModelId: model.id });
                          setShowClassifierModelPicker(false);
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.modelPickerItemText}>{model.name}</Text>
                          <Text style={styles.modelPickerItemDesc}>
                            {hardwareService.formatModelSize(model)}
                            {model.id.toLowerCase().includes('smol') && ' • Fast'}
                          </Text>
                        </View>
                        {settings.classifierModelId === model.id && (
                          <Icon name="check" size={18} color={COLORS.primary} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <Text style={styles.classifierNote}>
                  Tip: Use a small model (SmolLM) for fast classification
                </Text>
              </>
            )}

            {/* Image Quality Settings */}
            <View style={styles.settingItem}>
              <View style={styles.settingHeader}>
                <Text style={styles.settingLabel}>Image Steps</Text>
                <Text style={styles.settingValue}>{settings.imageSteps || 20}</Text>
              </View>
              <Text style={styles.settingDescription}>
                LCM models: 4-8 steps, Standard SD: 20-50 steps
              </Text>
              <Slider
                style={styles.slider}
                minimumValue={4}
                maximumValue={50}
                step={1}
                value={settings.imageSteps || 20}
                onSlidingComplete={(value) => updateSettings({ imageSteps: value })}
                minimumTrackTintColor={COLORS.primary}
                maximumTrackTintColor={COLORS.surfaceLight}
                thumbTintColor={COLORS.primary}
              />
              <View style={styles.sliderLabels}>
                <Text style={styles.sliderMinMax}>4</Text>
                <Text style={styles.sliderMinMax}>50</Text>
              </View>
            </View>

            <View style={styles.settingItem}>
              <View style={styles.settingHeader}>
                <Text style={styles.settingLabel}>Guidance Scale</Text>
                <Text style={styles.settingValue}>{(settings.imageGuidanceScale || 7.5).toFixed(1)}</Text>
              </View>
              <Text style={styles.settingDescription}>
                Higher = follows prompt more strictly (5-15 range)
              </Text>
              <Slider
                style={styles.slider}
                minimumValue={1}
                maximumValue={20}
                step={0.5}
                value={settings.imageGuidanceScale || 7.5}
                onSlidingComplete={(value) => updateSettings({ imageGuidanceScale: value })}
                minimumTrackTintColor={COLORS.primary}
                maximumTrackTintColor={COLORS.surfaceLight}
                thumbTintColor={COLORS.primary}
              />
              <View style={styles.sliderLabels}>
                <Text style={styles.sliderMinMax}>1</Text>
                <Text style={styles.sliderMinMax}>20</Text>
              </View>
            </View>

            <View style={styles.settingItem}>
              <View style={styles.settingHeader}>
                <Text style={styles.settingLabel}>Image Threads</Text>
                <Text style={styles.settingValue}>{settings.imageThreads ?? 4}</Text>
              </View>
              <Text style={styles.settingDescription}>
                CPU threads used for image generation. Takes effect next time the image model loads.
              </Text>
              <Slider
                style={styles.slider}
                minimumValue={1}
                maximumValue={8}
                step={1}
                value={settings.imageThreads ?? 4}
                onSlidingComplete={(value) => updateSettings({ imageThreads: value })}
                minimumTrackTintColor={COLORS.primary}
                maximumTrackTintColor={COLORS.surfaceLight}
                thumbTintColor={COLORS.primary}
              />
              <View style={styles.sliderLabels}>
                <Text style={styles.sliderMinMax}>1</Text>
                <Text style={styles.sliderMinMax}>8</Text>
              </View>
            </View>

            <View style={styles.settingItem}>
              <View style={styles.settingHeader}>
                <Text style={styles.settingLabel}>Image Size</Text>
                <Text style={styles.settingValue}>{settings.imageWidth ?? 256}x{settings.imageHeight ?? 256}</Text>
              </View>
              <Text style={styles.settingDescription}>
                Output resolution (smaller = faster, larger = more detail)
              </Text>
              <Slider
                style={styles.slider}
                minimumValue={128}
                maximumValue={512}
                step={64}
                value={settings.imageWidth ?? 256}
                onSlidingComplete={(value) => updateSettings({ imageWidth: value, imageHeight: value })}
                minimumTrackTintColor={COLORS.primary}
                maximumTrackTintColor={COLORS.surfaceLight}
                thumbTintColor={COLORS.primary}
              />
              <View style={styles.sliderLabels}>
                <Text style={styles.sliderMinMax}>128</Text>
                <Text style={styles.sliderMinMax}>512</Text>
              </View>
            </View>

            <View style={styles.sectionDivider} />

            {/* Text Generation Settings */}
            <View style={styles.sectionHeader}>
              <Icon name="sliders" size={18} color={COLORS.primary} />
              <Text style={styles.sectionTitle}>Text Generation</Text>
            </View>

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
                  maximumTrackTintColor={COLORS.surfaceLight}
                  thumbTintColor={COLORS.primary}
                />
                <View style={styles.sliderLabels}>
                  <Text style={styles.sliderMinMax}>{config.format(config.min)}</Text>
                  <Text style={styles.sliderMinMax}>{config.format(config.max)}</Text>
                </View>
              </View>
            ))}

            <View style={styles.sectionDivider} />

            {/* Performance Settings */}
            <View style={styles.sectionHeader}>
              <Icon name="zap" size={18} color={COLORS.primary} />
              <Text style={styles.sectionTitle}>Performance</Text>
            </View>

            {/* GPU Acceleration Toggle */}
            <View style={styles.modeToggleContainer}>
              <View style={styles.modeToggleInfo}>
                <Text style={styles.modeToggleLabel}>GPU Acceleration</Text>
                <Text style={styles.modeToggleDesc}>
                  Offload inference to GPU when available. Faster for large models, may add overhead for small ones. Requires model reload.
                </Text>
              </View>
              <View style={styles.modeToggleButtons}>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    !settings.enableGpu && styles.modeButtonActive,
                  ]}
                  onPress={() => updateSettings({ enableGpu: false })}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      !settings.enableGpu && styles.modeButtonTextActive,
                    ]}
                  >
                    Off
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    settings.enableGpu && styles.modeButtonActive,
                  ]}
                  onPress={() => updateSettings({ enableGpu: true })}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      settings.enableGpu && styles.modeButtonTextActive,
                    ]}
                  >
                    On
                  </Text>
                </TouchableOpacity>
              </View>

              {/* GPU Layers Slider - inline when GPU is enabled */}
              {settings.enableGpu && (
                <View style={styles.gpuLayersInline}>
                  <View style={styles.settingHeader}>
                    <Text style={styles.settingLabel}>GPU Layers</Text>
                    <Text style={styles.settingValue}>{settings.gpuLayers ?? 6}</Text>
                  </View>
                  <Text style={styles.settingDescription}>
                    Layers offloaded to GPU. Higher = faster but may crash on low-VRAM devices. Requires model reload.
                  </Text>
                  <Slider
                    style={styles.slider}
                    minimumValue={1}
                    maximumValue={99}
                    step={1}
                    value={settings.gpuLayers ?? 6}
                    onSlidingComplete={(value: number) => updateSettings({ gpuLayers: value })}
                    minimumTrackTintColor={COLORS.primary}
                    maximumTrackTintColor={COLORS.surfaceLight}
                    thumbTintColor={COLORS.primary}
                  />
                </View>
              )}
            </View>

            <View style={styles.modeToggleContainer}>
              <View style={styles.modeToggleInfo}>
                <Text style={styles.modeToggleLabel}>Model Loading Strategy</Text>
                <Text style={styles.modeToggleDesc}>
                  {settings.modelLoadingStrategy === 'performance'
                    ? 'Keep models loaded for faster responses (uses more memory)'
                    : 'Load models on demand to save memory (slower switching)'}
                </Text>
              </View>
              <View style={styles.modeToggleButtons}>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    settings.modelLoadingStrategy === 'memory' && styles.modeButtonActive,
                  ]}
                  onPress={() => updateSettings({ modelLoadingStrategy: 'memory' })}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      settings.modelLoadingStrategy === 'memory' && styles.modeButtonTextActive,
                    ]}
                  >
                    Save Memory
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    settings.modelLoadingStrategy === 'performance' && styles.modeButtonActive,
                  ]}
                  onPress={() => updateSettings({ modelLoadingStrategy: 'performance' })}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      settings.modelLoadingStrategy === 'performance' && styles.modeButtonTextActive,
                    ]}
                  >
                    Fast
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Show Generation Details Toggle */}
            <View style={styles.modeToggleContainer}>
              <View style={styles.modeToggleInfo}>
                <Text style={styles.modeToggleLabel}>Show Generation Details</Text>
                <Text style={styles.modeToggleDesc}>
                  Display GPU, model, tok/s, and image settings below each message
                </Text>
              </View>
              <View style={styles.modeToggleButtons}>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    !settings.showGenerationDetails && styles.modeButtonActive,
                  ]}
                  onPress={() => updateSettings({ showGenerationDetails: false })}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      !settings.showGenerationDetails && styles.modeButtonTextActive,
                    ]}
                  >
                    Off
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    settings.showGenerationDetails && styles.modeButtonActive,
                  ]}
                  onPress={() => updateSettings({ showGenerationDetails: true })}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      settings.showGenerationDetails && styles.modeButtonTextActive,
                    ]}
                  >
                    On
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Reset Button */}
            <TouchableOpacity style={styles.resetButton} onPress={handleResetDefaults}>
              <Text style={styles.resetButtonText}>Reset to Defaults</Text>
            </TouchableOpacity>

            <View style={styles.bottomPadding} />
          </ScrollView>
        </View>
      </TouchableOpacity>
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
    paddingVertical: 16,
    paddingHorizontal: 20,
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
    paddingHorizontal: 20,
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
    padding: 20,
  },
  settingItem: {
    marginBottom: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 24,
  },
  modelPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modelPickerContent: {
    flex: 1,
  },
  modelPickerLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  modelPickerValue: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  modelPickerList: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 8,
    overflow: 'hidden',
  },
  modelPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modelPickerItemActive: {
    backgroundColor: COLORS.primary + '25',
  },
  modelPickerItemText: {
    fontSize: 15,
    color: COLORS.text,
  },
  modelPickerItemDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  noModelsText: {
    padding: 14,
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  classifierNote: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  gpuLayersInline: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  modeToggleContainer: {
    marginTop: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modeToggleInfo: {
    marginBottom: 12,
  },
  modeToggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  modeToggleDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  modeToggleButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modeButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  modeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  modeButtonTextActive: {
    color: COLORS.text,
  },
});
