/**
 * BATCH 5 (TTS & Audio) — hardening — KokoroEngine download-error + setVoice paths.
 *
 * The engine-level DOWNLOAD FAILURE path was untested. Existing kokoroEngine /
 * kokoroLiveState suites prove the download HAPPY path, mid-download honesty, the
 * benign "already downloading" collision, and delete — but never the case where the
 * executorch fetch REJECTS with a real (non-collision) error, e.g. an offline
 * download (device cases 34/35: "download enters error / network-waiting state").
 *
 * This drives the REAL KokoroEngine (from @offgrid/pro) — only the native
 * BareResourceFetcher boundary is mocked (via jest.setup). Deleting the error-cascade
 * lines in downloadAssets() would fail these tests.
 *
 * Also covers KokoroEngine.setVoice, whose OWN behaviour (active-voice update, genuine
 * completion on fetch success, voiceChanged emit, tolerance of a failed voice fetch)
 * is exercised nowhere — the ttsStore setVoice tests mock engine.setVoice entirely.
 */
import { BareResourceFetcher } from 'react-native-executorch-bare-resource-fetcher';
import {
  KokoroEngine,
  type KokoroBridgeHandle,
} from '../../pro/audio/engine/tts/engines/kokoro/KokoroEngine';
import type { KokoroVoiceId } from '../../pro/audio/engine/tts/engines/kokoro/voices';

const fetchResources = (BareResourceFetcher as any).fetch as jest.Mock;
const listDownloadedFiles =
  BareResourceFetcher.listDownloadedFiles as jest.Mock;

beforeEach(() => {
  fetchResources?.mockReset().mockResolvedValue(undefined);
  listDownloadedFiles?.mockReset().mockResolvedValue([]);
});

function attachSelectedVoiceBridge(engine: KokoroEngine): void {
  const bridge: KokoroBridgeHandle = {
    speak: async () => undefined,
    stop: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    setSpeed: () => undefined,
    setKeepAlive: () => undefined,
  };
  engine._setMountRequester(() => {
    engine._setBridge(bridge, engine.getActiveVoice()!.id as KokoroVoiceId);
  });
}

describe('KokoroEngine — download failure (offline / interrupted fetch)', () => {
  it('a REAL fetch rejection lands the engine in the error phase, records the message, and rethrows', async () => {
    // The offline case: BareResourceFetcher.fetch rejects with a genuine error (NOT the
    // benign "already downloading" collision). The engine must NOT swallow it: phase →
    // 'error', getLastDownloadError() carries the message, and the promise rejects so the
    // caller (store/DM) can surface a retryable failed row rather than a stuck spinner.
    const engine = new KokoroEngine();
    fetchResources.mockRejectedValueOnce(new Error('Network is unreachable'));

    await expect(engine.downloadAssets()).rejects.toThrow(
      /network is unreachable/i,
    );

    expect(engine.getPhase()).toBe('error');
    expect(engine.getLastDownloadError()).toMatch(/network is unreachable/i);
    expect(engine.isFullyDownloaded()).toBe(false);
  });

  it('emits a recoverable KOKORO_DOWNLOAD error event on a real fetch failure', async () => {
    // The DM/UI listens for the error event to show a retry affordance; a failed download
    // must be recoverable:true (the executorch cache resumes on retry).
    const engine = new KokoroEngine();
    const onError = jest.fn();
    engine.on('error', onError);
    fetchResources.mockRejectedValueOnce(new Error('Download interrupted'));

    await expect(engine.downloadAssets()).rejects.toThrow();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'KOKORO_DOWNLOAD',
        recoverable: true,
        message: expect.stringMatching(/interrupted/i),
      }),
    );
  });

  it('a fresh (re)download attempt clears the prior failure error before fetching', async () => {
    // A retry (or Voice-panel re-tap) supersedes any earlier failure: the stale error must
    // be cleared up front so a now-succeeding download does not still read as failed.
    const engine = new KokoroEngine();
    fetchResources.mockRejectedValueOnce(new Error('First attempt died'));
    await expect(engine.downloadAssets()).rejects.toThrow();
    expect(engine.getLastDownloadError()).toMatch(/first attempt died/i);

    // Second attempt succeeds → error cleared, phase settles off 'error', downloaded true.
    fetchResources.mockResolvedValueOnce(undefined);
    await engine.downloadAssets();

    expect(engine.getLastDownloadError()).toBeNull();
    expect(engine.getPhase()).not.toBe('error');
    expect(engine.isFullyDownloaded()).toBe(true);
  });

  it('does not record genuine completion when the fetch fails (stays not-downloaded)', async () => {
    const engine = new KokoroEngine();
    fetchResources.mockRejectedValueOnce(new Error('boom'));
    await expect(engine.downloadAssets()).rejects.toThrow();

    const [state] = await engine.checkAssetStatus();
    // phase 'error' surfaces as not-downloaded to the status probe (not 'downloaded').
    expect(state.status).not.toBe('downloaded');
    expect(engine.isFullyDownloaded()).toBe(false);
  });
});

describe('KokoroEngine.setVoice — active voice + completeness + events', () => {
  it('serializes a voice-pack fetch behind an active base-model download', async () => {
    const engine = new KokoroEngine();
    attachSelectedVoiceBridge(engine);
    let finishBase!: () => void;
    fetchResources
      .mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            finishBase = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);

    const baseDownload = engine.downloadAssets();
    const voiceSwitch = engine.setVoice('hf_alpha');

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchResources).toHaveBeenCalledTimes(1);

    finishBase();
    await baseDownload;
    await voiceSwitch;

    expect(fetchResources).toHaveBeenCalledTimes(2);
    expect(engine.getActiveVoice()?.id).toBe('hf_alpha');
    expect(engine.isFullyDownloaded()).toBe(true);
  });

  it('updates the active voice and reflects it via getActiveVoice()', async () => {
    const engine = new KokoroEngine();
    attachSelectedVoiceBridge(engine);
    // Default active voice is af_heart.
    expect(engine.getActiveVoice()?.id).toBe('af_heart');

    fetchResources.mockResolvedValueOnce(undefined);
    await engine.setVoice('am_adam');

    expect(engine.getActiveVoice()?.id).toBe('am_adam');
  });

  it('emits voiceChanged with the new voice id', async () => {
    const engine = new KokoroEngine();
    attachSelectedVoiceBridge(engine);
    const onVoiceChanged = jest.fn();
    engine.on('voiceChanged', onVoiceChanged);
    fetchResources.mockResolvedValueOnce(undefined);

    await engine.setVoice('bf_emma');

    expect(onVoiceChanged).toHaveBeenCalledWith('bf_emma');
  });

  it('records genuine completion once the new voice fetch resolves (reads downloaded)', async () => {
    const engine = new KokoroEngine();
    attachSelectedVoiceBridge(engine);
    fetchResources.mockResolvedValueOnce(undefined);

    await engine.setVoice('am_michael');

    // The resolved fetch is the completeness signal — the switched-to voice is downloaded.
    expect(engine.isFullyDownloaded()).toBe(true);
  });

  it('rejects an unknown voice id without touching the active voice', async () => {
    const engine = new KokoroEngine();
    await expect(engine.setVoice('not_a_real_voice')).rejects.toThrow(
      /unknown kokoro voice/i,
    );
    expect(engine.getActiveVoice()?.id).toBe('af_heart'); // unchanged
    expect(fetchResources).not.toHaveBeenCalled();
  });

  it('a failed voice-asset fetch rejects and keeps the last usable voice active', async () => {
    const engine = new KokoroEngine();
    const onVoiceChanged = jest.fn();
    engine.on('voiceChanged', onVoiceChanged);
    fetchResources.mockRejectedValueOnce(new Error('voice fetch offline'));

    await expect(engine.setVoice('am_santa')).rejects.toThrow(
      'voice fetch offline',
    );

    expect(engine.getActiveVoice()?.id).toBe('af_heart');
    expect(onVoiceChanged).not.toHaveBeenCalled();
  });
});
