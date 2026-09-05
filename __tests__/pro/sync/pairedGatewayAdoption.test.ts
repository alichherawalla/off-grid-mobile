// The app's model-service composition: loading it registers the selection command port that removing
// a server clears, exactly as it is registered at startup.
import '@offgrid/core/services/modelServices';
import { discoveredRemoteModels } from '../../../src/stores/remoteServerProjection';
import { useRemoteServerStore } from '@offgrid/core/stores/remoteServerStore';
import { resetStores, waitFor } from '../../utils/testHelpers';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { manualMeshEndpointStore } from '../../../pro/sync/manualMeshEndpoint';
import { initPairedGatewayAdoption } from '../../../pro/sync/pairedGatewayAdoption';
import { getMobileApplication } from '../../../src/services/composition/application';
import {pairingSecretStore} from '../../../pro/sync/pairingSecretStore';
import {publishSavedRoster} from '../../../pro/sync/savedRoster';
import type {DeviceInfo, PairedDevice} from '@offgrid/sync';

/**
 * A device you paired is a remote server you can use. You paired the Mac once; you should not also
 * type its address into Remote Servers.
 *
 * Drives the real paired-gateway adoption from the durable pairing adapter, through its production
 * roster publication, the registered Shared application, and the real Mobile remote-server ports.
 * The only fake is the network: `fetch` answers as an Off Grid Desktop
 * gateway would at the address the Mac is reachable on, and refuses every other address. Nothing of
 * ours is mocked; the outcome is read where the app reads it - the saved servers, their health and
 * the models discovered on them.
 *
 * Pairing is committed through the same persistence port that Shared Sync owns. The test does not
 * arrange consumer state; the production roster publisher projects that durable fact.
 */
describe('a paired Mac is adopted as a remote server', () => {
  const GATEWAY_PORT = 7878;
  const LAN_HOST = '10.0.0.5';
  const PRIVATE_HOST = '100.64.0.9';

  const json = (payload: unknown) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });
  const notFound = () => ({
    ok: false,
    status: 404,
    headers: { get: () => null },
    json: async () => ({}),
    text: async () => '{}',
  });

  /** An Off Grid Desktop gateway reachable ONLY at `host`. */
  const desktopGatewayAt = (host: string) =>
    jest.fn(async (url: string) => {
      const target = String(url);
      if (!target.includes(`${host}:${GATEWAY_PORT}`)) return notFound();
      if (target.endsWith('/v1/models/catalog')) {
        return json({
          kinds: ['text'],
          models: [{ id: 'qwen3-8b', name: 'Qwen3 8B', kind: 'text' }],
        });
      }
      if (target.endsWith('/v1/models/installed')) return json({ installed: ['qwen3-8b'] });
      if (target.endsWith('/v1/models/active')) return json({ text: 'qwen3-8b' });
      if (target.endsWith('/v1/models')) {
        return json({ object: 'list', data: [{ id: 'qwen3-8b', object: 'model', owned_by: 'local' }] });
      }
      return notFound();
    });

  const mac = (overrides: Partial<{ host: string; privateHost: string }> = {}): DeviceInfo => ({
        id: 'mac',
        name: 'Mac',
        platform: 'macos',
        version: '1.0.0',
        host: overrides.host ?? LAN_HOST,
        port: 4040,
        gatewayPort: GATEWAY_PORT,
        ...(overrides.privateHost ? { privateHost: overrides.privateHost } : {}),
      });

  const paired = (device: DeviceInfo): PairedDevice => ({
    ...device,
    membershipId: `membership-${device.id}`,
    sharedSecret: `secret-${device.id}`,
    pairedAt: 1,
    lastConnected: 1,
  });

  const publishRoster = async (devices: readonly DeviceInfo[]): Promise<void> => {
    const requested = new Set(devices.map(device => device.id));
    for (const existing of pairingSecretStore.list()) {
      if (!requested.has(existing.device.id)) {
        await pairingSecretStore.removePaired(existing.device.id);
      }
    }
    for (const device of devices) {
      if (pairingSecretStore.getActive(device.id)) {
        await pairingSecretStore.observe(device);
        continue;
      }
      const value = paired(device);
      await pairingSecretStore.beginPairing(value);
      await pairingSecretStore.commitPairing(value);
    }
    publishSavedRoster();
  };

  const servers = () => useRemoteServerStore.getState().servers;
  const pairedServer = () => servers().find(server => server.id === 'paired:mac');

  let stop: (() => void) | null = null;

  beforeAll(() => {
    // Construct the registered Shared application that owns paired-server adoption.
    getMobileApplication();
  });

  beforeEach(async () => {
    resetStores();
    useRemoteServerStore.setState({ servers: [], serverHealth: {} });
    useSyncStore.getState().reset();
    manualMeshEndpointStore.resetCache();
    pairingSecretStore.resetCache();
    await pairingSecretStore.load();
    await publishRoster([]);
  });

  afterEach(() => {
    stop?.();
    stop = null;
  });

  it('saves the Mac as a remote server at its LAN address, healthy, with its models discovered', async () => {
    (global as unknown as { fetch: unknown }).fetch = desktopGatewayAt(LAN_HOST);
    stop = initPairedGatewayAdoption();

    // Before the roster has been read, an empty list means "not looked yet", not "no devices".
    expect(servers()).toEqual([]);

    await publishRoster([mac()]);
    await waitFor(() => useRemoteServerStore.getState().serverHealth['paired:mac'] !== undefined, {
      timeout: 5000,
    });

    expect(pairedServer()).toMatchObject({
      id: 'paired:mac',
      name: 'Mac',
      endpoint: `http://${LAN_HOST}:${GATEWAY_PORT}/v1`,
      modelManagement: 'offgrid-desktop-v1',
    });
    expect(useRemoteServerStore.getState().serverHealth['paired:mac']?.status).toBe('healthy');
    expect(
      (discoveredRemoteModels(useRemoteServerStore.getState().servers)['paired:mac'] ?? []).map(model => model.id),
    ).toEqual(['qwen3-8b']);
  });

  it('dials the private address you saved for the Mac when no LAN address is available', async () => {
    (global as unknown as { fetch: unknown }).fetch = desktopGatewayAt(PRIVATE_HOST);
    await manualMeshEndpointStore.save({ deviceId: 'mac', host: PRIVATE_HOST });
    stop = initPairedGatewayAdoption();

    await publishRoster([mac({host: '', privateHost: PRIVATE_HOST})]);
    await waitFor(() => useRemoteServerStore.getState().serverHealth['paired:mac']?.status === 'healthy', {
      timeout: 5000,
    });

    expect(pairedServer()?.endpoint).toBe(`http://${PRIVATE_HOST}:${GATEWAY_PORT}/v1`);
  });

  it('keeps the address that answers when the LAN address is dead', async () => {
    // Client isolation on WiFi lets the Tailscale address through while the LAN address is dead.
    (global as unknown as { fetch: unknown }).fetch = desktopGatewayAt(PRIVATE_HOST);
    stop = initPairedGatewayAdoption();

    await publishRoster([mac({ privateHost: PRIVATE_HOST })]);
    await waitFor(() => useRemoteServerStore.getState().serverHealth['paired:mac']?.status === 'healthy', {
      timeout: 5000,
    });

    expect(pairedServer()?.endpoint).toBe(`http://${PRIVATE_HOST}:${GATEWAY_PORT}/v1`);
  });

  it('a paired phone serves no gateway and yields no server', async () => {
    (global as unknown as { fetch: unknown }).fetch = desktopGatewayAt(LAN_HOST);
    stop = initPairedGatewayAdoption();

    await publishRoster([
      {id: 'phone', name: 'Pixel', platform: 'android', version: '1.0.0', host: LAN_HOST, port: 4040},
    ]);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(servers()).toEqual([]);
  });

  it('forgets the server when the Mac is unpaired', async () => {
    (global as unknown as { fetch: unknown }).fetch = desktopGatewayAt(LAN_HOST);
    stop = initPairedGatewayAdoption();
    await publishRoster([mac()]);
    await waitFor(() => pairedServer() !== undefined, { timeout: 5000 });

    await publishRoster([]);
    await waitFor(() => pairedServer() === undefined, { timeout: 5000 });

    expect(servers()).toEqual([]);
  });
});
