import React, { useState } from 'react';
import { isFastClassifierModel } from '@offgrid/application';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AdvancedToggle } from '../AdvancedToggle';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { useActiveMobileModel } from '../../hooks/useActiveMobileModel';
import {
  clearMobileModel,
  hardwareService,
  selectMobileModel,
} from '../../services';
import { createStyles } from './styles';
import {
  ImageQualityBasicSliders,
  ImageQualityAdvancedSliders,
} from './ImageQualitySliders';

// ─── Image Model Picker ───────────────────────────────────────────────────────

const ImageModelPicker: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const downloadedImageModels = useAppStore(s => s.downloadedImageModels);
  const [showPicker, setShowPicker] = useState(false);
  // One answer to "which image model": the shared active route, local or a paired Mac's.
  const activeRoute = useActiveMobileModel('image').model;
  const activeImageModelId = activeRoute?.source === 'local' ? activeRoute.id : null;
  const activeImageModel = activeRoute
    ? { name: activeRoute.source === 'remote' ? `${activeRoute.name} (remote)` : activeRoute.name }
    : undefined;

  const handleSelectNone = () => {
    clearMobileModel('image').catch(() => undefined);
    setShowPicker(false);
  };

  return (
    <>
      <TouchableOpacity
        style={styles.modelPickerButton}
        onPress={() => setShowPicker(!showPicker)}
      >
        <View style={styles.modelPickerContent}>
          <Text style={styles.modelPickerLabel}>Image Model</Text>
          <Text style={styles.modelPickerValue}>
            {activeImageModel?.name || 'None selected'}
          </Text>
        </View>
        <Icon
          name={showPicker ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {showPicker && (
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
                  !activeRoute && styles.modelPickerItemActive,
                ]}
                onPress={handleSelectNone}
              >
                <Text style={styles.modelPickerItemText}>
                  None (disable image gen)
                </Text>
                {!activeRoute && (
                  <Icon name="check" size={18} color={colors.primary} />
                )}
              </TouchableOpacity>
              {downloadedImageModels.map(model => {
                const isActive = activeImageModelId === model.id;
                const handleSelect = () => {
                  selectMobileModel({
                    source: 'local',
                    hostId: model.backend ?? 'image-runtime',
                    modality: 'image',
                    modelId: model.id,
                  }).catch(() => undefined);
                  setShowPicker(false);
                };
                return (
                  <TouchableOpacity
                    key={model.id}
                    style={[
                      styles.modelPickerItem,
                      isActive && styles.modelPickerItemActive,
                    ]}
                    onPress={handleSelect}
                  >
                    <View>
                      <Text style={styles.modelPickerItemText}>
                        {model.name}
                      </Text>
                      <Text style={styles.modelPickerItemDesc}>
                        {model.style}
                      </Text>
                    </View>
                    {isActive && (
                      <Icon name="check" size={18} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </View>
      )}
    </>
  );
};

// ─── Auto-Detect Method Toggle ────────────────────────────────────────────────

const AutoDetectMethodToggle: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const autoDetectMethod = useAppStore(s => s.settings.autoDetectMethod);
  const updateSettings = useAppStore(s => s.updateSettings);

  return (
    <View style={styles.modeToggleContainer}>
      <View style={styles.modeToggleInfo}>
        <Text style={styles.modeToggleLabel}>Detection Method</Text>
        <Text style={styles.modeToggleDesc}>
          {autoDetectMethod === 'pattern'
            ? 'Fast keyword matching ("draw", "create image", etc.)'
            : 'Uses current text model for uncertain cases (slower)'}
        </Text>
      </View>
      <View style={styles.modeToggleButtons}>
        <TouchableOpacity
          style={[
            styles.modeButton,
            autoDetectMethod === 'pattern' && styles.modeButtonActive,
          ]}
          onPress={() => updateSettings({ autoDetectMethod: 'pattern' })}
          testID="auto-detect-method-pattern"
        >
          <Text
            style={[
              styles.modeButtonText,
              autoDetectMethod === 'pattern' &&
                styles.modeButtonTextActive,
            ]}
          >
            Pattern
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.modeButton,
            autoDetectMethod === 'llm' && styles.modeButtonActive,
          ]}
          onPress={() => updateSettings({ autoDetectMethod: 'llm' })}
          testID="auto-detect-method-llm"
        >
          <Text
            style={[
              styles.modeButtonText,
              autoDetectMethod === 'llm' &&
                styles.modeButtonTextActive,
            ]}
          >
            LLM
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ─── Classifier Model Picker ──────────────────────────────────────────────────

const ClassifierModelPicker: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const downloadedModels = useAppStore(s => s.downloadedModels);
  const classifierModelId = useAppStore(s => s.settings.classifierModelId);
  const [showPicker, setShowPicker] = useState(false);
  const classifierModel = downloadedModels.find(
    m => m.id === classifierModelId,
  );

  const handleSelectNone = () => {
    clearMobileModel('classifier').catch(() => undefined);
    setShowPicker(false);
  };

  return (
    <>
      <TouchableOpacity
        style={styles.modelPickerButton}
        onPress={() => setShowPicker(!showPicker)}
      >
        <View style={styles.modelPickerContent}>
          <Text style={styles.modelPickerLabel}>Classifier Model</Text>
          <Text style={styles.modelPickerValue}>
            {classifierModel?.name || 'Use current model'}
          </Text>
        </View>
        <Icon
          name={showPicker ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {showPicker && (
        <View style={styles.modelPickerList}>
          <TouchableOpacity
            style={[
              styles.modelPickerItem,
              !classifierModelId && styles.modelPickerItemActive,
            ]}
            onPress={handleSelectNone}
          >
            <View>
              <Text style={styles.modelPickerItemText}>Use current model</Text>
              <Text style={styles.modelPickerItemDesc}>
                No model switching needed
              </Text>
            </View>
            {!classifierModelId && (
              <Icon name="check" size={18} color={colors.primary} />
            )}
          </TouchableOpacity>
          {downloadedModels.map(model => {
            const isActive = classifierModelId === model.id;
            const handleSelect = () => {
              selectMobileModel({
                source: 'local',
                hostId: model.engine,
                modality: 'classifier',
                modelId: model.id,
              }).catch(() => undefined);
              setShowPicker(false);
            };
            const isFast = isFastClassifierModel(model.id);
            return (
              <TouchableOpacity
                key={model.id}
                style={[
                  styles.modelPickerItem,
                  isActive && styles.modelPickerItemActive,
                ]}
                onPress={handleSelect}
              >
                <View style={styles.flex1}>
                  <Text style={styles.modelPickerItemText}>{model.name}</Text>
                  <Text style={styles.modelPickerItemDesc}>
                    {hardwareService.formatModelSize(model)}
                    {isFast && ' • Fast'}
                  </Text>
                </View>
                {isActive && (
                  <Icon name="check" size={18} color={colors.primary} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      <Text style={styles.classifierNote}>
        Tip: Use a small model (SmolLM) for fast classification
      </Text>
    </>
  );
};

// ─── Advanced Section ────────────────────────────────────────────────────────

const ImageAdvancedSection: React.FC = () => {
  const imageGenerationMode = useAppStore(s => s.settings.imageGenerationMode);
  const autoDetectMethod = useAppStore(s => s.settings.autoDetectMethod);
  const isAutoMode = imageGenerationMode === 'auto';
  const isLlmDetect = autoDetectMethod === 'llm';

  return (
    <>
      <ImageQualityAdvancedSliders />
      {isAutoMode && <AutoDetectMethodToggle />}
      {isAutoMode && isLlmDetect && <ClassifierModelPicker />}
    </>
  );
};

// ─── Prompt enhancement ──────────────────────────────────

/** A first-level choice, not an advanced one: it decides whether a text model runs before every image. */
const ImagePromptEnhancementToggle: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const enhanceImagePrompts = useAppStore(s => s.settings.enhanceImagePrompts);
  const updateSettings = useAppStore(s => s.updateSettings);
  // Prompt enhancement runs a text model, so it needs one available. Only the COUNT matters here,
  // and it is compared in the selector, so adding a model wakes this row only when it crosses zero.
  const hasTextModel = useAppStore(s => s.downloadedModels.length > 0);
  const enhanceOn = enhanceImagePrompts && hasTextModel;

  return (
    <>
      <View
        style={[styles.modeToggleContainer, !hasTextModel && styles.dimmed]}
      >
        <View style={styles.modeToggleInfo}>
          <Text style={styles.modeToggleLabel}>Enhance Image Prompts</Text>
          <Text style={styles.modeToggleDesc}>
            {!hasTextModel
              ? 'Download a text model to enable prompt enhancement'
              : enhanceOn
              ? 'Text model refines your prompt before image generation (slower but better results)'
              : 'Use your prompt directly for image generation (faster)'}
          </Text>
        </View>
        <View style={styles.modeToggleButtons}>
          <TouchableOpacity
            style={[styles.modeButton, !enhanceOn && styles.modeButtonActive]}
            onPress={() => updateSettings({ enhanceImagePrompts: false })}
            testID="image-enhance-off"
          >
            <Text
              style={[
                styles.modeButtonText,
                !enhanceOn && styles.modeButtonTextActive,
              ]}
            >
              Off
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, enhanceOn && styles.modeButtonActive]}
            disabled={!hasTextModel}
            onPress={() => updateSettings({ enhanceImagePrompts: true })}
            testID="image-enhance-on"
          >
            <Text
              style={[
                styles.modeButtonText,
                enhanceOn && styles.modeButtonTextActive,
              ]}
            >
              On
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
};

// ─── Main Section ─────────────────────────────────────────────────────────────

export const ImageGenerationSection: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const updateSettings = useAppStore(s => s.updateSettings);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isAutoMode = useAppStore(
    s => s.settings.imageGenerationMode === 'auto',
  );

  return (
    <View style={styles.sectionCard}>
      <ImageModelPicker />

      {/* Image Generation Mode Toggle */}
      <View style={styles.modeToggleContainer}>
        <View style={styles.modeToggleInfo}>
          <Text style={styles.modeToggleLabel}>Auto-detect image requests</Text>
          <Text style={styles.modeToggleDesc}>
            {isAutoMode
              ? 'Detects when you want to generate an image'
              : 'Use image button to manually trigger image generation'}
          </Text>
        </View>
        <View style={styles.modeToggleButtons}>
          <TouchableOpacity
            style={[styles.modeButton, isAutoMode && styles.modeButtonActive]}
            onPress={() => updateSettings({ imageGenerationMode: 'auto' })}
            testID="image-gen-mode-auto"
          >
            <Text
              style={[
                styles.modeButtonText,
                isAutoMode && styles.modeButtonTextActive,
              ]}
            >
              Auto
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, !isAutoMode && styles.modeButtonActive]}
            onPress={() => updateSettings({ imageGenerationMode: 'manual' })}
            testID="image-gen-mode-manual"
          >
            <Text
              style={[
                styles.modeButtonText,
                !isAutoMode && styles.modeButtonTextActive,
              ]}
            >
              Manual
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ImageQualityBasicSliders />
      <ImagePromptEnhancementToggle />

      <AdvancedToggle
        isExpanded={showAdvanced}
        onPress={() => setShowAdvanced(!showAdvanced)}
        testID="modal-image-advanced-toggle"
      />

      {showAdvanced && <ImageAdvancedSection />}
    </View>
  );
};
