import { NativeEventEmitter, NativeModules } from 'react-native';
import {
  BLOB_FRAME_BYTES,
  BLOB_TOKEN_TTL_MS,
  blobKeyBase64,
  createBlobMaterial,
  type BlobChannelHost,
  type BlobEndpoint,
} from '@offgrid/sync';
import logger from '../../utils/logger';

/**
 * The phone's half of the fast transfer path.
 *
 * Nothing here touches a byte of the payload. One native call hosts an endpoint for an arriving
 * transfer, another streams a local file out through the endpoint a peer offered, and both seal or
 * open the payload as it moves - so a model larger than the phone's memory transfers without ever
 * being held in it, and the thread that draws the screen never sees the bytes.
 *
 * That is the whole reason this exists: on the chunked path every byte was read into JavaScript,
 * base64 encoded, wrapped in JSON, parsed and decoded again, all on the UI thread. The cost was per
 * byte, so no chunk size fixed it - a large model crawled and the app stuttered while it did.
 *
 * The key material is minted here, by the shared rules, and handed down as strings. The native side
 * decides nothing: it moves bytes.
 */

interface BlobNativeModule {
  /** The IPv4 address this device's native sync endpoints can actually listen on. */
  lanAddress?(): Promise<string | null>;
  /** Current IPv4 interfaces. Shared sync code owns route safety and classification. */
  interfaceCandidates?(): Promise<unknown>;
  serve(options: {
    requestId: string;
    destinationPath: string;
    fileSize: number;
    token: string;
    keyBase64: string;
    nonceBase64: string;
    /** The frame size, passed down so one place decides the format for every platform. */
    frameBytes: number;
    /** Payload bytes already on disk; the arriving stream continues from here. */
    offset: number;
    ttlMs: number;
  }): Promise<{ url: string } | null>;
  stream(options: {
    requestId: string;
    sourcePath: string;
    url: string;
    token: string;
    keyBase64: string;
    nonceBase64: string;
    frameBytes: number;
    offset: number;
  }): Promise<{ bytes: number }>;
  release(requestId: string): void;
  abort(requestId: string): void;
}

const PROGRESS_EVENT = 'SyncBlobProgress';
const OUTCOME_EVENT = 'SyncBlobOutcome';

function nativeChannel(): BlobNativeModule | undefined {
  // Android registers under the module's own name; iOS under its class. Same contract either way.
  return (NativeModules.SyncBlobChannelModule ??
    NativeModules.BlobChannelModule) as BlobNativeModule | undefined;
}

/** The address shared by the control socket and native blob endpoint, from one native owner. */
export async function nativeSyncLanAddress(): Promise<string> {
  return (await nativeChannel()?.lanAddress?.()) ?? '';
}

export interface NativePairingRouteCandidate {
  host: string;
  interfaceName?: string;
}

/** Stateless live read for the existing address watcher and the pairing QR flow. */
export async function nativePairingRouteCandidates(): Promise<
  NativePairingRouteCandidate[]
> {
  const value = await nativeChannel()?.interfaceCandidates?.();
  if (!Array.isArray(value)) return [];
  const candidates: NativePairingRouteCandidate[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const candidate = entry as { host?: unknown; interfaceName?: unknown };
    if (typeof candidate.host !== 'string' || candidate.host.length === 0) {
      continue;
    }
    if (
      candidate.interfaceName !== undefined &&
      typeof candidate.interfaceName !== 'string'
    ) {
      continue;
    }
    candidates.push({
      host: candidate.host,
      ...(candidate.interfaceName
        ? { interfaceName: candidate.interfaceName }
        : {}),
    });
  }
  return candidates;
}

/**
 * Whether this build can move bytes natively at all.
 *
 * A device without the module is not a device with a broken transfer: the shared manager falls back
 * to chunks, which is slower and identical in result.
 */
export function hasNativeBlobChannel(): boolean {
  const channel = nativeChannel();
  return typeof channel?.serve === 'function';
}

export function createNativeBlobChannel(
  sharedSecretFor: (deviceId: string) => string | undefined,
): BlobChannelHost {
  const listeners = new Map<string, (bytes: number) => void>();
  const channel = nativeChannel();
  let emitter: NativeEventEmitter | undefined;
  const subscriptions: { remove(): void }[] = [];

  /** One subscription for every transfer: progress arrives tagged with the transfer it belongs to. */
  const watch = (requestId: string, onProgress?: (bytes: number) => void): void => {
    if (onProgress) listeners.set(requestId, onProgress);
    if (subscriptions.length > 0 || !channel) return;
    emitter = new NativeEventEmitter(channel as never);
    subscriptions.push(
      emitter.addListener(
        PROGRESS_EVENT,
        (event: { requestId: string; bytes: number }) => {
          listeners.get(event.requestId)?.(event.bytes);
        },
      ),
      // A payload that failed to verify has to be heard about. Without this the transfer sits at
      // whatever the last byte count was until it times out, which reads as a stall, not a refusal.
      emitter.addListener(
        OUTCOME_EVENT,
        (event: { requestId: string; landed: boolean }) => {
          if (!event.landed) {
            logger.log(`[BLOB] a payload for ${event.requestId} did not verify`);
          }
        },
      ),
    );
  };

  const forget = (requestId: string): void => {
    listeners.delete(requestId);
    if (listeners.size > 0) return;
    for (const subscription of subscriptions.splice(0)) subscription.remove();
  };

  return {
    // The payload is sealed for the length of its journey, so this channel may carry anything the
    // control socket would have carried.
    encrypted: true,

    async serve(request) {
      const secret = sharedSecretFor(request.deviceId);
      // No pairing secret, no key, no endpoint. A payload never travels unprotected because a lookup
      // failed - it travels on the slower path instead.
      if (!channel || !secret || request.mode !== 'upload') return undefined;
      const material = createBlobMaterial(secret, request.requestId);
      watch(request.requestId, request.onProgress);
      const offered = await channel.serve({
        requestId: request.requestId,
        destinationPath: request.filePath,
        fileSize: request.fileSize,
        token: material.token,
        keyBase64: material.keyBase64,
        nonceBase64: material.nonceBase64,
        frameBytes: BLOB_FRAME_BYTES,
        offset: request.offset ?? 0,
        ttlMs: BLOB_TOKEN_TTL_MS,
      });
      if (!offered) {
        forget(request.requestId);
        return undefined;
      }
      logger.log(`[BLOB] serving ${request.fileSize} bytes for ${request.requestId}`);
      return {
        url: offered.url,
        token: material.token,
        mode: 'upload',
        nonce: material.nonceBase64,
      } satisfies BlobEndpoint;
    },

    async stream(transfer) {
      const secret = sharedSecretFor(transfer.deviceId);
      const { endpoint } = transfer;
      if (!channel) throw new Error('this build cannot stream natively');
      if (endpoint.mode !== 'upload') {
        throw new Error('a download endpoint is fetched, not streamed to');
      }
      if (!secret || !endpoint.nonce) {
        throw new Error('the payload cannot be encrypted for this peer');
      }
      watch(transfer.requestId, transfer.onProgress);
      try {
        await channel.stream({
          requestId: transfer.requestId,
          sourcePath: transfer.filePath,
          url: endpoint.url,
          token: endpoint.token,
          keyBase64: blobKeyBase64(secret, transfer.requestId),
          nonceBase64: endpoint.nonce,
          frameBytes: BLOB_FRAME_BYTES,
          offset: transfer.offset ?? 0,
        });
        logger.log(`[BLOB] streamed ${transfer.fileSize} bytes natively`);
      } finally {
        forget(transfer.requestId);
      }
    },

    release(requestId) {
      channel?.release(requestId);
      forget(requestId);
    },

    /**
     * Stop sending a payload that is still going out.
     *
     * Cancel has to reach the bytes: stopping the promise only stops the watching, and the platform
     * would carry on sending a model to a peer that is no longer expecting it.
     */
    abort(requestId) {
      channel?.abort(requestId);
      forget(requestId);
    },
  };
}
