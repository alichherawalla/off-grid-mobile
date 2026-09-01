/**
 * Real Mobile Pro → Shared voice control-plane integration.
 * Only the native TTS runtime is fake; the registry, store, Shared services,
 * generation routing, residency manager, and projection subscriptions are real.
 */
import { OnDeviceEngineEmitter, ttsRegistry } from '../../../pro/audio/engine';
import type {
  ModelAssetState,
  TTSEngine,
  TTSEngineEvents,
  TTSSpeakOptions,
  TTSVoice,
} from '../../../pro/audio/engine';
import { useTTSStore } from '../../../pro/audio/ttsStore';

const ENGINE_ID = 'integration-voice';

class NativeVoiceBoundaryFake extends OnDeviceEngineEmitter<TTSEngineEvents> implements TTSEngine {
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

  getPhase() { return this.phase; }
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

  beforeAll(() => {
    ttsRegistry.register(ENGINE_ID, () => native);
  });

  afterAll(async () => {
    await useTTSStore.getState().releaseEngine();
    await ttsRegistry.unregister(ENGINE_ID);
  });

  beforeEach(async () => {
    useTTSStore.setState({
      playbackStatus: 'idle', playSessionId: 0, currentMessageId: null,
      currentAudioPath: null, currentAmplitude: 0, playbackElapsed: 0,
      playbackDuration: 0, activeVoiceId: 'af_heart', error: null,
      isSwitchingVoice: false, pendingVoiceId: null, failedVoiceId: null,
      voiceSwitchProgress: 0, voiceSwitchNeedsDownload: false,
      settings: {
        interfaceMode: 'chat', enabled: true, speed: 1.25, engineId: ENGINE_ID,
        voiceByEngine: { [ENGINE_ID]: 'af_heart' },
        modelDownloaded: { [ENGINE_ID]: true },
        voiceAssetsDownloaded: { [ENGINE_ID]: ['af_heart'] },
      },
    });
    await useTTSStore.getState().setEngine(ENGINE_ID);
    native.spoken.length = 0;
  });

  it('applies a voice, rolls back a failed switch, and synthesizes through Shared generation', async () => {
    await useTTSStore.getState().setVoice('bf_emma');
    expect(useTTSStore.getState().activeVoiceId).toBe('bf_emma');
    expect(useTTSStore.getState().settings.voiceAssetsDownloaded?.[ENGINE_ID]).toContain('bf_emma');

    native.rejectNextVoice = true;
    await useTTSStore.getState().setVoice('af_heart');
    expect(useTTSStore.getState().activeVoiceId).toBe('bf_emma');
    expect(useTTSStore.getState().failedVoiceId).toBe('af_heart');

    await useTTSStore.getState().speak('Private speech', 'voice-turn-1');
    expect(native.spoken).toEqual([
      { text: 'Private speech', options: expect.objectContaining({ speed: 1.25, voiceId: 'bf_emma', messageId: 'voice-turn-1' }) },
    ]);
    expect(useTTSStore.getState().playbackStatus).toBe('idle');
  });
});
