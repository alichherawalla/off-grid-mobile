import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render } from '@testing-library/react-native';
import { GenerationSettingsModal } from '../../../src/components/GenerationSettingsModal';
import { ModelSettingsScreen } from '../../../src/screens/ModelSettingsScreen';
import { useAppStore } from '../../../src/stores/appStore';
import { useWhisperStore } from '../../../src/stores/whisperStore';
import {
  _clearSlotsForTesting,
  registerSlot,
  SLOTS,
} from '../../../src/bootstrap/slotRegistry';
import { resetStores } from '../../utils/testHelpers';

jest.mock('@react-native-community/slider', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { View } = require('react-native');
    return <View {...props} />;
  },
}));

function renderModelSettings() {
  return render(
    <NavigationContainer>
      <ModelSettingsScreen />
    </NavigationContainer>,
  );
}

describe('model settings surface parity', () => {
  beforeEach(() => {
    resetStores();
    useAppStore.getState().setModelMaxContext(null);
    _clearSlotsForTesting();
  });

  afterEach(() => {
    _clearSlotsForTesting();
  });

  it('caps output by context on both surfaces and writes one shared setting state', () => {
    useAppStore.getState().setModelMaxContext(262144);
    // A context wide enough for the output this test chooses. Max tokens is capped BY the context,
    // so the two must be raised together or the write below is clamped away from what it means.
    useAppStore.getState().updateSettings({ contextLength: 262144 });
    const chatSettings = render(
      <GenerationSettingsModal visible onClose={() => {}} />,
    );

    fireEvent.press(chatSettings.getByText('TEXT GENERATION'));

    expect(
      chatSettings.getByTestId('setting-maxTokens-slider').props.maximumValue,
    ).toBe(262144);
    expect(
      chatSettings.getByTestId('setting-contextLength-slider').props
        .maximumValue,
    ).toBe(262144);

    fireEvent(
      chatSettings.getByTestId('setting-maxTokens-slider'),
      'slidingComplete',
      131072,
    );

    expect(useAppStore.getState().settings.maxTokens).toBe(131072);
    chatSettings.unmount();

    const modelSettings = renderModelSettings();
    fireEvent.press(modelSettings.getByTestId('text-generation-accordion'));

    expect(
      modelSettings.getByTestId('llama-max-tokens-slider').props.maximumValue,
    ).toBe(262144);
    expect(
      modelSettings.getByTestId('llama-context-length-slider').props
        .maximumValue,
    ).toBe(262144);
    expect(
      modelSettings.getByTestId('llama-max-tokens-slider').props.value,
    ).toBe(131072);
  });

  it('uses one maximum-tool-call setting in both text-settings surfaces', () => {
    const chatSettings = render(
      <GenerationSettingsModal visible onClose={() => {}} />,
    );
    fireEvent.press(chatSettings.getByText('TEXT GENERATION'));
    fireEvent.press(chatSettings.getByTestId('modal-text-advanced-toggle'));

    const chatSlider = chatSettings.getByTestId('setting-maxToolCalls-slider');
    expect(chatSlider.props.value).toBe(25);
    fireEvent(chatSlider, 'slidingComplete', 40);
    expect(useAppStore.getState().settings.maxToolCalls).toBe(40);
    chatSettings.unmount();

    const modelSettings = renderModelSettings();
    fireEvent.press(modelSettings.getByTestId('text-generation-accordion'));
    fireEvent.press(modelSettings.getByTestId('text-advanced-toggle'));

    expect(modelSettings.getByTestId('max-tool-calls-slider').props.value).toBe(
      40,
    );
  });

  it('shows the same selected STT model on both settings surfaces', () => {
    useWhisperStore.setState({ downloadedModelId: 'base.en' });
    const chatSettings = render(
      <GenerationSettingsModal visible onClose={() => {}} />,
    );

    fireEvent.press(chatSettings.getByTestId('modal-transcription-accordion'));
    expect(chatSettings.getByText('Base')).toBeTruthy();
    chatSettings.unmount();

    const modelSettings = renderModelSettings();
    fireEvent.press(modelSettings.getByTestId('transcription-accordion'));
    expect(modelSettings.getByText('Base')).toBeTruthy();
  });

  it('uses one STT language setting in chat settings and the Models screen', () => {
    useWhisperStore.setState({ downloadedModelId: 'base', transcriptionLanguage: 'auto' });
    const chatSettings = render(
      <GenerationSettingsModal visible onClose={() => {}} />,
    );
    fireEvent.press(chatSettings.getByTestId('modal-transcription-accordion'));
    fireEvent.press(chatSettings.getByTestId('chat-transcription-language'));
    fireEvent.press(chatSettings.getByTestId('chat-transcription-language-fr'));
    expect(useWhisperStore.getState().transcriptionLanguage).toBe('fr');
    chatSettings.unmount();

    const { TranscriptionModelsTab } = require('../../../src/screens/ModelsScreen/TranscriptionModelsTab');
    const models = render(<TranscriptionModelsTab />);
    expect(models.getByTestId('models-transcription-language').props.accessibilityLabel)
      .toBe('Language: French');
  });

  it('renders the same TTS settings owner in both UI containers', () => {
    const SharedTtsSettings = () => (
      <Text testID="shared-tts-settings">Shared TTS settings</Text>
    );
    registerSlot(SLOTS.generationSettingsTts, SharedTtsSettings);
    const chatSettings = render(
      <GenerationSettingsModal visible onClose={() => {}} />,
    );

    fireEvent.press(chatSettings.getByText('TEXT TO SPEECH'));
    expect(chatSettings.getByTestId('shared-tts-settings')).toBeTruthy();
    chatSettings.unmount();

    const modelSettings = renderModelSettings();
    fireEvent.press(modelSettings.getByTestId('tts-accordion'));
    expect(modelSettings.getByTestId('shared-tts-settings')).toBeTruthy();
  });
});
