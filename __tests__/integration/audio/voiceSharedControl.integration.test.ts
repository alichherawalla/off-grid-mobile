/**
 * Real Mobile Pro → Shared voice control-plane integration.
 * Only the native TTS runtime is fake; the registry, store, Shared services,
 * generation routing, residency manager, and projection subscriptions are real.
 */
import type {
  ModelAssetState,
  TTSEngine,
  TTSEngineEvents,
  TTSSpeakOptions,
  TTSVoice,
} from '../../../pro/audio/engine/types';
import { installNativeBoundary } from '../../harness/nativeBoundary';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

const ENGINE_ID = 'integration-voice';

class NativeVoiceBoundaryFake implements TTSEngine {
  readonly id = ENGINE_ID;
  readonly displayName = 'Integration Voice';
  readonly capabilities = {
    streaming: true, voiceCloning: false, pauseResume: true,
    generateAndSave: false, peakRamMB: 1,
  };
  private phase: ReturnType<TTSEngine['getPhase']> = 'ready';
  private voiceId = 'af_heart';
  private downloaded = true;
  rejectNextVoice = false;
  spoken: Array<{ text: string; options?: TTSSpeakOptions }> = [];
  private listeners = new Map<keyof TTSEngineEvents, Set<(...args: any[]) => void>>();

  on<K extends keyof TTSEngineEvents>(event: K, listener: TTSEngineEvents[K]) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => this.off(event, listener);
  }
  off<K extends keyof TTSEngineEvents>(event: K, listener: TTSEngineEvents[K]) {
    this.listeners.get(event)?.delete(listener);
  }
  once<K extends keyof TTSEngineEvents>(event: K, listener: TTSEngineEvents[K]) {
    const stop = this.on(event, ((...args: any[]) => {
      stop();
      listener(...args);
    }) as TTSEngineEvents[K]);
    return stop;
  }
  private emit<K extends keyof TTSEngineEvents>(event: K, ...args: Parameters<TTSEngineEvents[K]>) {
    this.listeners.get(event)?.forEach(listener => listener(...args));
  }

  getPhase() { return this.phase; }
  getLastDownloadError() { return null; }
  isSupported() { return true; }
  async initialize() { this.phase = 'ready'; }
  async release() { this.phase = 'idle'; }
  async destroy() { this.phase = 'idle'; this.downloaded = false; }
  getRequiredAssets() {
    return [{ id: 'voice', label: 'Voice', url: 'native://voice', sizeBytes: 1024, filename: 'voice.pte' }];
  }
  async checkAssetStatus(): Promise<ModelAssetState[]> {
    return this.getRequiredAssets().map(asset => ({
      asset, status: this.downloaded ? 'downloaded' : 'not-downloaded', progress: this.downloaded ? 1 : 0,
    }));
  }
  async downloadAssets() { this.downloaded = true; }
  async deleteAssets() { this.downloaded = false; }
  getOverallDownloadProgress() { return this.downloaded ? 1 : 0; }
  isFullyDownloaded() { return this.downloaded; }
  hydrateDownloaded(downloaded: boolean) { this.downloaded = downloaded; }
  getBridgeComponent() { return null; }
  getVoices(): TTSVoice[] {
    return [
      { id: 'af_heart', label: 'Heart', metadata: { languageCode: 'en' } },
      { id: 'bf_emma', label: 'Emma', metadata: { languageCode: 'en' } },
    ];
  }
  getActiveVoice() { return this.getVoices().find(voice => voice.id === this.voiceId) ?? null; }
  async setVoice(voiceId: string) {
    if (this.rejectNextVoice) { this.rejectNextVoice = false; throw new Error('native voice fetch failed'); }
    this.voiceId = voiceId;
    this.emit('voiceChanged', voiceId);
  }
  async speak(text: string, options?: TTSSpeakOptions) {
    this.spoken.push({ text, options });
  }
  async generateAndSave(): Promise<never> { throw new Error('unsupported'); }
  stop() {}
  pause() {}
  resume() {}
  setSpeed() {}
}

describe('Mobile Pro uses the Shared voice control plane', () => {
  const native = new NativeVoiceBoundaryFake();
  let fixture: MobileApplicationFixture;
  let ttsRegistry: typeof import('../../../pro/audio/engine')['ttsRegistry'];
  let useTTSStore: typeof import('../../../pro/audio/ttsStore')['useTTSStore'];
  let voiceControlService: typeof import('../../../pro/audio/ttsControlService')['voiceControlService'];

  beforeAll(async () => {
    installNativeBoundary();
    ({ ttsRegistry } = require('../../../pro/audio/engine') as typeof import('../../../pro/audio/engine'));
    ttsRegistry.register(ENGINE_ID, () => native);
    const { startMobileApplicationFixture } = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture({ pro: true });
    ({ useTTSStore } = require('../../../pro/audio/ttsStore') as typeof import('../../../pro/audio/ttsStore'));
    ({ voiceControlService } = require('../../../pro/audio/ttsControlService') as typeof import('../../../pro/audio/ttsControlService'));
  });

  afterAll(async () => {
    await useTTSStore.getState().releaseEngine();
    await ttsRegistry.unregister(ENGINE_ID);
    await fixture.dispose();
  });

  beforeEach(async () => {
    await useTTSStore.getState().setEngine(ENGINE_ID);
    useTTSStore.getState().updateSettings({ enabled: true, speed: 1.25 });
    await voiceControlService.download({
      set: useTTSStore.setState,
      get: useTTSStore.getState,
    });
    native.spoken.length = 0;
    fixture.application.speech.session.dispatch('reset');
  });

  it('applies a voice, rolls back a failed switch, and speaks under the Shared session owner', async () => {
    await useTTSStore.getState().setVoice('bf_emma');
    expect(useTTSStore.getState().activeVoiceId).toBe('bf_emma');
    expect(useTTSStore.getState().settings.voiceAssetsDownloaded?.[ENGINE_ID]).toContain('bf_emma');

    native.rejectNextVoice = true;
    await useTTSStore.getState().setVoice('af_heart');
    expect(useTTSStore.getState().activeVoiceId).toBe('bf_emma');
    expect(useTTSStore.getState().failedVoiceId).toBe('af_heart');

    fixture.application.speech.session.dispatch('userStart');
    expect(fixture.application.speech.session.micShouldBeOpen()).toBe(true);
    fixture.application.speech.session.dispatch('turnCaptured');
    expect(fixture.application.speech.session.speechMayPlay()).toBe(true);

    const models = await fixture.refreshModels();
    const voiceRoute = models.inventory.find(
      model => model.modality === 'voice' && model.providerId === ENGINE_ID,
    )?.routeId;
    expect(voiceRoute).toBeDefined();
    expect(await fixture.application.speech.selectModel('tts', voiceRoute!)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await fixture.application.speech.selectVoice('bf_emma')).toEqual({
      ok: true,
      value: undefined,
    });
    const finished = new Promise<void>(resolve => {
      const stop = fixture.application.speech.events(event => {
        if (event.type === 'speech_finished' && event.operationId === 'voice-turn-1') {
          stop();
          resolve();
        }
      });
    });
    expect(await fixture.application.speech.speak({
      text: 'Private speech',
      operationId: 'voice-turn-1',
      speed: 1.25,
    })).toEqual({ ok: true, value: { operationId: 'voice-turn-1' } });
    await finished;
    expect(native.spoken).toEqual([
      { text: 'Private speech', options: expect.objectContaining({ speed: 1.25, voiceId: 'bf_emma' }) },
    ]);
    expect(fixture.application.speech.snapshot().voice.state).toBe('stopped');
  });
});
