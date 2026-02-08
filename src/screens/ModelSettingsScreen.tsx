import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components';
import { COLORS, TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore } from '../stores';

export const ModelSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { settings: rawSettings, updateSettings } = useAppStore();

  const systemPrompt = rawSettings?.systemPrompt ?? 'You are a helpful AI assistant.';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={20} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Model Settings</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* System Prompt */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Default System Prompt</Text>
          <Text style={styles.settingHelp}>
            Instructions given to the model before each conversation. Used when chatting without a project selected.
          </Text>
          <TextInput
            style={styles.textArea}
            value={systemPrompt}
            onChangeText={(text) => updateSettings({ systemPrompt: text })}
            multiline
            numberOfLines={4}
            placeholder="Enter system prompt..."
            placeholderTextColor={COLORS.textMuted}
          />
        </Card>

        {/* Image Generation Settings */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Image Generation</Text>
          <Text style={styles.settingHelp}>
            Control how image generation requests are handled in chat.
          </Text>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>Automatic Detection</Text>
              <Text style={styles.toggleDesc}>
                {rawSettings?.imageGenerationMode === 'auto'
                  ? 'LLM will classify if your message is asking for an image'
                  : 'Only generate images when you tap the image button'}
              </Text>
            </View>
            <Switch
              value={rawSettings?.imageGenerationMode === 'auto'}
              onValueChange={(value) =>
                updateSettings({ imageGenerationMode: value ? 'auto' : 'manual' })
              }
              trackColor={{ false: COLORS.surfaceLight, true: COLORS.primary + '80' }}
              thumbColor={rawSettings?.imageGenerationMode === 'auto' ? COLORS.primary : COLORS.textMuted}
            />
          </View>
          <Text style={styles.toggleNote}>
            {rawSettings?.imageGenerationMode === 'auto'
              ? 'In Auto mode, messages like "Draw me a sunset" will automatically generate an image when an image model is loaded.'
              : 'In Manual mode, you must tap the IMG button in chat to generate images.'}
          </Text>

          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Image Steps</Text>
              <Text style={styles.sliderValue}>{rawSettings?.imageSteps || 30}</Text>
            </View>
            <Text style={styles.sliderDesc}>More steps = better quality but slower (LCM: 4-8, Standard: 20-50)</Text>
            <Slider
              style={styles.slider}
              minimumValue={4}
              maximumValue={50}
              step={1}
              value={rawSettings?.imageSteps || 30}
              onSlidingComplete={(value) => updateSettings({ imageSteps: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surface}
              thumbTintColor={COLORS.primary}
            />
          </View>

          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Guidance Scale</Text>
              <Text style={styles.sliderValue}>{(rawSettings?.imageGuidanceScale || 7.5).toFixed(1)}</Text>
            </View>
            <Text style={styles.sliderDesc}>Higher = follows prompt more strictly</Text>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={20}
              step={0.5}
              value={rawSettings?.imageGuidanceScale || 7.5}
              onSlidingComplete={(value) => updateSettings({ imageGuidanceScale: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surface}
              thumbTintColor={COLORS.primary}
            />
          </View>

          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Image Threads</Text>
              <Text style={styles.sliderValue}>{rawSettings?.imageThreads ?? 4}</Text>
            </View>
            <Text style={styles.sliderDesc}>
              CPU threads used for image generation (applies on next image model load)
            </Text>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={8}
              step={1}
              value={rawSettings?.imageThreads ?? 4}
              onSlidingComplete={(value) => updateSettings({ imageThreads: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surface}
              thumbTintColor={COLORS.primary}
            />
          </View>

          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Image Size</Text>
              <Text style={styles.sliderValue}>{rawSettings?.imageWidth ?? 256}x{rawSettings?.imageHeight ?? 256}</Text>
            </View>
            <Text style={styles.sliderDesc}>Output resolution (smaller = faster, larger = more detail)</Text>
            <Slider
              style={styles.slider}
              minimumValue={128}
              maximumValue={512}
              step={64}
              value={rawSettings?.imageWidth ?? 256}
              onSlidingComplete={(value) => updateSettings({ imageWidth: value, imageHeight: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surface}
              thumbTintColor={COLORS.primary}
            />
          </View>

          {/* Detection Method (only show if auto mode is enabled) */}
          {rawSettings?.imageGenerationMode === 'auto' && (
            <View style={styles.settingSection}>
              <Text style={styles.settingLabel}>Detection Method</Text>
              <Text style={styles.settingDesc}>
                {rawSettings?.autoDetectMethod === 'pattern'
                  ? 'Fast keyword matching'
                  : 'Uses text model for classification'}
              </Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[
                    styles.optionButton,
                    rawSettings?.autoDetectMethod === 'pattern' && styles.optionButtonActive,
                  ]}
                  onPress={() => updateSettings({ autoDetectMethod: 'pattern' })}
                >
                  <Text
                    style={[
                      styles.optionButtonText,
                      rawSettings?.autoDetectMethod === 'pattern' && styles.optionButtonTextActive,
                    ]}
                  >
                    Pattern
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.optionButton,
                    rawSettings?.autoDetectMethod === 'llm' && styles.optionButtonActive,
                  ]}
                  onPress={() => updateSettings({ autoDetectMethod: 'llm' })}
                >
                  <Text
                    style={[
                      styles.optionButtonText,
                      rawSettings?.autoDetectMethod === 'llm' && styles.optionButtonTextActive,
                    ]}
                  >
                    LLM
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Enhance Image Prompts */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>Enhance Image Prompts</Text>
              <Text style={styles.toggleDesc}>
                {rawSettings?.enhanceImagePrompts
                  ? 'Text model refines your prompt before image generation (slower but better results)'
                  : 'Use your prompt directly for image generation (faster)'}
              </Text>
            </View>
            <Switch
              value={rawSettings?.enhanceImagePrompts ?? false}
              onValueChange={(value) => updateSettings({ enhanceImagePrompts: value })}
              trackColor={{ false: COLORS.surfaceLight, true: COLORS.primary + '80' }}
              thumbColor={rawSettings?.enhanceImagePrompts ? COLORS.primary : COLORS.textMuted}
            />
          </View>
        </Card>

        {/* Text Generation Settings */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Text Generation</Text>
          <Text style={styles.settingHelp}>
            Configure LLM behavior for text responses.
          </Text>

          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Temperature</Text>
              <Text style={styles.sliderValue}>{(rawSettings?.temperature || 0.7).toFixed(2)}</Text>
            </View>
            <Text style={styles.sliderDesc}>Higher = more creative, Lower = more focused</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={2}
              step={0.05}
              value={rawSettings?.temperature || 0.7}
              onSlidingComplete={(value) => updateSettings({ temperature: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surface}
              thumbTintColor={COLORS.primary}
            />
          </View>

          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Max Tokens</Text>
              <Text style={styles.sliderValue}>
                {(rawSettings?.maxTokens || 512) >= 1024
                  ? `${((rawSettings?.maxTokens || 512) / 1024).toFixed(1)}K`
                  : rawSettings?.maxTokens || 512}
              </Text>
            </View>
            <Text style={styles.sliderDesc}>Maximum response length</Text>
            <Slider
              style={styles.slider}
              minimumValue={64}
              maximumValue={8192}
              step={64}
              value={rawSettings?.maxTokens || 512}
              onSlidingComplete={(value) => updateSettings({ maxTokens: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surface}
              thumbTintColor={COLORS.primary}
            />
          </View>

          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Top P</Text>
              <Text style={styles.sliderValue}>{(rawSettings?.topP || 0.9).toFixed(2)}</Text>
            </View>
            <Text style={styles.sliderDesc}>Nucleus sampling threshold</Text>
            <Slider
              style={styles.slider}
              minimumValue={0.1}
              maximumValue={1.0}
              step={0.05}
              value={rawSettings?.topP || 0.9}
              onSlidingComplete={(value) => updateSettings({ topP: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surface}
              thumbTintColor={COLORS.primary}
            />
          </View>

          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Repeat Penalty</Text>
              <Text style={styles.sliderValue}>{(rawSettings?.repeatPenalty || 1.1).toFixed(2)}</Text>
            </View>
            <Text style={styles.sliderDesc}>Penalize repeated tokens</Text>
            <Slider
              style={styles.slider}
              minimumValue={1.0}
              maximumValue={2.0}
              step={0.05}
              value={rawSettings?.repeatPenalty || 1.1}
              onSlidingComplete={(value) => updateSettings({ repeatPenalty: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surface}
              thumbTintColor={COLORS.primary}
            />
          </View>

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>Show Generation Details</Text>
              <Text style={styles.toggleDesc}>
                Display tokens/sec, timing, and memory usage on responses
              </Text>
            </View>
            <Switch
              value={rawSettings?.showGenerationDetails ?? false}
              onValueChange={(value) => updateSettings({ showGenerationDetails: value })}
              trackColor={{ false: COLORS.surfaceLight, true: COLORS.primary + '80' }}
              thumbColor={rawSettings?.showGenerationDetails ? COLORS.primary : COLORS.textMuted}
            />
          </View>

          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Context Length</Text>
              <Text style={styles.sliderValue}>
                {(rawSettings?.contextLength || 2048) >= 1024
                  ? `${((rawSettings?.contextLength || 2048) / 1024).toFixed(1)}K`
                  : rawSettings?.contextLength || 2048}
              </Text>
            </View>
            <Text style={styles.sliderDesc}>Max conversation memory (requires reload)</Text>
            <Slider
              style={styles.slider}
              minimumValue={512}
              maximumValue={32768}
              step={512}
              value={rawSettings?.contextLength || 2048}
              onSlidingComplete={(value) => updateSettings({ contextLength: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surface}
              thumbTintColor={COLORS.primary}
            />
          </View>
        </Card>

        {/* Performance Settings */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Performance</Text>
          <Text style={styles.settingHelp}>
            Tune inference speed and memory usage.
          </Text>

          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>CPU Threads</Text>
              <Text style={styles.sliderValue}>{rawSettings?.nThreads || 6}</Text>
            </View>
            <Text style={styles.sliderDesc}>Parallel threads for inference</Text>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={12}
              step={1}
              value={rawSettings?.nThreads || 6}
              onSlidingComplete={(value) => updateSettings({ nThreads: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surface}
              thumbTintColor={COLORS.primary}
            />
          </View>

          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Batch Size</Text>
              <Text style={styles.sliderValue}>{rawSettings?.nBatch || 256}</Text>
            </View>
            <Text style={styles.sliderDesc}>Tokens processed per batch</Text>
            <Slider
              style={styles.slider}
              minimumValue={32}
              maximumValue={512}
              step={32}
              value={rawSettings?.nBatch || 256}
              onSlidingComplete={(value) => updateSettings({ nBatch: value })}
              minimumTrackTintColor={COLORS.primary}
              maximumTrackTintColor={COLORS.surface}
              thumbTintColor={COLORS.primary}
            />
          </View>

          {Platform.OS !== 'ios' && (
            <>
              <View style={styles.toggleRow}>
                <View style={styles.toggleInfo}>
                  <Text style={styles.toggleLabel}>GPU Acceleration</Text>
                  <Text style={styles.toggleDesc}>
                    Offload model layers to GPU. Requires model reload.
                  </Text>
                </View>
                <Switch
                  value={rawSettings?.enableGpu !== false}
                  onValueChange={(value) => updateSettings({ enableGpu: value })}
                  trackColor={{ false: COLORS.surfaceLight, true: COLORS.primary + '80' }}
                  thumbColor={rawSettings?.enableGpu !== false ? COLORS.primary : COLORS.textMuted}
                />
              </View>

              {rawSettings?.enableGpu !== false && (
                <View style={styles.sliderSection}>
                  <View style={styles.sliderHeader}>
                    <Text style={styles.sliderLabel}>GPU Layers</Text>
                    <Text style={styles.sliderValue}>{rawSettings?.gpuLayers ?? 6}</Text>
                  </View>
                  <Text style={styles.sliderDesc}>
                    Layers offloaded to GPU. Higher = faster but may crash on low-VRAM devices.
                  </Text>
                  <Slider
                    style={styles.slider}
                    minimumValue={1}
                    maximumValue={99}
                    step={1}
                    value={rawSettings?.gpuLayers ?? 6}
                    onSlidingComplete={(value) => updateSettings({ gpuLayers: value })}
                    minimumTrackTintColor={COLORS.primary}
                    maximumTrackTintColor={COLORS.surface}
                    thumbTintColor={COLORS.primary}
                  />
                </View>
              )}
            </>
          )}

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>Model Loading Strategy</Text>
              <Text style={styles.toggleDesc}>
                {rawSettings?.modelLoadingStrategy === 'performance'
                  ? 'Keep models loaded for faster responses'
                  : 'Load models on demand to save memory'}
              </Text>
            </View>
          </View>
          <View style={styles.strategyButtons}>
            <TouchableOpacity
              style={[
                styles.strategyButton,
                rawSettings?.modelLoadingStrategy === 'memory' && styles.strategyButtonActive,
              ]}
              onPress={() => updateSettings({ modelLoadingStrategy: 'memory' })}
            >
              <Text
                style={[
                  styles.strategyButtonText,
                  rawSettings?.modelLoadingStrategy === 'memory' && styles.strategyButtonTextActive,
                ]}
              >
                Save Memory
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.strategyButton,
                rawSettings?.modelLoadingStrategy === 'performance' && styles.strategyButtonActive,
              ]}
              onPress={() => updateSettings({ modelLoadingStrategy: 'performance' })}
            >
              <Text
                style={[
                  styles.strategyButtonText,
                  rawSettings?.modelLoadingStrategy === 'performance' && styles.strategyButtonTextActive,
                ]}
              >
                Fast
              </Text>
            </TouchableOpacity>
          </View>
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
  sectionTitle: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase',
    color: COLORS.textMuted,
    marginBottom: SPACING.md,
    letterSpacing: 0.3,
  },
  settingHelp: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textMuted,
    marginBottom: SPACING.md,
    lineHeight: 18,
  },
  textArea: {
    ...TYPOGRAPHY.bodySmall,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    color: COLORS.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  toggleInfo: {
    flex: 1,
    marginRight: SPACING.md,
  },
  toggleLabel: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
  },
  toggleDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textMuted,
    marginTop: 2,
    lineHeight: 18,
  },
  toggleNote: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textMuted,
    lineHeight: 18,
    backgroundColor: COLORS.surfaceLight,
    padding: SPACING.md,
    borderRadius: 8,
  },
  sliderSection: {
    marginTop: SPACING.lg,
    paddingTop: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  sliderLabel: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
  },
  sliderValue: {
    ...TYPOGRAPHY.body,
    fontWeight: '400',
    color: COLORS.primary,
  },
  sliderDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textMuted,
    marginBottom: SPACING.sm,
    lineHeight: 18,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  strategyButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  strategyButton: {
    flex: 1,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: 8,
    backgroundColor: 'transparent',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  strategyButtonActive: {
    borderColor: COLORS.primary,
    backgroundColor: 'transparent',
  },
  strategyButtonText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  strategyButtonTextActive: {
    color: COLORS.primary,
  },
  settingSection: {
    marginTop: SPACING.lg,
  },
  settingLabel: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  settingDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textMuted,
    marginBottom: SPACING.md,
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  optionButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: 8,
    backgroundColor: 'transparent',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  optionButtonActive: {
    borderColor: COLORS.primary,
    backgroundColor: 'transparent',
  },
  optionButtonText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  optionButtonTextActive: {
    color: COLORS.primary,
  },
});
