/**
 * A turn that starts while the voice engine is loading must keep the latest answer and begin
 * streaming once Shared projects that engine as ready. A superseded turn must never replay.
 *
 * Real Shared Mobile + Pro speech composition. Only the native TTS/audio engine is faked.
 */
import type {
  EnginePhase,
  ModelAssetState,
  TTSEngine,
  TTSEngineEvents,
  TTSSpeakOptions,
  TTSVoice,
} from '../../../pro/audio/engine/types';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { installNativeBoundary } from '../../harness/nativeBoundary';

const ENGINE_ID = 'streaming-wait-engine';

class NativeSpeechBoundary implements TTSEngine {
  readonly id = ENGINE_ID;
  readonly displayName = 'Streaming wait voice';
  readonly capabilities = {
    streaming: true,
    voiceCloning: false,
    pauseResume: true,
    generateAndSave: true,
    peakRamMB: 100,
  };
  private phase: EnginePhase = 'loading';
  private readonly listeners = new Map<
    keyof TTSEngineEvents,
    Set<(...args: any[]) => void>
  >();
  readonly spoken: string[] = [];

  getPhase() {
    return this.phase;
  }
  private setPhase(next: EnginePhase) {
    const previous = this.phase;
    this.phase = next;
    this.listeners
      .get('phaseChange')
      ?.forEach(listener => listener(next, previous));
  }
  reset() {
    this.spoken.length = 0;
    this.setPhase('loading');
  }
  ready() {
    this.setPhase('ready');
  }
  on<K extends keyof TTSEngineEvents>(event: K, listener: TTSEngineEvents[K]) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => this.off(event, listener);
  }
  off<K extends keyof TTSEngineEvents>(event: K, listener: TTSEngineEvents[K]) {
    this.listeners.get(event)?.delete(listener);
  }
  once<K extends keyof TTSEngineEvents>(
    event: K,
    listener: TTSEngineEvents[K],
  ) {
    const stop = this.on(event, ((...args: any[]) => {
      stop();
      listener(...args);
    }) as TTSEngineEvents[K]);
    return stop;
  }
  isSupported() {
    return true;
  }
  async initialize() {
    this.ready();
  }
  async release() {
    this.setPhase('idle');
  }
  async destroy() {
    this.setPhase('idle');
  }
  getRequiredAssets() {
    return [
      {
        id: 'voice',
        label: 'Voice',
        url: 'native://voice',
        sizeBytes: 1,
        filename: 'voice.pte',
      },
    ];
  }
  async checkAssetStatus(): Promise<ModelAssetState[]> {
    return this.getRequiredAssets().map(asset => ({
      asset,
      status: 'downloaded',
      progress: 1,
    }));
  }
  async downloadAssets() {}
  async deleteAssets() {}
  getOverallDownloadProgress() {
    return 1;
  }
  isFullyDownloaded() {
    return true;
  }
  getLastDownloadError() {
    return null;
  }
  getBridgeComponent() {
    return null;
  }
  getVoices(): TTSVoice[] {
    return [{ id: 'default', label: 'Default', metadata: {} }];
  }
  getActiveVoice() {
    return this.getVoices()[0];
  }
  async setVoice() {}
  async speak(text: string, _options?: TTSSpeakOptions) {
    this.spoken.push(text);
  }
  async generateAndSave() {
    return {
      filePath: '/cache/speech.pcm',
      durationSeconds: 1,
      waveformData: [],
    };
  }
  stop() {}
  pause() {
    this.setPhase('paused');
  }
  resume() {
    this.setPhase('processing');
  }
  setSpeed() {}
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('streaming speech waits for Shared voice readiness', () => {
  const native = new NativeSpeechBoundary();
  let fixture: MobileApplicationFixture;
  let registry: typeof import('../../../pro/audio/engine')['ttsRegistry'];
  let store: typeof import('../../../pro/audio/ttsStore')['useTTSStore'];
  let streaming: typeof import('../../../pro/audio/streamingSpeech');

  beforeAll(async () => {
    installNativeBoundary({
      fs: true,
      ram: {
        platform: 'ios',
        totalBytes: 12 * 1024 ** 3,
        availBytes: 6 * 1024 ** 3,
      },
    });
    ({ ttsRegistry: registry } =
      require('../../../pro/audio/engine') as typeof import('../../../pro/audio/engine'));
    registry.register(ENGINE_ID, () => native);
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture({ pro: true });
    ({ useTTSStore: store } =
      require('../../../pro/audio/ttsStore') as typeof import('../../../pro/audio/ttsStore'));
    streaming =
      require('../../../pro/audio/streamingSpeech') as typeof import('../../../pro/audio/streamingSpeech');
    await store.getState().setEngine(ENGINE_ID);
    store.getState().updateSettings({ interfaceMode: 'audio', enabled: true });
  });

  beforeEach(() => {
    streaming.resetStreamingSpeech();
    native.reset();
  });

  afterAll(async () => {
    streaming.resetStreamingSpeech();
    await store.getState().releaseEngine();
    await registry.unregister(ENGINE_ID);
    await fixture.dispose();
  });

  it('holds the latest answer, then streams it when the selected engine becomes ready', async () => {
    streaming.feedStreamingText('Hello there. This is the first');
    streaming.feedStreamingText(
      'Hello there. This is the first sentence. And a second one.',
    );

    expect(streaming.isStreamingSpeechActive()).toBe(false);
    expect(native.spoken).toEqual([]);

    native.ready();
    await flush();
    await flush();

    expect(streaming.isStreamingSpeechActive()).toBe(true);
    expect(native.spoken.join(' ')).toContain('Hello there.');
    expect(native.spoken.join(' ')).toContain('This is the first sentence.');
  });

  it('drops a held answer when a new turn supersedes it', async () => {
    streaming.feedStreamingText('Old answer, never spoken.');
    streaming.resetStreamingSpeech();
    native.ready();
    await flush();

    expect(streaming.isStreamingSpeechActive()).toBe(false);
    expect(native.spoken).toEqual([]);
  });
});
