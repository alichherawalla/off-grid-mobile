/**
 * GenerationSettingsModal - the chat settings sheet over the REAL stores, services, and shared
 * selection owner. Fakes sit only at the device boundary: the native llama runtime (performance
 * stats), the hardware probe, the sheet host, and the native slider.
 *
 * Every outcome is read where the user would see it: the rendered sheet, or the persisted setting
 * the sheet wrote.
 */
import type ReactType from 'react';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import type { NativeBoundary } from '../../harness/nativeBoundary';

jest.mock('@react-native-community/slider', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) =>
      React.createElement(View, { ...props, testID: props.testID || 'slider' }),
  };
});

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

let boundary: NativeBoundary;
let fixture: MobileApplicationFixture;
let React: typeof ReactType;
let render: typeof import('@testing-library/react-native').render;
let fireEvent: typeof import('@testing-library/react-native').fireEvent;
let GenerationSettingsModal: typeof import('../../../src/components/GenerationSettingsModal').GenerationSettingsModal;
let useAppStore: typeof import('../../../src/stores/appStore').useAppStore;
let DEFAULT_SETTINGS: typeof import('../../../src/stores/appStore').DEFAULT_SETTINGS;
let llmService: typeof import('../../../src/services/llm').llmService;

type ModalProps = ReactType.ComponentProps<
  typeof import('../../../src/components/GenerationSettingsModal').GenerationSettingsModal
>;

const modal = (props: ModalProps = defaultProps) =>
  React.createElement(GenerationSettingsModal, props);
const settings = () => useAppStore.getState().settings;

describe('GenerationSettingsModal', () => {
  beforeAll(async () => {
    const native =
      require('../../harness/nativeBoundary') as typeof import('../../harness/nativeBoundary');
    boundary = native.installNativeBoundary({ llama: true, fs: true });
    React = require('react');
    ({ render, fireEvent } = native.requireRTL());
    ({
      GenerationSettingsModal,
    } = require('../../../src/components/GenerationSettingsModal'));
    ({
      useAppStore,
      DEFAULT_SETTINGS,
    } = require('../../../src/stores/appStore'));
    ({ llmService } = require('../../../src/services/llm'));
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture();
    const modelPath = `${
      boundary.fs!.DocumentDirectoryPath
    }/models/settings.gguf`;
    boundary.fs!.seedFile(modelPath, 500 * 1024 * 1024);
    const initLlama = boundary.llama!.module.initLlama;
    const nativeInit = initLlama.getMockImplementation()!;
    initLlama.mockImplementation(async (...args: unknown[]) => {
      const context = await nativeInit(...args);
      context.model.metadata['general.architecture'] = 'llama';
      context.model.metadata['llama.context_length'] = '262144';
      return context;
    });
    await llmService.loadModel(modelPath);
  });

  afterAll(async () => {
    await llmService.unloadModel();
    await fixture.dispose();
  }, 30_000);

  beforeEach(() => {
    ({ render, fireEvent } =
      require('../../harness/nativeBoundary').requireRTL());
    jest.clearAllMocks();
    useAppStore.getState().resetSettings();
    useAppStore.getState().updateSettings(settingsUnderTest);
  });

  it('returns null when not visible', () => {
    const { queryByText } = render(modal({ ...defaultProps, visible: false }));
    expect(queryByText('Chat Settings')).toBeNull();
  });

  it('renders "Chat Settings" title when visible', () => {
    const { getByText } = render(modal());
    expect(getByText('Chat Settings')).toBeTruthy();
  });

  it('shows conversation actions when callbacks are provided', () => {
    const { getByText } = render(
      modal({
        ...defaultProps,
        onOpenProject: jest.fn(),
        onOpenGallery: jest.fn(),
        onDeleteConversation: jest.fn(),
        conversationImageCount: 3,
      }),
    );
    expect(getByText(/Project:/)).toBeTruthy();
    expect(getByText('Gallery (3)')).toBeTruthy();
    expect(getByText('Delete Conversation')).toBeTruthy();
  });

  it('hides Gallery action when conversationImageCount is 0', () => {
    const { queryByText } = render(
      modal({
        ...defaultProps,
        onOpenGallery: jest.fn(),
        conversationImageCount: 0,
      }),
    );
    expect(queryByText(/Gallery/)).toBeNull();
  });

  it('shows performance stats after the native model completes a generation', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValueOnce(1_000).mockReturnValue(4_200);
    boundary.llama!.scriptCompletion({ text: 'done' });
    await llmService.runNativeCompletion([
      { id: 'user-1', role: 'user', content: 'hello', timestamp: 0 },
    ]);
    now.mockRestore();

    const { getByText } = render(modal());
    expect(getByText('Last Generation:')).toBeTruthy();
    expect(getByText('1.3 tok/s')).toBeTruthy();
    expect(getByText('4 tokens')).toBeTruthy();
    expect(getByText('3.2s')).toBeTruthy();
  });

  it('opens image settings section when tapping "IMAGE GENERATION"', () => {
    const { getByText, queryByText } = render(modal());
    expect(queryByText('Image Model')).toBeNull();
    fireEvent.press(getByText('IMAGE GENERATION'));
    expect(getByText('Image Model')).toBeTruthy();
  });

  it('opens text settings section when tapping "TEXT GENERATION"', () => {
    const { getByText, queryByText } = render(modal());
    expect(queryByText('Temperature')).toBeNull();
    fireEvent.press(getByText('TEXT GENERATION'));
    expect(getByText('Temperature')).toBeTruthy();
    expect(getByText('Max Tokens')).toBeTruthy();
  });

  it('lets context reach the model 262K limit and caps max tokens at the context', () => {
    const { getByText, getByTestId } = render(modal());
    fireEvent.press(getByText('TEXT GENERATION'));
    // Output cannot exceed the context that has to hold it, so this surface stops the max-tokens
    // slider at the chosen context while context itself may reach the model's trained ceiling.
    expect(getByTestId('setting-maxTokens-slider').props.maximumValue).toBe(
      settings().contextLength,
    );
    expect(getByTestId('setting-contextLength-slider').props.maximumValue).toBe(
      262144,
    );
  });

  it('shows performance settings inside TEXT GENERATION section', () => {
    const { getByText, getByTestId, queryByText } = render(modal());
    expect(queryByText('CPU Threads')).toBeNull();
    fireEvent.press(getByText('TEXT GENERATION'));
    fireEvent.press(getByTestId('modal-text-advanced-toggle'));
    expect(getByText('CPU Threads')).toBeTruthy();
  });

  it('resets every setting to its default when Reset to Defaults is pressed', () => {
    useAppStore
      .getState()
      .updateSettings({ temperature: 0.2, imageGenerationMode: 'manual' });
    const { getByText } = render(modal());
    fireEvent.press(getByText('Reset to Defaults'));
    expect(settings().temperature).toBe(DEFAULT_SETTINGS.temperature);
    expect(settings().imageGenerationMode).toBe(
      DEFAULT_SETTINGS.imageGenerationMode,
    );
  });

  it('shows the shared STT model setting in chat settings', () => {
    const { getByText, getByTestId, queryByText } = render(modal());
    expect(queryByText('Transcription model')).toBeNull();
    fireEvent.press(getByTestId('modal-transcription-accordion'));
    expect(getByText('Transcription model')).toBeTruthy();
    expect(getByText('No model selected. Tap to choose.')).toBeTruthy();
    expect(getByTestId('modal-stt-open-picker')).toBeTruthy();
  });

  it('persists the image generation mode when Auto/Manual is pressed', () => {
    const { getByText } = render(modal());
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
      modal({ ...defaultProps, onClose, onDeleteConversation }),
    );
    fireEvent.press(getByText('Delete Conversation'));
    expect(onClose).toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(onDeleteConversation).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('shows active project name in Project action', () => {
    const { getByText } = render(
      modal({
        ...defaultProps,
        onOpenProject: jest.fn(),
        activeProjectName: 'My Project',
      }),
    );
    expect(getByText('Project: My Project')).toBeTruthy();
  });

  it('shows auto-detection method when image settings open and mode is auto', () => {
    const { getByText, getByTestId } = render(modal());
    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    expect(getByText('Detection Method')).toBeTruthy();
    expect(getByText('Pattern')).toBeTruthy();
    expect(getByText('LLM')).toBeTruthy();
  });

  it('persists the auto-detect method when changed to LLM and back to Pattern', () => {
    const { getByText, getByTestId } = render(modal());
    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    fireEvent.press(getByText('LLM'));
    expect(settings().autoDetectMethod).toBe('llm');
    fireEvent.press(getByText('Pattern'));
    expect(settings().autoDetectMethod).toBe('pattern');
  });

  it('hides detection method when image gen mode is manual', () => {
    useAppStore.getState().updateSettings({ imageGenerationMode: 'manual' });
    const { getByText, queryByText } = render(modal());
    fireEvent.press(getByText('IMAGE GENERATION'));
    expect(queryByText('Detection Method')).toBeNull();
  });

  it('shows classifier model picker when auto + llm mode', () => {
    useAppStore.getState().updateSettings({ autoDetectMethod: 'llm' });
    const { getByText, getByTestId } = render(modal());
    fireEvent.press(getByText('IMAGE GENERATION'));
    fireEvent.press(getByTestId('modal-image-advanced-toggle'));
    expect(getByText('Classifier Model')).toBeTruthy();
    expect(getByText('Use current model')).toBeTruthy();
  });

  it('hides classifier model picker when auto + pattern mode', () => {
    const { getByText, queryByText } = render(modal());
    fireEvent.press(getByText('IMAGE GENERATION'));
    expect(queryByText('Classifier Model')).toBeNull();
  });
});
