import { DEFAULT_SETTINGS } from '../stores/appStore';
import { selectIsLiteRT, useAppStore } from '../stores';
import {
  MIN_TEXT_CONTEXT_TOKENS,
  MIN_TEXT_OUTPUT_TOKENS,
  TEXT_SETTING_CONSTRAINTS,
  liteRTSettingLimits,
  textSettingLimits,
  updateTextContextLength,
  updateTextOutputTokens,
} from '@offgrid/models';

export interface NumericSettingModel {
  key: string;
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  formatValue?: (value: number) => string;
  warning?: string | null;
  onChange: (value: number) => void;
}

const formatContext = (value: number): string =>
  value >= 1024 ? `${(value / 1024).toFixed(0)}K` : String(value);

const formatMaxTokens = (value: number): string =>
  value >= 1024 ? `${(value / 1024).toFixed(1)}K` : String(value);

/**
 * One headless settings model for both text-generation settings surfaces.
 * The app store owns selected values. Loaded model metadata owns both maxima.
 * Each surface owns only its layout and presentation.
 */
export function useTextGenerationSettings() {
  const isLiteRT = useAppStore(selectIsLiteRT);
  const settings = useAppStore(state => state.settings);
  const updateSettings = useAppStore(state => state.updateSettings);
  const modelMaxContext = useAppStore(state => state.modelMaxContext);

  const temperature = settings.temperature ?? DEFAULT_SETTINGS.temperature;
  const maxTokens = settings.maxTokens ?? DEFAULT_SETTINGS.maxTokens;
  const maxToolCalls = settings.maxToolCalls ?? DEFAULT_SETTINGS.maxToolCalls;
  const contextLength =
    settings.contextLength ?? DEFAULT_SETTINGS.contextLength;
  const topP = settings.topP ?? DEFAULT_SETTINGS.topP;
  const repeatPenalty =
    settings.repeatPenalty ?? DEFAULT_SETTINGS.repeatPenalty;
  const llamaLimits = textSettingLimits({
    contextLength,
    maxTokens,
    modelMaxContext,
  });

  const liteRTTemperature =
    settings.liteRTTemperature ?? DEFAULT_SETTINGS.liteRTTemperature;
  const liteRTMaxTokens =
    settings.liteRTMaxTokens ?? DEFAULT_SETTINGS.liteRTMaxTokens;
  const liteRTTopP = settings.liteRTTopP ?? DEFAULT_SETTINGS.liteRTTopP;
  const liteRTLimits = liteRTSettingLimits({
    maxTokens: liteRTMaxTokens,
    modelMaxContext,
  });

  const toolCalls = {
    key: 'maxToolCalls',
    label: 'Maximum Tool Calls',
    description: 'Emergency limit for tool calls in one response',
    value: maxToolCalls,
    ...TEXT_SETTING_CONSTRAINTS.maxToolCalls,
    decimals: 0,
    onChange: (value: number) =>
      updateSettings({ maxToolCalls: Math.round(value) }),
  } satisfies NumericSettingModel;

  const llama = {
    temperature: {
      key: 'temperature',
      label: 'Temperature',
      description: 'Higher = more creative, Lower = more focused',
      value: temperature,
      ...TEXT_SETTING_CONSTRAINTS.temperature,
      decimals: 2,
      onChange: (value: number) => updateSettings({ temperature: value }),
    },
    maxTokens: {
      key: 'maxTokens',
      label: 'Max Tokens',
      description: 'Maximum length of generated response',
      // Clamped for DISPLAY too: a value stored by an older build (or before the context came
      // down) must not render past the end of its own slider.
      value: llamaLimits.outputValue,
      min: MIN_TEXT_OUTPUT_TOKENS,
      max: llamaLimits.outputMaximum,
      step: 64,
      formatValue: formatMaxTokens,
      // Clamped on WRITE as well as on display: the slider cannot reach an illegal value, but
      // nothing else should be able to store one either.
      onChange: (value: number) =>
        updateSettings(updateTextOutputTokens(value, contextLength)),
    },
    contextLength: {
      key: 'contextLength',
      label: 'Context Length',
      description: 'KV cache size - larger uses more RAM (requires reload)',
      value: contextLength,
      min: MIN_TEXT_CONTEXT_TOKENS,
      max: llamaLimits.contextMaximum,
      step: 1024,
      formatValue: formatContext,
      warning: llamaLimits.contextWarning,
      // Lowering the context lowers what can be written into it. Without this the stored output
      // length silently stays above its own ceiling.
      onChange: (value: number) =>
        updateSettings(updateTextContextLength(value, maxTokens)),
    },
    topP: {
      key: 'topP',
      label: 'Top P',
      description: 'Nucleus sampling threshold',
      value: topP,
      ...TEXT_SETTING_CONSTRAINTS.topP,
      decimals: 2,
      onChange: (value: number) => updateSettings({ topP: value }),
    },
    repeatPenalty: {
      key: 'repeatPenalty',
      label: 'Repeat Penalty',
      description: 'Penalize repeated tokens',
      value: repeatPenalty,
      ...TEXT_SETTING_CONSTRAINTS.repeatPenalty,
      decimals: 2,
      onChange: (value: number) => updateSettings({ repeatPenalty: value }),
    },
  } satisfies Record<string, NumericSettingModel>;

  const liteRT = {
    temperature: {
      key: 'liteRTTemperature',
      label: 'Temperature',
      description: 'Higher = more creative, Lower = more focused',
      value: liteRTTemperature,
      ...TEXT_SETTING_CONSTRAINTS.temperature,
      decimals: 2,
      onChange: (value: number) => updateSettings({ liteRTTemperature: value }),
    },
    maxTokens: {
      key: 'liteRTMaxTokens',
      label: 'Max Tokens',
      description:
        'Total token budget - input, history, and output combined (requires reload)',
      value: liteRTMaxTokens,
      min: MIN_TEXT_CONTEXT_TOKENS,
      max: liteRTLimits.contextMaximum,
      step: 1024,
      formatValue: formatContext,
      warning: liteRTLimits.warning,
      onChange: (value: number) => updateSettings({ liteRTMaxTokens: value }),
    },
    topP: {
      key: 'liteRTTopP',
      label: 'Top P',
      description: 'Nucleus sampling threshold',
      value: liteRTTopP,
      ...TEXT_SETTING_CONSTRAINTS.topP,
      decimals: 2,
      onChange: (value: number) => updateSettings({ liteRTTopP: value }),
    },
  } satisfies Record<string, NumericSettingModel>;

  return { isLiteRT, llama, liteRT, toolCalls };
}
