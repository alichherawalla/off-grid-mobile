import { NativeModules } from 'react-native';
import {
  BLOB_FRAME_BYTES,
  BLOB_TOKEN_TTL_MS,
  blobKeyBase64,
  type BlobEndpoint,
} from '@offgrid/sync';
import { NativeEventBus } from '../../utils/nativeEventBus';
import {
  createNativeBlobChannel,
  hasNativeBlobChannel,
  nativePairingRouteCandidates,
} from '../../../src/services/sync/nativeBlobChannel';

jest.mock('react-native', () => {
  const { FakeNativeEventEmitter } = require('../../utils/nativeEventBus');
  return {
    NativeModules: {},
    NativeEventEmitter: FakeNativeEventEmitter,
  };
});

const PROGRESS_EVENT = 'SyncBlobProgress';
const OUTCOME_EVENT = 'SyncBlobOutcome';

interface ServeOptions {
  requestId: string;
  destinationPath: string;
  fileSize: number;
  token: string;
  keyBase64: string;
  nonceBase64: string;
  frameBytes: number;
  offset: number;
  ttlMs: number;
}

interface StreamOptions {
  requestId: string;
  sourcePath: string;
  url: string;
  token: string;
  keyBase64: string;
  nonceBase64: string;
  frameBytes: number;
  offset: number;
}

/** The platform's byte mover: it is handed key material and a path, and it decides nothing. */
class BlobNativeFake extends NativeEventBus {
  readonly served: ServeOptions[] = [];
  readonly streamed: StreamOptions[] = [];
  readonly released: string[] = [];
  readonly aborted: string[] = [];
  /** null is a platform that cannot host an endpoint right now - no port, no permission. */
  endpoint: { url: string } | null = { url: 'http://192.168.1.50:9999/blob/1' };
  streamFailure: Error | undefined;
  candidates: unknown = [];

  async interfaceCandidates(): Promise<unknown> {
    return this.candidates;
  }

  async serve(options: ServeOptions): Promise<{ url: string } | null> {
    this.served.push(options);
    return this.endpoint;
  }

  async stream(options: StreamOptions): Promise<{ bytes: number }> {
    this.streamed.push(options);
    if (this.streamFailure) throw this.streamFailure;
    return { bytes: options.frameBytes };
  }

  release(requestId: string): void {
    this.released.push(requestId);
  }

  abort(requestId: string): void {
    this.aborted.push(requestId);
  }
}

/**
 * The fast path a large file actually takes between two devices.
 *
 * Nothing in this file touches a byte. The platform moves them, sealed, straight between disk and socket -
 * which is the whole point: on the chunked path every byte was read into JavaScript, base64 encoded, wrapped
 * in JSON, parsed and decoded again, all on the thread that draws the screen. The cost was per byte, so no
 * chunk size fixed it; a large model crawled and the app stuttered while it did.
 *
 * Two properties are worth breaking a test over. A payload NEVER travels unprotected because a key lookup
 * failed - it takes the slower path instead. And a cancel has to reach the bytes, not just the promise, or
 * the platform keeps sending a model to a peer that stopped expecting it.
 *
 * The key material comes from the shared package, and the test derives what it expects from the same
 * function the code does, so the derivation is defined in exactly one place.
 */
describe('moving a large file natively between two devices', () => {
  const native = NativeModules as {
    SyncBlobChannelModule?: BlobNativeFake;
    BlobChannelModule?: BlobNativeFake;
  };

  const SECRET = 'the-pairing-secret';

  let platform: BlobNativeFake;

  const channelFor = (
    secrets: Record<string, string> = { 'the-mac': SECRET },
  ) => createNativeBlobChannel(deviceId => secrets[deviceId]);

  const request = (overrides: Record<string, unknown> = {}) => ({
    requestId: 'transfer-1',
    deviceId: 'the-mac',
    filePath: '/docs/incoming/model.gguf',
    fileSize: 4_000_000_000,
    mode: 'upload' as const,
    ...overrides,
  });

  const uploadEndpoint = (
    overrides: Partial<BlobEndpoint> = {},
  ): BlobEndpoint =>
    ({
      url: 'http://192.168.1.51:9999/blob/1',
      token: 'the-token',
      mode: 'upload',
      nonce: 'bm9uY2UtZnJvbS1wZWVy',
      ...overrides,
    } as BlobEndpoint);

  beforeEach(() => {
    platform = new BlobNativeFake();
    native.SyncBlobChannelModule = platform;
    delete native.BlobChannelModule;
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    delete native.SyncBlobChannelModule;
    delete native.BlobChannelModule;
    jest.restoreAllMocks();
  });

  describe('whether this build can do it at all', () => {
    it('says yes when the platform can move bytes', () => {
      expect(hasNativeBlobChannel()).toBe(true);
    });

    it('says yes for the module registered under its iOS name', () => {
      delete native.SyncBlobChannelModule;
      native.BlobChannelModule = platform;

      // Android registers under the module's own name, iOS under its class. Same contract, and a build that
      // reported false here would silently take the slow path on one whole platform.
      expect(hasNativeBlobChannel()).toBe(true);
    });

    it('says no when there is no module in the build', () => {
      delete native.SyncBlobChannelModule;

      // Not a broken transfer: the shared manager falls back to chunks, which is slower and identical in
      // result.
      expect(hasNativeBlobChannel()).toBe(false);
    });

    it('says no for a module that cannot serve', () => {
      native.SyncBlobChannelModule = {} as BlobNativeFake;

      expect(hasNativeBlobChannel()).toBe(false);
    });
  });

  describe('listing this device routes for pairing', () => {
    it('preserves interface identity for the shared route projector', async () => {
      platform.candidates = [
        { host: '192.168.1.20', interfaceName: 'en0' },
        { host: '100.84.2.9', interfaceName: 'utun4' },
      ];

      await expect(nativePairingRouteCandidates()).resolves.toEqual([
        { host: '192.168.1.20', interfaceName: 'en0' },
        { host: '100.84.2.9', interfaceName: 'utun4' },
      ]);
    });

    it('fails closed when native data is absent or malformed', async () => {
      platform.candidates = [
        null,
        '192.168.1.20',
        { host: '' },
        { host: '10.0.0.3', interfaceName: 4 },
        { host: '10.0.0.4' },
      ];
      await expect(nativePairingRouteCandidates()).resolves.toEqual([
        { host: '10.0.0.4' },
      ]);

      delete native.SyncBlobChannelModule;
      await expect(nativePairingRouteCandidates()).resolves.toEqual([]);
    });

    it('reads the live interfaces each time the existing address owner asks', async () => {
      let read = 0;
      platform.interfaceCandidates = async () => [
        { host: `192.168.1.${++read}`, interfaceName: 'wlan0' },
      ];

      await expect(nativePairingRouteCandidates()).resolves.toEqual([
        { host: '192.168.1.1', interfaceName: 'wlan0' },
      ]);
      await expect(nativePairingRouteCandidates()).resolves.toEqual([
        { host: '192.168.1.2', interfaceName: 'wlan0' },
      ]);
    });
  });

  describe('offering somewhere for a file to land', () => {
    it('hands the platform the key material and offers the peer the endpoint', async () => {
      const offered = await channelFor().serve?.(request());

      expect(platform.served).toHaveLength(1);
      const [options] = platform.served;
      expect(options).toMatchObject({
        requestId: 'transfer-1',
        destinationPath: '/docs/incoming/model.gguf',
        fileSize: 4_000_000_000,
        // One place decides the frame size and the token's life for every platform.
        frameBytes: BLOB_FRAME_BYTES,
        ttlMs: BLOB_TOKEN_TTL_MS,
        offset: 0,
      });
      // Derived from the same function the code uses: the peer derives the same key from the same pairing
      // secret, so a second definition of this rule anywhere would break every transfer.
      expect(options.keyBase64).toBe(blobKeyBase64(SECRET, 'transfer-1'));
      expect(offered).toEqual({
        url: 'http://192.168.1.50:9999/blob/1',
        token: options.token,
        mode: 'upload',
        nonce: options.nonceBase64,
      });
    });

    it('mints fresh material for every transfer', async () => {
      const channel = await channelFor();
      await channel.serve?.(request());
      await channel.serve?.(request({ requestId: 'transfer-2' }));

      // A reused nonce with the same key is the one thing that breaks this cipher outright, and a reused
      // token would let a stale peer collect the next transfer.
      expect(platform.served[0].nonceBase64).not.toBe(
        platform.served[1].nonceBase64,
      );
      expect(platform.served[0].token).not.toBe(platform.served[1].token);
    });

    it('continues from the bytes already on disk when a transfer resumes', async () => {
      await channelFor().serve?.(request({ offset: 3 * BLOB_FRAME_BYTES }));

      // Resume is the reason a 4 GB transfer over a phone hotspot ever finishes.
      expect(platform.served[0].offset).toBe(3 * BLOB_FRAME_BYTES);
    });

    it('refuses to offer an endpoint for a peer it holds no pairing secret for', async () => {
      const offered = await channelFor({}).serve?.(request());

      // The payload takes the slower path instead. Serving without a key would move private data in the
      // clear because a lookup missed.
      expect(offered).toBeUndefined();
      expect(platform.served).toEqual([]);
    });

    it('refuses a download endpoint, which this side does not host', async () => {
      const offered = await channelFor().serve?.(request({ mode: 'download' }));

      expect(offered).toBeUndefined();
      expect(platform.served).toEqual([]);
    });

    it('offers nothing on a build that cannot host', async () => {
      delete native.SyncBlobChannelModule;

      await expect(channelFor().serve?.(request())).resolves.toBeUndefined();
    });

    it('offers nothing when the platform cannot open an endpoint right now', async () => {
      platform.endpoint = null;

      const offered = await channelFor().serve?.(request());

      // No port, no permission - the transfer falls back to chunks rather than reporting an endpoint that
      // does not answer.
      expect(offered).toBeUndefined();
    });
  });

  describe('watching the bytes move', () => {
    it('reports progress to the transfer it belongs to, and only that one', async () => {
      const channel = channelFor();
      const first: number[] = [];
      const second: number[] = [];
      await channel.serve?.(
        request({ onProgress: (b: number) => first.push(b) }),
      );
      await channel.serve?.(
        request({
          requestId: 'transfer-2',
          onProgress: (b: number) => second.push(b),
        }),
      );

      platform.emit(PROGRESS_EVENT, { requestId: 'transfer-1', bytes: 1024 });
      platform.emit(PROGRESS_EVENT, { requestId: 'transfer-2', bytes: 77 });
      platform.emit(PROGRESS_EVENT, { requestId: 'transfer-1', bytes: 2048 });

      // Two transfers run at once, and the bar on each row has to be its own.
      expect(first).toEqual([1024, 2048]);
      expect(second).toEqual([77]);
    });

    it('ignores progress for a transfer nobody is watching', async () => {
      await channelFor().serve?.(request());

      expect(() =>
        platform.emit(PROGRESS_EVENT, { requestId: 'unknown', bytes: 5 }),
      ).not.toThrow();
    });

    it('says so when a payload did not verify', async () => {
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      await channelFor().serve?.(request());

      platform.emit(OUTCOME_EVENT, { requestId: 'transfer-1', landed: false });

      // Without this the row sits at whatever the last byte count was until it times out, which reads as a
      // stall rather than a refusal.
      expect(log.mock.calls.flat().join(' ')).toContain('did not verify');
    });

    it('says nothing when a payload landed', async () => {
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      await channelFor().serve?.(request());
      log.mockClear();

      platform.emit(OUTCOME_EVENT, { requestId: 'transfer-1', landed: true });

      expect(log).not.toHaveBeenCalled();
    });

    it('keeps reporting the other transfer when one of two finishes', async () => {
      const channel = channelFor();
      const first: number[] = [];
      const second: number[] = [];
      await channel.serve?.(
        request({ onProgress: (b: number) => first.push(b) }),
      );
      await channel.serve?.(
        request({
          requestId: 'transfer-2',
          onProgress: (b: number) => second.push(b),
        }),
      );

      channel.release?.('transfer-1');
      platform.emit(PROGRESS_EVENT, { requestId: 'transfer-1', bytes: 1 });
      platform.emit(PROGRESS_EVENT, { requestId: 'transfer-2', bytes: 2 });

      // Tearing the subscription down while another transfer is still running would freeze its progress bar
      // at whatever it last showed.
      expect(first).toEqual([]);
      expect(second).toEqual([2]);
    });

    it('stops listening once the last transfer is done', async () => {
      const channel = channelFor();
      const seen: number[] = [];
      await channel.serve?.(
        request({ onProgress: (b: number) => seen.push(b) }),
      );

      channel.release?.('transfer-1');
      platform.emit(PROGRESS_EVENT, { requestId: 'transfer-1', bytes: 1 });

      expect(seen).toEqual([]);
    });

    it('watches again after everything went quiet', async () => {
      const channel = channelFor();
      const seen: number[] = [];
      await channel.serve?.(request());
      channel.release?.('transfer-1');

      await channel.serve?.(
        request({
          requestId: 'transfer-3',
          onProgress: (b: number) => seen.push(b),
        }),
      );
      platform.emit(PROGRESS_EVENT, { requestId: 'transfer-3', bytes: 9 });

      // A second transfer after the first finished must re-subscribe, or every transfer after the first
      // shows no progress at all.
      expect(seen).toEqual([9]);
    });
  });

  describe('sending a file out through a peer endpoint', () => {
    it('streams it with the key the peer will open it with', async () => {
      await channelFor().stream?.({
        endpoint: uploadEndpoint(),
        deviceId: 'the-mac',
        requestId: 'transfer-1',
        filePath: '/docs/model.gguf',
        fileSize: 4_000_000_000,
      });

      expect(platform.streamed[0]).toEqual({
        requestId: 'transfer-1',
        sourcePath: '/docs/model.gguf',
        url: 'http://192.168.1.51:9999/blob/1',
        token: 'the-token',
        // The peer chose the nonce; this side derives the key from the pairing it shares with it.
        keyBase64: blobKeyBase64(SECRET, 'transfer-1'),
        nonceBase64: 'bm9uY2UtZnJvbS1wZWVy',
        frameBytes: BLOB_FRAME_BYTES,
        offset: 0,
      });
    });

    it('resumes from where the peer already has bytes', async () => {
      await channelFor().stream?.({
        endpoint: uploadEndpoint(),
        deviceId: 'the-mac',
        requestId: 'transfer-1',
        filePath: '/docs/model.gguf',
        fileSize: 4_000_000_000,
        offset: 2 * BLOB_FRAME_BYTES,
      });

      expect(platform.streamed[0].offset).toBe(2 * BLOB_FRAME_BYTES);
    });

    it('reports progress while it streams', async () => {
      const seen: number[] = [];
      const streaming = channelFor().stream?.({
        endpoint: uploadEndpoint(),
        deviceId: 'the-mac',
        requestId: 'transfer-1',
        filePath: '/docs/model.gguf',
        fileSize: 100,
        onProgress: bytes => seen.push(bytes),
      });
      platform.emit(PROGRESS_EVENT, { requestId: 'transfer-1', bytes: 50 });

      await streaming;

      expect(seen).toEqual([50]);
    });

    it('will not stream on a build that cannot', async () => {
      delete native.SyncBlobChannelModule;

      await expect(
        channelFor().stream?.({
          endpoint: uploadEndpoint(),
          deviceId: 'the-mac',
          requestId: 'transfer-1',
          filePath: '/docs/model.gguf',
          fileSize: 1,
        }),
      ).rejects.toThrow('this build cannot stream natively');
    });

    it('will not stream to an endpoint that is meant to be fetched', async () => {
      await expect(
        channelFor().stream?.({
          endpoint: uploadEndpoint({ mode: 'download' }),
          deviceId: 'the-mac',
          requestId: 'transfer-1',
          filePath: '/docs/model.gguf',
          fileSize: 1,
        }),
      ).rejects.toThrow('a download endpoint is fetched, not streamed to');
    });

    it.each([
      ['it holds no pairing secret for the peer', {}, uploadEndpoint()],
      [
        'the peer offered no nonce',
        { 'the-mac': SECRET },
        uploadEndpoint({ nonce: undefined }),
      ],
    ])('refuses to stream when %s', async (_label, secrets, endpoint) => {
      const held: Record<string, string> = secrets;
      await expect(
        createNativeBlobChannel(deviceId => held[deviceId]).stream?.({
          endpoint,
          deviceId: 'the-mac',
          requestId: 'transfer-1',
          filePath: '/docs/model.gguf',
          fileSize: 1,
        }),
      ).rejects.toThrow('the payload cannot be encrypted for this peer');

      // Refused before any byte moves: an unsealed payload on a fast path is the one thing this channel may
      // never do.
      expect(platform.streamed).toEqual([]);
    });

    it('stops watching a stream that failed, and says why it failed', async () => {
      const channel = channelFor();
      const seen: number[] = [];
      platform.streamFailure = new Error('the peer closed the connection');

      await expect(
        channel.stream?.({
          endpoint: uploadEndpoint(),
          deviceId: 'the-mac',
          requestId: 'transfer-1',
          filePath: '/docs/model.gguf',
          fileSize: 1,
          onProgress: bytes => seen.push(bytes),
        }),
      ).rejects.toThrow('the peer closed the connection');

      platform.emit(PROGRESS_EVENT, { requestId: 'transfer-1', bytes: 1 });
      // A failed transfer that kept its listener would leak one per retry, and each retry would report
      // progress into a row that has already been replaced.
      expect(seen).toEqual([]);
    });

    it('declares that it protects the payload, so anything may take this path', () => {
      // The manager only routes private data down a channel that says this. A channel that forgot to would
      // silently limit the fast path to model weights.
      expect(channelFor().encrypted).toBe(true);
    });
  });

  describe('stopping', () => {
    it('lets go of an endpoint once the transfer through it is done', async () => {
      const channel = channelFor();
      await channel.serve?.(request());

      channel.release?.('transfer-1');

      expect(platform.released).toEqual(['transfer-1']);
    });

    it('reaches the bytes when a send is cancelled', async () => {
      const channel = channelFor();
      const seen: number[] = [];
      await channel.serve?.(
        request({ onProgress: (b: number) => seen.push(b) }),
      );

      channel.abort?.('transfer-1');

      // Cancel has to reach the platform: dropping the promise only stops the watching, and the phone would
      // carry on sending a model to a peer that is no longer expecting it.
      expect(platform.aborted).toEqual(['transfer-1']);
      platform.emit(PROGRESS_EVENT, { requestId: 'transfer-1', bytes: 1 });
      expect(seen).toEqual([]);
    });

    it('is safe to release and cancel on a build with no platform support', () => {
      delete native.SyncBlobChannelModule;
      const channel = channelFor();

      expect(() => channel.release?.('transfer-1')).not.toThrow();
      expect(() => channel.abort?.('transfer-1')).not.toThrow();
    });
  });
});
