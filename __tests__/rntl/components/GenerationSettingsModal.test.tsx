/**
 * GenerationSettingsModal - the chat settings sheet over the REAL stores, services, and shared
 * selection owner. Fakes sit only at the device boundary: the native llama runtime (performance
 * stats), the hardware probe, the sheet host, and the native slider.
 *
 * Every outcome is read where the user would see it: the rendered sheet, or the persisted setting
 * the sheet wrote.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { GenerationSettingsModal } from '../../../src/components/GenerationSettingsModal';
import { useAppStore } from '../../../src/stores/appStore';
import { DEFAULT_SETTINGS } from '../../../src/stores/appStore';
import { llmService } from '../../../src/services/llm';
import { resetStores } from '../../utils/testHelpers';

jest.mock('../../../src/components/AppSheet', () => ({
  AppSheet: ({ visible, children, title }: any) => {
    if (!visible) return null;
    const { View, Text } = require('react-native');
    return (
      <View testID="app-sheet">
        <Text>{title}</Text>
        {children}
      </View>
    );
  },
}));

// The native text runtime: only its reported numbers are faked.
jest.mock('../../../src/services/llm');
// The device probe.
jest.mock('../../../src/services/hardware', () => ({
  hardwareService: {
    formatModelSize: jest.fn(() => '4.0 GB'),
    getTotalMemoryGB: jest.fn().mockReturnValue(8),
    getAvailableMemoryGB: jest.fn().mockReturnValue(4),
    getRecommendedThreadCount: jest.fn().mockResolvedValue(4),
    refreshMemoryInfo: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@react-native-community/slider', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => <View testID={props.testID || 'slider'} {...props} />,
  };
});

const mockLlm = llmService as jest.Mocked<typeof llmService>;

const settingsUnderTest = {
  imageGenerationMode: 'auto' as const,
  autoDetectMethod: 'pattern' as const,
  enhanceImagePrompts: false,
  temperature: 0.7,
  maxTokens: 1024,
  topP: 0.9,
  repeatPenalty: 1.1,
  contextLength: 4096,
  nThreads: 0,
  nBatch: 512,
  enableGpu: false,
  inferenceBackend: 'cpu' as const,
  gpuLayers: 99,
  flashAttn: false,
  showGenerationDetails: false,
  classifierModelId: null,
};

const defaultProps = { visible: true, onClose: jest.fn() };

const settings = () => useAppStore.getState().settings;

describe('GenerationSettingsModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStores();
    useAppStore.getState().updateSettings(settingsUnderTest);
    useAppStore.setState({ downloadedModels: [], downloadedImageModels: [], modelMaxContext: null });
    mockLlm.getPerformanceStats.mockReturnValue({
      lastTokensPerSecond: 0, lastTokenCount: 0, lastGenerationTime: 0,
    } as never);
    mockLlm.getPerformanceSettings.mockReturnValue({ contextLength: 4096 } as never);
    mockLlm.isModelLoaded.mockReturnValue(false);
  });

  it('returns null when not visible', () => {
    const { queryByTestId } = render(<GenerationSettingsModal {...defaultProps} visible={false} />);
    expect(queryByTestId('app-sheet')).toBeNull();
  });

  it('renders "Chat Settings" title when visible', () => {
    const { getByText } = render(<GenerationSettingsModal {...defaultProps} />);
    expect(getByText('Chat Settings')).toBeTruthy();
  });

  it('shows conversation actions when callbacks are provided', () => {
    const { getByText } = render(
      <GenerationSettingsModal
        {...defaultProps}
        onOpenProject={jest.fn()}
        onOpenGallery={jest.fn()}
        onDeleteConversation={jest.fn()}
        conversationImageCount={3}
      />,
    );
    expect(getByText(/Project:/)).toBeTruthy();
    expect(getByText('Gallery (3)')).toBeTruthy();
    expect(getByText('Delete Conversation')).toBeTruthy();
  });

  it('hides Gallery action when conversationImageCount is 0', () => {
    const { queryByText } = render(
      <GenerationSettingsModal {...defaultProps} onOpenGallery={jest.fn()} conversationImageCount={0} />,
    );
    expect(queryByText(/Gallery/)).toBeNull();
  });

  it('shows performance stats when lastTokensPerSecond > 0', () => {
    mockLlm.getPerformanceStats.mockReturnValue({
      lastTokensPerSecond: 12.5, lastTokenCount: 150, lastGenerationTime: 3.2,
    } as never);
    const { getByText } = render(<GenerationSettingsModal {...defaultProps} />);
    expect(getByText('Last Generation:')).toBeTruthy();
    expect(getByText('12.5 tok/s')).toBeTruthy();
    expect(getByText('150 tokens')).toBeTruthy();
    expect(getByText('3.2s')).toBeTruthy();
  });

  it('opens image settings section when tapping "IMAGE GENERATION"', () => {
    const { getByText, queryByText } = render(<GenerationSettingsModal {...defaultProps} />);
    expect(queryByText('Image Model')).toBeNull();
    fireEvent.press(getByText('IMAGE GENERATION'));
    expect(getByText('Image Model')).toBeTruthy();
  });

  it('opens text settings section when tapping "TEXT GENERATION"', () => {
    const { getByText, queryByText } = render(<GenerationSettingsModal {...defaultProps} />);
    expect(queryByText('Temperature')).toBeNull();
    fireEvent.press(getByText('TEXT GENERATION'));
    expect(getByText('Temperature')).toBeTruthy();
    expect(getByText('Max Tokens')).toBeTruthy();
  });

  it('lets context reach the model 262K limit and caps max tokens at the context', () => {
    useAppStore.setState({ modelMaxContext: 262144 });
    const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
    fireEvent.press(getByText('TEXT GENERATION'));
    // Output cannot exceed the context that has to hold it, so this surface stops the max-tokens
    // slider at the chosen context while context itself may reach the model's trained ceiling.
    expect(getByTestId('setting-maxTokens-slider').props.maximumValue).toBe(settings().contextLength);
    expect(getByTestId('setting-contextLength-slider').props.maximumValue).toBe(262144);
  });

  it('shows performance settings inside TEXT GENERATION section', () => {
    const { getByText, getByTestId, queryByText } = render(<GenerationSettingsModal {...defaultProps} />);
    expect(queryByText('CPU Threads')).toBeNull();
    fireEvent.press(getByText('TEXT GENERATION'));
    fireEvent.press(getByTestId('modal-text-advanced-toggle'));
    expect(getByText('CPU Threads')).toBeTruthy();
  });

  it('resets every setting to its default when Reset to Defaults is pressed', () => {
    useAppStore.getState().updateSettings({ temperature: 0.2, imageGenerationMode: 'manual' });
    const { getByText } = render(<GenerationSettingsModal {...defaultProps} />);
    fireEvent.press(getByText('Reset to Defaults'));
    expect(settings().temperature).toBe(DEFAULT_SETTINGS.temperature);
    expect(settings().imageGenerationMode).toBe(DEFAULT_SETTINGS.imageGenerationMode);
  });

  it('shows the shared STT model setting in chat settings', () => {
    const { getByText, getByTestId, queryByText } = render(<GenerationSettingsModal {...defaultProps} />);
    expect(queryByText('Transcription model')).toBeNull();
    fireEvent.press(getByTestId('modal-transcription-accordion'));
    expect(getByText('Transcription model')).toBeTruthy();
    expect(getByText('No model selected. Tap to choose.')).toBeTruthy();
    expect(getByTestId('modal-stt-open-picker')).toBeTruthy();
  });

  it('persists the image generation mode when Auto/Manual is pressed', () => {
    const { getByText } = render(<GenerationSettingsModal {...defaultProps} />);
    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByText('Manual'));
    expect(settings().imageGenerationMode).toBe('manual');
    fireEvent.press(getByText('Auto'));
    expect(settings().imageGenerationMode).toBe('auto');
  });

  it('calls onClose then onDeleteConversation when Delete is pressed', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    const onDeleteConversation = jest.fn();
    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} onClose={onClose} onDeleteConversation={onDeleteConversation} />,
    );
    fireEvent.press(getByText('Delete Conversation'));
    expect(onClose).toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(onDeleteConversation).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('shows active project name in Project action', () => {
    const { getByText } = render(
      <GenerationSettingsModal {...defaultProps} onOpenProject={jest.fn()} activeProjectName="My Project" />,
    );
    expect(getByText('Project: My Project')).toBeTruthy();
  });

  it('shows auto-detection method when image settings open and mode is auto', () => {
    const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    expect(getByText('Detection Method')).toBeTruthy();
    expect(getByText('Pattern')).toBeTruthy();
    expect(getByText('LLM')).toBeTruthy();
  });

  it('persists the auto-detect method when changed to LLM and back to Pattern', () => {
    const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    fireEvent.press(getByText('LLM'));
    expect(settings().autoDetectMethod).toBe('llm');
    fireEvent.press(getByText('Pattern'));
    expect(settings().autoDetectMethod).toBe('pattern');
  });

  it('hides detection method when image gen mode is manual', () => {
    useAppStore.getState().updateSettings({ imageGenerationMode: 'manual' });
    const { getByText, queryByText } = render(<GenerationSettingsModal {...defaultProps} />);
    fireEvent.press(getByText('IMAGE GENERATION'));
    expect(queryByText('Detection Method')).toBeNull();
  });

  it('shows classifier model picker when auto + llm mode', () => {
    useAppStore.getState().updateSettings({ autoDetectMethod: 'llm' });
    const { getByText, getByTestId } = render(<GenerationSettingsModal {...defaultProps} />);
    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    expect(getByText('Classifier Model')).toBeTruthy();
    expect(getByText('Use current model')).toBeTruthy();
  });

  it('hides classifier model picker when auto + pattern mode', () => {
    const { getByText, queryByText } = render(<GenerationSettingsModal {...defaultProps} />);
    fireEvent.press(getByText('IMAGE GENERATION'));
    expect(queryByText('Classifier Model')).toBeNull();
  });
});
