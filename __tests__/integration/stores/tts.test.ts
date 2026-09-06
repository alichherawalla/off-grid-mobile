/** TTS journeys through the real Shared Mobile + Pro composition; only native TTS and FS are fake. */
import type {
  ModelAssetState,
  TTSEngine,
  TTSEngineEvents,
  TTSSpeakOptions,
  TTSVoice,
} from '../../../pro/audio/engine/types';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { installNativeBoundary } from '../../harness/nativeBoundary';

const ENGINE_ID = 'tts-integration';

class NativeTTSBoundary implements TTSEngine {
  readonly id = ENGINE_ID;
  readonly displayName = 'Integration Voice';
  readonly capabilities = {
    streaming: false,
    voiceCloning: false,
    pauseResume: true,
    generateAndSave: true,
    peakRamMB: 100,
  };
  private phase: ReturnType<TTSEngine['getPhase']> = 'idle';
  private listeners = new Map<
    keyof TTSEngineEvents,
    Set<(...args: any[]) => void>
  >();
  private finishSpeaking: (() => void) | null = null;
  readonly spoken: Array<{ text: string; options?: TTSSpeakOptions }> = [];
  initializeCount = 0;
  stopCount = 0;
  getPhase() {
    return this.phase;
  }
  getLastDownloadError() {
    return null;
  }
  isSupported() {
    return true;
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
  private setPhase(next: ReturnType<TTSEngine['getPhase']>) {
    const previous = this.phase;
    this.phase = next;
    this.listeners
      .get('phaseChange')
      ?.forEach(listener => listener(next, previous));
  }
  async initialize() {
    this.initializeCount += 1;
    this.setPhase('ready');
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
        sizeBytes: 1024,
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
  hydrateDownloaded() {}
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
  speak(text: string, options?: TTSSpeakOptions): Promise<void> {
    this.spoken.push({ text, options });
    this.setPhase('processing');
    return new Promise(resolve => {
      this.finishSpeaking = () => {
        this.setPhase('ready');
        resolve();
      };
    });
  }
  finish() {
    this.finishSpeaking?.();
    this.finishSpeaking = null;
  }
  async generateAndSave() {
    return {
      filePath: '/cache/c1/m1.pcm',
      durationSeconds: 1.5,
      waveformData: new Array(200).fill(0.2),
    };
  }
  stop() {
    this.stopCount += 1;
    this.finish();
  }
  pause() {
    this.setPhase('paused');
  }
  resume() {
    this.setPhase('processing');
  }
  setSpeed() {}
}

describe('TTS store through Shared Mobile + Pro composition', () => {
  const native = new NativeTTSBoundary();
  let fixture: MobileApplicationFixture;
  let registry: typeof import('../../../pro/audio/engine')['ttsRegistry'];
  let store: typeof import('../../../pro/audio/ttsStore')['useTTSStore'];

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
    await store.getState().setEngine(ENGINE_ID);
    store.getState().updateSettings({ enabled: true, speed: 1 });
  });

  afterAll(async () => {
    await store.getState().releaseEngine();
    await registry.unregister(ENGINE_ID);
    await fixture.dispose();
  });

  it('warms when it fits, skips without error when it does not, and force-loads a real turn', async () => {
    await store.getState().initializeEngine();
    expect(
      fixture.application.models
        .snapshot()
        .residents.some(row => row.type === 'voice'),
    ).toBe(true);
    expect(native.initializeCount).toBe(1);
    await store.getState().releaseEngine();
    native.capabilities.peakRamMB = 20_000;
    await store.getState().initializeEngine();
    expect(native.initializeCount).toBe(1);
    expect(store.getState().error).toBeNull();
    native.capabilities.peakRamMB = 100;
    await store.getState().initializeEngine({ override: true });
    expect(native.initializeCount).toBe(2);
    expect(
      fixture.application.models
        .snapshot()
        .residents.some(row => row.type === 'voice'),
    ).toBe(true);
  });

  it('speaks and stops through Shared playback', async () => {
    const speaking = store.getState().speak('hello', 'msg1');
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(store.getState().currentMessageId).toBe('msg1');
    expect(native.spoken).toEqual([expect.objectContaining({ text: 'hello' })]);
    store.getState().stop();
    await speaking;
    expect(native.stopCount).toBeGreaterThan(0);
    expect(store.getState().currentMessageId).toBeNull();
  });

  it('generates a saved audio artifact through the active native engine', async () => {
    const result = await store
      .getState()
      .generateAndSave('hello audio', 'conv1', 'msg1');
    expect(result.path).toBe('/cache/c1/m1.pcm');
    expect(result.durationSeconds).toBe(1.5);
    expect(result.waveformData).toHaveLength(200);
  });

  it('applies both interface modes through the real settings owner', () => {
    store.getState().updateSettings({ interfaceMode: 'audio' });
    expect(store.getState().settings.interfaceMode).toBe('audio');
    store.getState().updateSettings({ interfaceMode: 'chat' });
    expect(store.getState().settings.interfaceMode).toBe('chat');
  });
});
