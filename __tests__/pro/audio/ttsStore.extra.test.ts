/**
 * ttsStore — extra coverage for the uncovered branches.
 *
 * These tests drive the REAL ttsStore actions AND the REAL modelResidencyManager
 * (only the native memory numbers on hardwareService are stubbed) so the
 * residency invariant is asserted as observable STATE (isResident/getResidents),
 * never "a function was called". The only mocked boundaries are:
 *   - the engine registry (a dumb stub engine — the native TTS bridge boundary)
 *   - hardwareService memory readings (native), pinned via setBudgetOverrideMB
 *   - logger (noise)
 * Everything else — the store, the residency manager, the persist migration —
 * runs for real. Deleting the branch under test makes these fail.
 */

// ── Dumb stub engine — the native TTS bridge boundary ───────────────────────
type Voice = { id: string; label: string; metadata: Record<string, unknown> };

function makeEngine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'mock-tts',
    displayName: 'Mock TTS',
    capabilities: {
      streaming: false,
      voiceCloning: false,
      pauseResume: true,
      generateAndSave: true,
      peakRamMB: 100,
    },
    getPhase: jest.fn(() => 'ready' as const),
    on: jest.fn(() => jest.fn()),
    off: jest.fn(),
    once: jest.fn(() => jest.fn()),
    isSupported: jest.fn(() => true),
    initialize: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    hydrateDownloaded: jest.fn(),
    getRequiredAssets: jest.fn(() => [] as Array<{ sizeBytes: number }>),
    checkAssetStatus: jest.fn().mockResolvedValue([]),
    downloadAssets: jest.fn().mockResolvedValue(undefined),
    deleteAssets: jest.fn().mockResolvedValue(undefined),
    getOverallDownloadProgress: jest.fn(() => 1),
    isFullyDownloaded: jest.fn(() => true),
    getBridgeComponent: jest.fn(() => null),
    getVoices: jest.fn(
      () => [{ id: 'default', label: 'Default', metadata: {} }] as Voice[],
    ),
    getActiveVoice: jest.fn(() => ({ id: 'default', label: 'Default', metadata: {} }) as Voice),
    setVoice: jest.fn().mockResolvedValue(undefined),
    speak: jest.fn().mockResolvedValue(undefined),
    generateAndSave: jest.fn().mockResolvedValue({
      filePath: '/cache/c1/m1.pcm',
      durationSeconds: 2.5,
      waveformData: new Array(4).fill(0.1),
    }),
    stop: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    setSpeed: jest.fn(),
    ...overrides,
  };
}

let mockCurrentEngine = makeEngine();

jest.mock('../../../pro/audio/engine', () => ({
  ttsRegistry: {
    register: jest.fn(),
    has: jest.fn(() => true),
    getEngine: jest.fn(() => mockCurrentEngine),
    setActiveEngine: jest.fn(() => Promise.resolve(mockCurrentEngine)),
    getActiveEngine: jest.fn(() => mockCurrentEngine),
    getActiveEngineId: jest.fn(() => 'mock-tts'),
    getRegisteredIds: jest.fn(() => ['mock-tts']),
  },
}));

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { useTTSStore } from '@offgrid/pro/audio/ttsStore';
import { modelApplication, modelResidencyManager } from '../../harness/activeModelLifecycle';
import { hardwareService } from '@offgrid/core/services/hardware';

const getState = () => useTTSStore.getState();
const voiceResident = () => modelResidencyManager.getResidents().find(r => r.type === 'voice');

// Keep the store's own persisted settings coherent between tests.
const baseSettings = {
  interfaceMode: 'chat' as const,
  enabled: true,
  speed: 1.0,
  engineId: 'mock-tts',
  voiceByEngine: {} as Record<string, string>,
  modelDownloaded: {} as Record<string, boolean>,
  voiceAssetsDownloaded: {} as Record<string, string[]>,
};

describe('ttsStore — extra branch coverage', () => {
  let availSpy: jest.SpyInstance;

  beforeEach(() => {
    mockCurrentEngine = makeEngine();
    // Restore the registry default because clearAllMocks does not reset implementations.
    const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
    ttsRegistry.getActiveEngine.mockImplementation(() => mockCurrentEngine);
    useTTSStore.setState({
      phase: 'ready',
      currentMessageId: null,
      currentAudioPath: null,
      currentAmplitude: 0,
      playbackElapsed: 0,
      playbackDuration: 0,
      playSessionId: 0,
      error: null,
      playbackStatus: 'idle',
      isStreaming: false,
      isReady: true,
      isDownloading: false,
      isLoading: false,
      isSpeaking: false,
      isPaused: false,
      isGeneratingAudio: false,
      assets: [],
      overallDownloadProgress: 1,
      voices: [{ id: 'default', label: 'Default', metadata: {} }],
      activeVoiceId: 'default',
      isSwitchingVoice: false,
      settings: { ...baseSettings, voiceByEngine: {}, modelDownloaded: {} },
    });
    // The native boundary supplies deterministic device memory. Shared derives all budgets from it.
    jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(12);
    availSpy = jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(6);
    jest
      .spyOn(hardwareService, 'refreshMemoryInfo')
      .mockResolvedValue(undefined as unknown as ReturnType<typeof hardwareService.refreshMemoryInfo>);
  });

  afterEach(async () => {
    // Remove real application residents before the next device-memory scenario.
    await modelApplication().models.eject();
    await modelResidencyManager._reset();
    modelResidencyManager.setBudgetOverrideMB(null);
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // ── initializeEngine (residency-gated load) ──────────────────────────────

  describe('initializeEngine', () => {
    it('bails with no active engine — no residency load, no error', async () => {
      const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
      ttsRegistry.getActiveEngine.mockReturnValueOnce(null);

      await getState().initializeEngine();

      expect(mockCurrentEngine.initialize).not.toHaveBeenCalled();
      expect(voiceResident()).toBeUndefined();
      expect(getState().error).toBeNull();
    });

    it('override load: fits → engine initialized AND tts becomes resident', async () => {
      mockCurrentEngine.capabilities.peakRamMB = 100;

      await getState().initializeEngine({ override: true });

      // The OUTCOME a user feels: the voice model is actually in RAM.
      expect(mockCurrentEngine.initialize).toHaveBeenCalledTimes(1);
      expect(voiceResident()).toBeDefined();
      expect(getState().error).toBeNull();
    });

    it('warm/preload: NO room → skips quietly (not resident, no error, engine NOT initialized)', async () => {
      // Use a distinct public identity so a prior user's explicit override cannot authorize this warm load.
      mockCurrentEngine = makeEngine({id: 'warm-tts'});
      // A resident larger than the device-derived balanced budget leaves no room for warm TTS.
      const llmLease = await modelResidencyManager.acquire(
        { key: 'llm', type: 'text', sizeMB: 12000 },
        { load: () => Promise.resolve(), unload: () => Promise.resolve({reclaimed: true}) },
        { override: true },
      );
      await llmLease.release();
      mockCurrentEngine.capabilities.peakRamMB = 300;

      await getState().initializeEngine(); // override defaults to false

      // The false branch of `fits`: warm must NOT load and must NOT surface an error.
      expect(mockCurrentEngine.initialize).not.toHaveBeenCalled();
      expect(voiceResident()).toBeUndefined();
      expect(modelResidencyManager.isResident('llm')).toBe(true); // resident not evicted for a warm
      expect(getState().error).toBeNull();
    });

    it('override load: bypasses the budget → evicts everything else and initializes (Load Anyway always loads)', async () => {
      // Load Anyway is UNCONDITIONAL: makeRoomFor under override always returns fits=true (no
      // survival floor — the user accepted the risk), so even at ~500MB real free RAM the override
      // load proceeds — evict, initialize, tts becomes resident. (The old "override still refuses
      // below the floor" behavior was removed.)
      availSpy.mockReturnValue(0.5); // ~500MB free — tight, but override ignores the budget
      mockCurrentEngine.capabilities.peakRamMB = 100;

      await getState().initializeEngine({ override: true });

      expect(mockCurrentEngine.initialize).toHaveBeenCalled();
      expect(voiceResident()).toBeDefined();
      expect(getState().error).toBeNull();
    });

    it('derives sizeMB from required-asset bytes when peakRamMB is 0', async () => {
      // peakRamMB 0 forces the `|| assets.reduce(...)/MB` fallback (line 249).
      mockCurrentEngine.capabilities.peakRamMB = 0;
      mockCurrentEngine.getRequiredAssets.mockReturnValue([
        { sizeBytes: 200 * 1024 * 1024 },
        { sizeBytes: 100 * 1024 * 1024 },
      ]);

      await getState().initializeEngine({ override: true });

      expect(voiceResident()).toBeDefined();
      // The registered resident carries the derived size (~300MB), proving the
      // fallback fed the residency spec — not the 0 peakRamMB.
      const tts = voiceResident();
      expect(tts?.sizeMB).toBe(300);
    });

    it('registered TTS canEvict tracks playbackStatus (veto while playing, evictable when idle)', async () => {
      mockCurrentEngine.capabilities.peakRamMB = 100;
      await getState().initializeEngine({ override: true });

      // canEvict is a runtime field on the resident spec that getResidents()'s stripped
      // type omits — narrow it here to assert the real in-use veto behavior.
      const tts = voiceResident() as
        (undefined | { canEvict?: () => boolean });
      // idle → evictable
      useTTSStore.setState({ playbackStatus: 'idle' });
      expect(tts?.canEvict?.()).toBe(true);
      // playing → residency must NOT evict active playback
      useTTSStore.setState({ playbackStatus: 'playing' });
      expect(tts?.canEvict?.()).toBe(false);
    });

    it('registered TTS unload fn releases the engine when residency evicts it', async () => {
      // Load TTS as a resident (idle → evictable), then force a load that needs the
      // room so residency fires the tts unload fn. Asserts the OUTCOME: the engine is
      // released and tts is no longer resident (line 276 — the eviction unload).
      mockCurrentEngine.capabilities.peakRamMB = 500;
      useTTSStore.setState({ playbackStatus: 'idle' });
      await getState().initializeEngine({ override: true });
      expect(voiceResident()).toBeDefined();

      // A larger override load evicts every evictable resident (single-model), running
      // tts's registered unload fn (which calls engine.release()).
      const llmLease = await modelResidencyManager.acquire(
        { key: 'llm', type: 'text', sizeMB: 1800 },
        { load: async () => {}, unload: async () => ({reclaimed: true}) },
        { override: true },
      );
      await llmLease.release();

      expect(voiceResident()).toBeUndefined();
      expect(mockCurrentEngine.release).toHaveBeenCalled();
    });
  });

  // ── stopStreaming delegation ─────────────────────────────────────────────

  describe('stopStreaming', () => {
    it('runs the streaming-stop path without throwing (delegates to the playback owner)', () => {
      // Real delegation into ttsPlayback/streamingSpeech (not a native boundary) —
      // line 376. From idle it is a safe no-op; the outcome is a stable idle state.
      expect(() => getState().stopStreaming()).not.toThrow();
      expect(getState().playbackStatus).toBe('idle');
    });
  });

  // ── setEngine: restore a saved voice ─────────────────────────────────────

  describe('setEngine saved-voice restore', () => {
    it('re-applies a persisted voice that exists on the engine', async () => {
      mockCurrentEngine.getVoices.mockReturnValue([
        { id: 'default', label: 'Default', metadata: {} },
        { id: 'nova', label: 'Nova', metadata: {} },
      ]);
      useTTSStore.setState({
        settings: { ...baseSettings, voiceByEngine: { 'mock-tts': 'nova' } },
      });

      await getState().setEngine('mock-tts');

      // Line 224: the saved voice is re-applied on the engine and reflected in state.
      expect(mockCurrentEngine.setVoice).toHaveBeenCalledWith('nova');
      expect(getState().activeVoiceId).toBe('nova');
    });

    it('does NOT re-apply a saved voice the engine no longer offers (falls to engine default)', async () => {
      mockCurrentEngine.getVoices.mockReturnValue([{ id: 'default', label: 'Default', metadata: {} }]);
      useTTSStore.setState({
        settings: { ...baseSettings, voiceByEngine: { 'mock-tts': 'ghost-voice' } },
      });

      await getState().setEngine('mock-tts');

      // The other side of the `voices.some(...)` branch: no re-apply.
      expect(mockCurrentEngine.setVoice).not.toHaveBeenCalled();
      // activeVoiceId still reflects the (now invalid) saved id per the store's `savedVoice ?? ...`.
      expect(getState().activeVoiceId).toBe('ghost-voice');
    });
  });

  // ── checkDownloadStatus backfill ─────────────────────────────────────────

  // ── downloadModels ───────────────────────────────────────────────────────

  // ── deleteModels ─────────────────────────────────────────────────────────

  // ── releaseEngine ──────────────────────────────────────────────────────────

  describe('releaseEngine', () => {
    it('releases the active engine', async () => {
      await getState().releaseEngine();
      expect(mockCurrentEngine.release).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when there is no active engine', async () => {
      const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
      ttsRegistry.getActiveEngine.mockReturnValueOnce(null);
      await expect(getState().releaseEngine()).resolves.toBeUndefined();
      expect(mockCurrentEngine.release).not.toHaveBeenCalled();
    });
  });

  // ── generateAndSave capability guard ─────────────────────────────────────

  describe('generateAndSave capability guard', () => {
    it('throws when the active engine cannot generateAndSave', async () => {
      mockCurrentEngine.capabilities.generateAndSave = false;

      await expect(getState().generateAndSave('hi', 'c1', 'm1')).rejects.toThrow(
        /does not support audio generation/i,
      );
      expect(mockCurrentEngine.generateAndSave).not.toHaveBeenCalled();
    });

    it('throws when there is no active engine', async () => {
      const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
      ttsRegistry.getActiveEngine.mockReturnValueOnce(null);

      await expect(getState().generateAndSave('hi', 'c1', 'm1')).rejects.toThrow(
        /no active tts engine/i,
      );
    });
  });

});

// ── onRehydrateStorage migration ────────────────────────────────────────────
// The migration mutates the draft state in place; drive it directly via the
// persist option so both the legacy backfills and the flat→per-engine mapping
// are exercised as real transformations.
describe('ttsStore persist migration (onRehydrateStorage)', () => {
  const runMigration = (settings: Record<string, unknown>) => {
    const opts = (useTTSStore as unknown as {
      persist: { getOptions: () => { onRehydrateStorage: () => (s: unknown) => void } };
    }).persist.getOptions();
    const state = { settings } as unknown;
    opts.onRehydrateStorage()(state);
    return (state as { settings: Record<string, unknown> }).settings;
  };

  it('returns early (no throw) when there is no persisted state', () => {
    const opts = (useTTSStore as unknown as {
      persist: { getOptions: () => { onRehydrateStorage: () => (s: unknown) => void } };
    }).persist.getOptions();
    expect(() => opts.onRehydrateStorage()(undefined)).not.toThrow();
  });

  it('backfills voice and download records when missing', () => {
    const s = runMigration({ engineId: 'kokoro' });
    expect(s.voiceByEngine).toEqual({});
    expect(s.modelDownloaded).toEqual({});
    expect(s.voiceAssetsDownloaded).toEqual({});
  });

  it('migrates the flat Kokoro voice and drops the removed legacy voice', () => {
    const s = runMigration({
      engineId: 'kokoro',
      kokoroVoiceId: 'af_bella',
      voiceId: 'removed-legacy-voice',
    });
    expect((s.voiceByEngine as Record<string, string>).kokoro).toBe('af_bella');
    expect(s.kokoroVoiceId).toBeUndefined();
    expect(s.voiceId).toBeUndefined();
  });

  it('keeps the existing per-engine voice and removes the superseded flat key', () => {
    const s = runMigration({
      engineId: 'kokoro',
      voiceByEngine: { kokoro: 'keep-me' },
      kokoroVoiceId: 'af_bella',
    });
    // The canonical per-engine voice wins. Shared removes the stale flat writer.
    expect((s.voiceByEngine as Record<string, string>).kokoro).toBe('keep-me');
    expect(s.kokoroVoiceId).toBeUndefined();
  });

  it('defaults engineId to kokoro when absent', () => {
    const s = runMigration({ voiceByEngine: {} });
    expect(s.engineId).toBe('kokoro');
  });
});
