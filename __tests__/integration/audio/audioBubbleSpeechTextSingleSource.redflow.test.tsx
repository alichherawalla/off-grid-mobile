/**
 * The audio bubble must route one canonical, speech-safe transcript through the real
 * Mobile Pro playback path. Only the native TTS runtime is replaced here; Mobile,
 * Pro, Shared playback policy, the store projection, and the rendered control remain real.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AudioMessageBubble } from '../../../pro/audio/ui/AudioMessageBubble';
import { prepareMessageForSpeech } from '../../../src/utils/messageContent';
import { ttsRegistry } from '../../../pro/audio/engine';
import { useTTSStore } from '../../../pro/audio/ttsStore';
import type {
  TTSEngine,
  TTSSpeakOptions,
} from '../../../pro/audio/engine/types';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

const ENGINE_ID = 'speech-text-boundary';

function nativeSpeechBoundary(
  spoken: Array<{ text: string; options?: TTSSpeakOptions }>,
): TTSEngine {
  const voice = {
    id: 'voice',
    label: 'Voice',
    metadata: { languageCode: 'en' },
  };
  return {
    id: ENGINE_ID,
    displayName: 'Speech Text Boundary',
    capabilities: {
      streaming: true,
      voiceCloning: false,
      pauseResume: true,
      generateAndSave: false,
      peakRamMB: 1,
    },
    on: () => () => {},
    off: () => {},
    once: () => () => {},
    getPhase: () => 'ready',
    getLastDownloadError: () => null,
    isSupported: () => true,
    initialize: async () => {},
    release: async () => {},
    destroy: async () => {},
    getRequiredAssets: () => [],
    checkAssetStatus: async () => [],
    downloadAssets: async () => {},
    deleteAssets: async () => {},
    getOverallDownloadProgress: () => 1,
    isFullyDownloaded: () => true,
    getBridgeComponent: () => null,
    getVoices: () => [voice],
    getActiveVoice: () => voice,
    setVoice: async () => {},
    speak: async (text, options) => {
      spoken.push({ text, options });
    },
    generateAndSave: async () => {
      throw new Error('The test native boundary does not support saved audio.');
    },
    stop: () => {},
    pause: () => {},
    resume: () => {},
    setSpeed: () => {},
  };
}

describe('audio bubble Play speaks the single-source speech text', () => {
  let fixture: MobileApplicationFixture;
  const spoken: Array<{ text: string; options?: TTSSpeakOptions }> = [];

  beforeAll(async () => {
    ttsRegistry.register(ENGINE_ID, () => nativeSpeechBoundary(spoken));
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture({ pro: true });
    await useTTSStore.getState().setEngine(ENGINE_ID);
  });

  afterAll(async () => {
    await useTTSStore.getState().releaseEngine();
    await ttsRegistry.unregister(ENGINE_ID);
    await fixture.dispose();
  });

  beforeEach(() => {
    spoken.length = 0;
  });

  it('removes control tokens and markdown before speech reaches the native runtime', async () => {
    const transcript =
      '<think>internal reasoning the user must not hear</think>\n## Answer\nThe **capital** is `Paris`.';

    const view = render(
      React.createElement(AudioMessageBubble, {
        messageId: 'm1',
        audioPath: '',
        waveformData: [],
        durationSeconds: 0,
        transcript,
      }),
    );

    fireEvent.press(view.getByLabelText('Play'));

    await waitFor(() => expect(spoken).toHaveLength(1));
    expect(spoken[0]?.text).toBe(prepareMessageForSpeech(transcript));
    expect(spoken[0]?.text).not.toMatch(/internal reasoning/);
  });
});
