import {
  NativeEventEmitter,
  NativeModules,
  Platform,
  type EmitterSubscription,
} from 'react-native';
import { Buffer } from 'buffer';
import type {
  DeviceInfo,
  DiscoveredDevice,
  SyncDiscoveryHealthSnapshot,
  SyncHealthFact,
  SyncConnection,
  SyncTransportHealthSnapshot,
  TransportBridge,
} from '@offgrid/sync';
import type { DiscoveryService } from '@offgrid/sync';

const PEER_FOUND_EVENT = 'SyncProximityPeerFound';
const PEER_LOST_EVENT = 'SyncProximityPeerLost';
const CONNECTION_OPENED_EVENT = 'SyncProximityConnectionOpened';
const DATA_EVENT = 'SyncProximityData';
const CONNECTION_CLOSED_EVENT = 'SyncProximityConnectionClosed';

interface SyncProximityNativeModule {
  start(device: DeviceInfo): Promise<void>;
  rescan(): Promise<void>;
  stopBrowsing(): Promise<void>;
  startAdvertising(): Promise<void>;
  stopAdvertising(): Promise<void>;
  stop(): Promise<void>;
  updateDevice(device: DeviceInfo): Promise<void>;
  connect(deviceId: string): Promise<string>;
  send(connectionId: string, data: string): void;
  close(connectionId: string): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

interface ConnectionEvent {
  connectionId: string;
  deviceId: string;
}

interface DataEvent extends ConnectionEvent {
  data: string;
}

function nativeModule(): SyncProximityNativeModule {
  const module = NativeModules.SyncProximityModule as
    | SyncProximityNativeModule
    | undefined;
  if (Platform.OS !== 'ios' || !module) {
    throw new Error('Nearby Sync is unavailable on this device.');
  }
  return module;
}

function parseDevice(value: unknown): DiscoveredDevice | null {
  if (!value || typeof value !== 'object') return null;
  const device = value as Partial<DeviceInfo>;
  if (
    typeof device.id !== 'string' ||
    !device.id ||
    typeof device.name !== 'string' ||
    !device.name ||
    (device.platform !== 'ios' &&
      device.platform !== 'macos' &&
      device.platform !== 'android' &&
      device.platform !== 'windows' &&
      device.platform !== 'linux')
  ) {
    return null;
  }
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    version: typeof device.version === 'string' ? device.version : '1',
    host: '',
    port: 0,
    lastSeen: Date.now(),
  };
}

function parseConnectionEvent(value: unknown): ConnectionEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Partial<ConnectionEvent>;
  return typeof event.connectionId === 'string' &&
    event.connectionId &&
    typeof event.deviceId === 'string' &&
    event.deviceId
    ? { connectionId: event.connectionId, deviceId: event.deviceId }
    : null;
}

class IosProximityConnection implements SyncConnection {
  readonly remoteHost: string;
  private dataListener: ((data: Uint8Array) => void) | null = null;
  private readonly closeListeners = new Set<() => void>();
  private readonly pendingData: Uint8Array[] = [];
  private closed = false;

  constructor(
    readonly id: string,
    readonly deviceId: string,
    private readonly native: SyncProximityNativeModule,
  ) {
    this.remoteHost = `proximity:${deviceId}`;
  }

  send(data: Uint8Array): void {
    if (this.closed) return;
    this.native.send(
      this.id,
      Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
        'base64',
      ),
    );
  }

  onData(listener: (data: Uint8Array) => void): void {
    this.dataListener = listener;
    for (const data of this.pendingData.splice(0)) listener(data);
  }

  onClose(listener: () => void): void {
    this.closeListeners.add(listener);
    if (this.closed) listener();
  }

  close(): void {
    if (this.closed) return;
    this.native.close(this.id);
    this.markClosed();
  }

  receive(data: Uint8Array): void {
    if (this.closed) return;
    if (this.dataListener) {
      this.dataListener(data);
    } else {
      this.pendingData.push(data);
    }
  }

  markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.pendingData.length = 0;
    for (const listener of this.closeListeners) listener();
    this.closeListeners.clear();
  }
}

/**
 * Thin iOS MultipeerConnectivity boundary. It exposes the same reliable-byte
 * transport and discovery contracts as LAN TCP/Bonjour; SyncEngine still owns
 * encryption, framing, pairing, heartbeat, and every application payload.
 */
export class IosProximityAdapter implements TransportBridge {
  private readonly native = nativeModule();
  private readonly emitter = new NativeEventEmitter(this.native);
  private readonly subscriptions: EmitterSubscription[] = [];
  private readonly peers = new Set<string>();
  private readonly discoveredDevices = new Map<string, DiscoveredDevice>();
  private readonly connections = new Map<string, IosProximityConnection>();
  private readonly pendingData = new Map<string, Uint8Array[]>();
  private started = false;
  private startTask: Promise<void> | null = null;
  private advertisingTask: Promise<void> = Promise.resolve();
  private advertisingOperations = 0;
  private runtimeHealth: SyncHealthFact = { state: 'idle' };
  private browseHealth: SyncHealthFact = { state: 'idle' };
  private advertiseHealth: SyncHealthFact = { state: 'idle' };
  private advertising = false;
  private inboundConnection: ((connection: SyncConnection) => void) | null =
    null;
  private foundListener: ((device: DiscoveredDevice) => void) | null = null;
  private lostListener: ((deviceId: string) => void) | null = null;

  constructor(private readonly localDevice: DeviceInfo) {}

  readonly discovery: DiscoveryService = {
    start: () => this.ensureStarted(),
    startBrowsing: async () => {
      await this.ensureStarted();
      await this.native.rescan();
      this.browseHealth = { state: 'ready', updatedAt: Date.now() };
    },
    stopBrowsing: async () => {
      if (!this.started) return;
      await this.native.stopBrowsing();
      for (const deviceId of this.peers) this.lostListener?.(deviceId);
      this.peers.clear();
      this.discoveredDevices.clear();
      this.browseHealth = { state: 'stopped', updatedAt: Date.now() };
    },
    rescan: async () => {
      await this.ensureStarted();
      this.browseHealth = { state: 'starting', updatedAt: Date.now() };
      try {
        await this.native.rescan();
        this.browseHealth = { state: 'ready', updatedAt: Date.now() };
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.browseHealth = {
          state: 'failed',
          error: error.message,
          updatedAt: Date.now(),
        };
        throw error;
      }
    },
    advertise: () =>
      this.queueAdvertising(async () => {
        await this.ensureStarted();
        if (this.advertising) {
          this.advertiseHealth = { state: 'ready', updatedAt: Date.now() };
          return;
        }
        this.advertiseHealth = { state: 'starting', updatedAt: Date.now() };
        try {
          await this.native.startAdvertising();
          this.advertising = true;
          this.advertiseHealth = { state: 'ready', updatedAt: Date.now() };
        } catch (cause) {
          const error =
            cause instanceof Error ? cause : new Error(String(cause));
          this.advertiseHealth = {
            state: 'failed',
            error: error.message,
            updatedAt: Date.now(),
          };
          throw error;
        }
      }),
    stopAdvertising: () =>
      this.queueAdvertising(async () => {
        await this.startTask?.catch(() => undefined);
        if (!this.started || !this.advertising) {
          this.advertiseHealth = { state: 'stopped', updatedAt: Date.now() };
          return;
        }
        try {
          await this.native.stopAdvertising();
          this.advertising = false;
          this.advertiseHealth = { state: 'stopped', updatedAt: Date.now() };
        } catch (cause) {
          const error =
            cause instanceof Error ? cause : new Error(String(cause));
          this.advertiseHealth = {
            state: 'failed',
            error: error.message,
            updatedAt: Date.now(),
          };
          throw error;
        }
      }),
    onDeviceFound: listener => {
      this.foundListener = listener;
      for (const device of this.discoveredDevices.values()) listener(device);
    },
    onDeviceLost: listener => {
      this.lostListener = listener;
    },
    stop: () => Promise.resolve(),
    getDiscoveryHealthSnapshot: () => this.discoveryHealthSnapshot(),
  };

  canConnect(remote: DeviceInfo): boolean {
    return this.peers.has(remote.id);
  }

  async listen(
    _port: number,
    onConnection: (connection: SyncConnection) => void,
  ): Promise<void> {
    this.inboundConnection = onConnection;
    await this.ensureStarted();
  }

  async connect(
    _host: string,
    _port: number,
    remote?: DeviceInfo,
  ): Promise<SyncConnection> {
    if (!remote || !this.canConnect(remote)) {
      throw new Error('The device is not available nearby.');
    }
    await this.ensureStarted();
    const connectionId = await this.native.connect(remote.id);
    const existing = this.connections.get(connectionId);
    if (existing) return existing;
    return this.createConnection(connectionId, remote.id);
  }

  async stop(): Promise<void> {
    if (!this.started && !this.startTask && this.advertisingOperations === 0)
      return;
    await this.startTask?.catch(() => undefined);
    await this.advertisingTask.catch(() => undefined);
    await this.native.stop();
    this.started = false;
    this.startTask = null;
    this.runtimeHealth = { state: 'stopped', updatedAt: Date.now() };
    this.browseHealth = { state: 'stopped', updatedAt: Date.now() };
    this.advertiseHealth = { state: 'stopped', updatedAt: Date.now() };
    this.advertising = false;
    this.peers.clear();
    this.discoveredDevices.clear();
    for (const connection of this.connections.values()) {
      connection.markClosed();
    }
    this.connections.clear();
    this.pendingData.clear();
    for (const subscription of this.subscriptions.splice(0)) {
      subscription.remove();
    }
  }

  async updateLocalDevice(): Promise<void> {
    await this.ensureStarted();
    await this.native.updateDevice(this.localDevice);
  }

  getTransportHealthSnapshot(): SyncTransportHealthSnapshot {
    return {
      listener: { ...this.runtimeHealth },
      routes: [{ id: 'proximity', ...this.runtimeHealth }],
    };
  }

  private ensureStarted(): Promise<void> {
    if (this.started) return Promise.resolve();
    if (this.startTask) return this.startTask;
    this.attachListeners();
    this.runtimeHealth = { state: 'starting', updatedAt: Date.now() };
    this.browseHealth = { state: 'starting', updatedAt: Date.now() };
    this.startTask = this.native
      .start(this.localDevice)
      .then(() => {
        this.started = true;
        const ready = { state: 'ready' as const, updatedAt: Date.now() };
        this.runtimeHealth = ready;
        this.browseHealth = ready;
        this.advertiseHealth = {
          state: 'stopped',
          updatedAt: Date.now(),
        };
        this.advertising = false;
      })
      .catch(error => {
        const failure = {
          state: 'failed' as const,
          error: error instanceof Error ? error.message : String(error),
          updatedAt: Date.now(),
        };
        this.runtimeHealth = failure;
        this.browseHealth = failure;
        this.advertiseHealth = failure;
        this.advertising = false;
        for (const subscription of this.subscriptions.splice(0)) {
          subscription.remove();
        }
        throw error;
      })
      .finally(() => {
        this.startTask = null;
      });
    return this.startTask;
  }

  /** Keep the last advertising request authoritative when taps overlap native work. */
  private queueAdvertising(operation: () => Promise<void>): Promise<void> {
    this.advertisingOperations += 1;
    const task = this.advertisingTask
      .catch(() => undefined)
      .then(operation)
      .finally(() => {
        this.advertisingOperations -= 1;
      });
    this.advertisingTask = task;
    return task;
  }

  private discoveryHealthSnapshot(): SyncDiscoveryHealthSnapshot {
    return {
      routes: [
        {
          id: 'proximity',
          browse: { ...this.browseHealth },
          advertise: { ...this.advertiseHealth },
          peerCount: this.peers.size,
        },
      ],
    };
  }

  private attachListeners(): void {
    if (this.subscriptions.length > 0) return;
    this.subscriptions.push(
      this.emitter.addListener(PEER_FOUND_EVENT, (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        const device = parseDevice((value as { device?: unknown }).device);
        if (!device || device.id === this.localDevice.id) return;
        this.peers.add(device.id);
        this.discoveredDevices.set(device.id, device);
        this.foundListener?.(device);
      }),
      this.emitter.addListener(PEER_LOST_EVENT, (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        const deviceId = (value as { deviceId?: unknown }).deviceId;
        if (typeof deviceId !== 'string') return;
        this.peers.delete(deviceId);
        this.discoveredDevices.delete(deviceId);
        this.lostListener?.(deviceId);
      }),
      this.emitter.addListener(CONNECTION_OPENED_EVENT, (value: unknown) => {
        const event = parseConnectionEvent(value);
        if (!event) return;
        const connection = this.createConnection(
          event.connectionId,
          event.deviceId,
        );
        this.inboundConnection?.(connection);
      }),
      this.emitter.addListener(DATA_EVENT, (value: unknown) => {
        const event = parseConnectionEvent(value);
        const encoded =
          value && typeof value === 'object'
            ? (value as Partial<DataEvent>).data
            : undefined;
        if (!event || typeof encoded !== 'string') return;
        const data = new Uint8Array(Buffer.from(encoded, 'base64'));
        const connection = this.connections.get(event.connectionId);
        if (connection) {
          connection.receive(data);
          return;
        }
        const pending = this.pendingData.get(event.connectionId) ?? [];
        pending.push(data);
        this.pendingData.set(event.connectionId, pending);
      }),
      this.emitter.addListener(CONNECTION_CLOSED_EVENT, (value: unknown) => {
        const event = parseConnectionEvent(value);
        if (!event) return;
        this.pendingData.delete(event.connectionId);
        const connection = this.connections.get(event.connectionId);
        this.connections.delete(event.connectionId);
        connection?.markClosed();
      }),
    );
  }

  private createConnection(
    connectionId: string,
    deviceId: string,
  ): IosProximityConnection {
    const existing = this.connections.get(connectionId);
    if (existing) return existing;
    const connection = new IosProximityConnection(
      connectionId,
      deviceId,
      this.native,
    );
    this.connections.set(connectionId, connection);
    for (const data of this.pendingData.get(connectionId) ?? []) {
      connection.receive(data);
    }
    this.pendingData.delete(connectionId);
    return connection;
  }
}
