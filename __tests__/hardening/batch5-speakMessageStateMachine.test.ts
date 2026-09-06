/**
 * BATCH 5 (TTS & Audio) — hardening — speakMessage state machine.
 *
 * REAL composition: the Mobile application root, the real TTS store, the real
 * mobile playback ports (`pro/audio/ttsPlayback`), the real Shared voice playback
 * application service and its playback reducer, the real voice-generation route
 * lookup and the real engine-readiness gate. The ONLY fake is the native TTS
 * runtime at the device boundary — it records `speak`/`stop`/`initialize` so the
 * ORDER of native calls is observable, and it emits the native `phaseChange`
 * events a real runtime emits.
 *
 * Guards exercised here (delete one in production and one of these goes red):
 *  - "ignore taps while preparing" — a stop() mid-load crashes the freshly loaded
 *    executorch stream, so a second tap during the preparing window is dropped.
 *  - "stop the other message before starting a new one" — the runtime plays one
 *    stream at a time (device case 17: a new message supersedes the current one).
 *  - engine-not-ready → graceful bail to idle with the reason surfaced, no throw
 *    and no stuck spinner (device case 33: speak with the voice model removed).
 *  - a synthesis failure surfaces the runtime's error and settles back to idle.
 */
import type {
  ModelAssetState,
  TTSEngine,
  TTSEngineEvents,
  TTSVoice,
} from '../../pro/audio/engine/types';
import { installNativeBoundary } from '../harness/nativeBoundary';
import type { MobileApplicationFixture } from '../harness/mobileApplicationFixture';

const ENGINE_ID = 'batch5-speak-voice';

type NativeCall =
  | { op: 'speak'; text: string; messageId?: string }
  | { op: 'stop' }
  | { op: 'initialize' };

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Wait for the real async chain to reach a condition (no fake timers, no polling of internals). */
async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

/**
 * Native TTS runtime boundary fake. It reports its own state and records the
 * native calls it receives; it decides no application behaviour.
 */
class NativeVoiceBoundaryFake implements TTSEngine {
  readonly id = ENGINE_ID;
  readonly displayName = 'Batch5 Speak Voice';
  readonly capabilities = {
    streaming: true, voiceCloning: false, pauseResume: true,
    generateAndSave: false, peakRamMB: 120,
  };
  /** Every native call, in order — the seam the supersede ordering is read from. */
  readonly calls: NativeCall[] = [];
  /** When set, `speak` blocks on it (a synthesis still in flight). */
  pending: Deferred | null = null;
  /** When true, a blocked `speak` first emits the native "audio flowing" phase. */
  emitProcessingOnSpeak = false;
  /** When true, `initialize` leaves the runtime not-ready (a failed load). */
  initializeStaysIdle = false;

  private phase: ReturnType<TTSEngine['getPhase']> = 'idle';
  private downloaded = true;
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
  private emit<K extends keyof TTSEngineEvents>(event: K, ...args: any[]) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }

  /** The runtime moved to a new phase and told everyone, exactly as native does. */
  setPhase(phase: ReturnType<TTSEngine['getPhase']>) {
    this.phase = phase;
    this.emit('phaseChange', phase);
  }

  getPhase() { return this.phase; }
  getLastDownloadError() { return null; }
  isSupported() { return true; }
  async initialize() {
    this.calls.push({ op: 'initialize' });
    if (this.initializeStaysIdle) return;
    this.setPhase('ready');
  }
  async release() { this.setPhase('idle'); }
  async destroy() { this.setPhase('idle'); this.downloaded = false; }
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
    return [{ id: 'af_heart', label: 'Heart', metadata: { languageCode: 'en' } }];
  }
  getActiveVoice() { return this.getVoices()[0]; }
  async setVoice() {}
  async speak(text: string, options?: { messageId?: string }) {
    this.calls.push({ op: 'speak', text, messageId: options?.messageId });
    if (!this.pending) return;
    if (this.emitProcessingOnSpeak) this.setPhase('processing');
    await this.pending.promise;
  }
  async generateAndSave(): Promise<never> { throw new Error('unsupported'); }
  stop() { this.calls.push({ op: 'stop' }); this.pending?.resolve(); }
  pause() {}
  resume() {}
  setSpeed() {}
}

describe('speakMessage state machine — real store, real playback service, native runtime faked', () => {
  const native = new NativeVoiceBoundaryFake();
  let fixture: MobileApplicationFixture;
  let ttsRegistry: typeof import('../../pro/audio/engine')['ttsRegistry'];
  let useTTSStore: typeof import('../../pro/audio/ttsStore')['useTTSStore'];
  let voiceControlService: typeof import('../../pro/audio/ttsControlService')['voiceControlService'];

  const getState = () => useTTSStore.getState();

  beforeAll(async () => {
    installNativeBoundary();
    ({ ttsRegistry } = require('../../pro/audio/engine') as typeof import('../../pro/audio/engine'));
    ttsRegistry.register(ENGINE_ID, () => native);
    const { startMobileApplicationFixture } =
      require('../harness/mobileApplicationFixture') as typeof import('../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture({ pro: true });
    ({ useTTSStore } = require('../../pro/audio/ttsStore') as typeof import('../../pro/audio/ttsStore'));
    ({ voiceControlService } =
      require('../../pro/audio/ttsControlService') as typeof import('../../pro/audio/ttsControlService'));

    // Arrive the way the user does: pick the voice engine, turn speech on, download it.
    const projection = { set: useTTSStore.setState, get: useTTSStore.getState };
    await useTTSStore.getState().setEngine(ENGINE_ID);
    useTTSStore.getState().updateSettings({ enabled: true });
    await voiceControlService.download(projection);
    native.setPhase('ready');
  });

  afterAll(async () => {
    await useTTSStore.getState().releaseEngine();
    await ttsRegistry.unregister(ENGINE_ID);
    await fixture.dispose();
  });

  beforeEach(() => {
    native.calls.length = 0;
    native.pending = null;
    native.emitProcessingOnSpeak = false;
    native.initializeStaysIdle = false;
    native.setPhase('ready');
  });

  /** Bring the machine back to idle through the real stop gesture. */
  const settle = async (inFlight?: Promise<void>) => {
    native.pending?.resolve();
    native.pending = null;
    useTTSStore.getState().stop();
    if (inFlight) await inFlight;
    await waitFor(() => getState().playbackStatus === 'idle', 'machine back to idle');
  };

  it('drops a tap that arrives while the first synthesis is still preparing', async () => {
    // The first tap: synthesis is slow, so the machine sits in `preparing`.
    native.pending = deferred();
    const first = getState().speak('old text', 'm-old');
    await waitFor(() => native.calls.some(call => call.op === 'speak'), 'first synthesis to start');
    expect(getState().playbackStatus).toBe('preparing'); // precondition, reached for real
    expect(getState().currentMessageId).toBe('m-old');

    // A second tap during that window would race a stop() mid-load and crash the
    // freshly loaded stream. It must be dropped entirely.
    await getState().speak('new text', 'm-different');

    expect(native.calls.filter(call => call.op === 'speak')).toHaveLength(1);
    expect(native.calls.some(call => call.op === 'stop')).toBe(false);
    expect(getState().playbackStatus).toBe('preparing'); // untouched
    expect(getState().currentMessageId).toBe('m-old');

    await settle(first);
  });

  it('stops the DIFFERENT message that is playing before starting the new one', async () => {
    // Arrive at real playback: the runtime reports audio flowing, which the engine
    // subscription turns into the machine's `flowing` event → status `playing`.
    native.pending = deferred();
    native.emitProcessingOnSpeak = true;
    const first = getState().speak('old text', 'm-old');
    await waitFor(() => getState().playbackStatus === 'playing', 'audio to start flowing');
    expect(getState().playbackStatus).toBe('playing'); // precondition, reached for real
    expect(getState().currentMessageId).toBe('m-old');

    native.emitProcessingOnSpeak = false;
    await getState().speak('new text', 'm-new');
    await first;
    native.pending = null;

    // One stream at a time: the old one is stopped BEFORE the new one is spoken,
    // and nothing stops the new one afterwards.
    const oldSpeak = native.calls.findIndex(call => call.op === 'speak' && call.messageId === 'm-old');
    const newSpeak = native.calls.findIndex(call => call.op === 'speak' && call.messageId === 'm-new');
    const stops = native.calls.flatMap((call, index) => (call.op === 'stop' ? [index] : []));
    expect(native.calls.filter(call => call.op === 'speak')).toEqual([
      { op: 'speak', text: 'old text', messageId: 'm-old' },
      { op: 'speak', text: 'new text', messageId: 'm-new' },
    ]);
    expect(oldSpeak).toBe(0);                                     // the old stream ran first
    expect(stops.length).toBeGreaterThan(0);                      // it was stopped
    expect(Math.min(...stops)).toBeGreaterThan(oldSpeak);         // …after it started…
    expect(Math.max(...stops)).toBeLessThan(newSpeak);            // …and BEFORE the new one speaks
    expect(newSpeak).toBe(native.calls.length - 1);               // the new stream is left running
  });

  it('bails to idle, with the reason surfaced, when the voice model has been deleted', async () => {
    // device case 33: the user deleted the voice model. Tapping speak must not crash.
    const projection = { set: useTTSStore.setState, get: useTTSStore.getState };
    await voiceControlService.removeDownload(projection);
    try {
      await expect(getState().speak('hello', 'm1')).resolves.toBeUndefined();

      expect(native.calls.some(call => call.op === 'speak')).toBe(false);
      expect(getState().error).toMatch(/no compatible voice model is ready/i);
      expect(getState().playbackStatus).toBe('idle');
      expect(getState().currentMessageId).toBeNull();
    } finally {
      await voiceControlService.download(projection);
      native.setPhase('ready');
    }
  });

  it('bails to idle when the runtime stays not-ready even after an initialize attempt', async () => {
    // Downloaded but unloaded → speak initializes through the residency lock. If the
    // runtime is still not ready afterwards it must settle to idle, not stick on
    // preparing, and the user must be told why.
    native.initializeStaysIdle = true;
    native.setPhase('idle');

    await expect(getState().speak('hello', 'm1')).resolves.toBeUndefined();

    expect(native.calls).toContainEqual({ op: 'initialize' }); // the load was attempted
    expect(native.getPhase()).toBe('idle');                    // and it did not take
    expect(native.calls.some(call => call.op === 'speak')).toBe(false);
    expect(getState().error).toMatch(/not ready/i);
    expect(getState().playbackStatus).toBe('idle');
    expect(getState().currentMessageId).toBeNull();
  });

  it('surfaces the runtime error and returns to idle when synthesis fails', async () => {
    const failing = deferred();
    failing.promise.catch(() => {}); // the rejection is consumed by the production path
    failing.reject(new Error('synthesis blew up'));
    native.pending = failing;

    await expect(getState().speak('hello', 'm1')).resolves.toBeUndefined(); // never rethrown to the UI

    expect(getState().error).toMatch(/synthesis blew up/i);
    expect(getState().playbackStatus).toBe('idle');
    expect(getState().currentMessageId).toBeNull();
  });
});
