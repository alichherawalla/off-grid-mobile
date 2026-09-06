import { Buffer } from 'buffer';
import {
  createTxtRecord,
  isDialableAddress,
  type DeviceInfo,
} from '@offgrid/sync';

/** A plausible LAN address for an advertised peer. Anything but loopback, which is refused on purpose. */
export const ADVERTISED_LAN_ADDRESS = '192.168.1.50';
import type { RnTcpModule } from '@offgrid/sync/rn';

type Handler = (...args: unknown[]) => void;

class NativeSocketBoundary {
  peer?: NativeSocketBoundary;
  remoteAddress = '127.0.0.1';
  private closed = false;
  private readonly handlers = new Map<string, Handler[]>();

  on(event: string, callback: Handler): this {
    const callbacks = this.handlers.get(event) ?? [];
    callbacks.push(callback);
    this.handlers.set(event, callbacks);
    return this;
  }

  write(data: unknown): boolean {
    const encoded = Buffer.from(data as Uint8Array).toString('base64');
    setImmediate(() => this.peer?.emit('data', encoded));
    return true;
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    const peer = this.peer;
    setImmediate(() => this.emit('close'));
    if (peer && !peer.closed) {
      peer.closed = true;
      setImmediate(() => peer.emit('close'));
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
}

/** Every dial this boundary was asked to make, so a test can tell "never tried" from "tried and failed". */
export interface TcpDialRecord {
  port: number;
  host?: string;
  refused?: string;
}

let dials: TcpDialRecord[] = [];
const routedPorts = new Map<number, number>();

export function getTcpDials(): readonly TcpDialRecord[] {
  return dials;
}

export function resetTcpDials(): void {
  dials = [];
}

/** Route one advertised port to the listener that represents a different fake host. */
export function routeTcpPort(
  advertisedPort: number,
  listenerPort: number,
): void {
  routedPorts.set(advertisedPort, listenerPort);
}

export function resetTcpPortRoutes(): void {
  routedPorts.clear();
}

export function createNativeTcpBoundary(): RnTcpModule {
  const servers = new Map<number, (socket: NativeSocketBoundary) => void>();
  let nextPort = 43000;

  return {
    createServer(onConnection) {
      let port = 0;
      const server = {
        on: () => server,
        listen(options: { port: number }, callback?: () => void) {
          port = options.port || nextPort++;
          servers.set(port, onConnection);
          callback?.();
        },
        address: () => ({ port }),
        close: () => {
          servers.delete(port);
        },
      };
      return server;
    },
    createConnection(options, callback) {
      const listenerPort = routedPorts.get(options.port) ?? options.port;
      const onConnection = servers.get(listenerPort);
      if (!onConnection) {
        // Recorded before throwing: a dial to a port nothing is listening on is a real outcome, and a
        // test that only sees the throw cannot tell it apart from a dial that never happened.
        dials.push({
          port: options.port,
          host: options.host,
          refused: `no native server on port ${options.port}`,
        });
        throw new Error(`No native server on port ${options.port}`);
      }
      dials.push({ port: options.port, host: options.host });

      const client = new NativeSocketBoundary();
      const server = new NativeSocketBoundary();
      client.peer = server;
      server.peer = client;
      setImmediate(() => {
        onConnection(server);
        callback?.();
      });
      return client;
    },
  };
}

export interface DiscoveryBoundary {
  publishedPort?: number;
  scanCount: number;
  stopCount: number;
  resolve(device: DeviceInfo): void;
  lose(deviceId: string): void;
}

let boundaries: DiscoveryBoundary[] = [];

export function createNativeDiscoveryBoundary(): new () => DiscoveryBoundary {
  return class NativeDiscoveryBoundary implements DiscoveryBoundary {
    publishedPort?: number;
    scanCount = 0;
    stopCount = 0;
    private readonly handlers = new Map<string, Handler>();
    private nativeListenersActive = true;

    constructor() {
      boundaries.push(this);
    }

    on(event: string, callback: Handler): void {
      this.handlers.set(event, callback);
    }

    scan(): void {
      this.scanCount += 1;
    }
    stop(): void {
      this.stopCount += 1;
    }
    removeDeviceListeners(): void {
      this.nativeListenersActive = false;
    }
    publishService(
      _type: string,
      _protocol: string,
      _domain: string,
      _name: string,
      port: number,
    ): void {
      this.publishedPort = port;
    }
    unpublishService(): void {}

    resolve(device: DeviceInfo): void {
      if (!this.nativeListenersActive) return;
      // Advertise a LAN address, which is what a real peer advertises.
      //
      // Loopback is deliberately NOT dialable (see isDialableAddress): a peer announcing 127.0.0.1 is
      // announcing itself, and dialling it would reach this device rather than that one. A boundary that
      // announced loopback had every resolve dropped as undialable, so a paired device was never
      // rediscovered and never reconnected - a harness that could not exercise the mesh at all. The
      // sockets themselves are matched by PORT, so the address only has to be plausible.
      const advertised = isDialableAddress(device.host)
        ? device.host
        : ADVERTISED_LAN_ADDRESS;
      this.handlers.get('resolved')?.({
        txt: createTxtRecord({ ...device, host: advertised }),
        addresses: [advertised],
        host: advertised,
        port: device.port,
        name: `OffGrid-${device.id}`,
      });
    }

    lose(deviceId: string): void {
      if (!this.nativeListenersActive) return;
      this.handlers.get('remove')?.(`OffGrid-${deviceId}._offgrid._tcp.local.`);
    }
  };
}

export function getDiscoveryBoundaries(): DiscoveryBoundary[] {
  return boundaries;
}

export function resetDiscoveryBoundaries(): void {
  boundaries = [];
}
