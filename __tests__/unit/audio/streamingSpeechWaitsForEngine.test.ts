/**
 * A turn that starts while the voice engine is still loading must still stream: the answer so far is
 * held and replayed the moment the engine is ready, then sentence-by-sentence continues.
 */
jest.mock('@offgrid/core/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../../pro/audio/ttsLog', () => ({ smLog: jest.fn() }));
jest.mock('@offgrid/core/services/modelServices/residencyBootstrap', () => ({
  modelResidencyManager: { canLoadWithoutEviction: () => true },
}));
jest.mock('../../../pro/audio/audioCoordinator', () => ({ resetForEngineLoss: jest.fn() }));
jest.mock('../../../pro/audio/playbackMachine', () => ({ dispatchPlayback: jest.fn() }));
jest.mock('../../../pro/audio/streamPlaybackClock', () => ({ getStreamBase: () => 0, setStreamBase: jest.fn(), resetStreamBase: jest.fn() }));

jest.mock('../../../pro/audio/engine', () => {
  const engine = {
    id: 'kokoro',
    isFullyDownloaded: () => true,
    getPhase: jest.fn(() => 'loading'),
    speak: jest.fn(async () => undefined),
    on: jest.fn(() => () => undefined),
    release: jest.fn(async () => undefined),
  };
  return { ttsRegistry: { getActiveEngine: jest.fn(() => engine), getEngine: jest.fn(() => engine) } };
});
jest.mock('../../../pro/audio/voiceGeneration', () => ({
  generateVoice: jest.fn(async (text: string) => {
    const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
    await ttsRegistry.getActiveEngine().speak(text);
    return { output: { type: 'voice', text }, finishReason: 'stop' };
  }),
}));
jest.mock('../../../pro/audio/ttsStore', () => {
  // Plain JS inside the factory: the hoist step rejects type syntax here.
  const listeners = new Set();
  const box = { state: {} };
  return {
    useTTSStore: {
      getState: () => box.state,
      setState: partial => {
        const next = typeof partial === 'function' ? partial(box.state) : partial;
        box.state = { ...box.state, ...next };
      },
      subscribe: listener => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      __test: {
        reset: state => { box.state = state; listeners.clear(); },
        ready: () => { box.state = { ...box.state, isReady: true }; listeners.forEach(listener => listener(box.state)); },
      },
    },
  };
});

import { feedStreamingText, isStreamingSpeechActive, resetStreamingSpeech } from '../../../pro/audio/streamingSpeech';
import { ttsRegistry } from '../../../pro/audio/engine';
import { useTTSStore } from '../../../pro/audio/ttsStore';

const mockEngine = ttsRegistry.getActiveEngine() as unknown as { getPhase: jest.Mock; speak: jest.Mock };
const storeTest = (useTTSStore as unknown as { __test: { reset: (s: unknown) => void; ready: () => void } }).__test;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const engineReady = () => {
  mockEngine.getPhase.mockReturnValue('ready');
  storeTest.ready();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEngine.getPhase.mockReturnValue('loading');
  storeTest.reset({
    settings: { interfaceMode: 'audio', enabled: true, speed: 1, engineId: 'kokoro', voiceByEngine: {} },
    isReady: false,
    initializeEngine: jest.fn(async () => undefined),
  });
  resetStreamingSpeech();
});

test('holds the answer while the engine loads, then streams from it the moment the engine is ready', async () => {
  feedStreamingText('Hello there. This is the first');
  expect(isStreamingSpeechActive()).toBe(false);
  expect(mockEngine.speak).not.toHaveBeenCalled();
  feedStreamingText('Hello there. This is the first sentence. And a second one.');
  engineReady();
  await flush();
  expect(isStreamingSpeechActive()).toBe(true);
  await flush();
  const spoken = mockEngine.speak.mock.calls.map(call => call[0]).join(' ');
  expect(spoken).toContain('Hello there.');
  expect(spoken).toContain('This is the first sentence.');
});

test('a new turn drops the previous turn\'s held answer', async () => {
  feedStreamingText('Old answer, never spoken.');
  resetStreamingSpeech();
  engineReady();
  await flush();
  expect(isStreamingSpeechActive()).toBe(false);
  expect(mockEngine.speak).not.toHaveBeenCalled();
});
