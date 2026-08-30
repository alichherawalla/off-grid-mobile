import { getIpAddress } from 'react-native-device-info';
import { remoteServerManager } from '../../../src/services/remoteServerManager';
import { useAppStore } from '../../../src/stores/appStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';

jest.mock('react-native-device-info', () => ({
  getIpAddress: jest.fn(),
  isEmulator: jest.fn(() => Promise.resolve(false)),
}));

const modelList = () =>
  new Response(JSON.stringify({ object: 'list', data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('remote server reconnect', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    useRemoteServerStore.getState().clearAllServers();
    useAppStore.getState().updateSettings({ autoDiscoverRemoteModels: false });
    (getIpAddress as jest.Mock).mockResolvedValue('192.168.1.30');
  });

  afterEach(() => {
    useRemoteServerStore.getState().clearAllServers();
    useAppStore.getState().updateSettings({ autoDiscoverRemoteModels: false });
    global.fetch = originalFetch;
  });

  it('keeps a reachable saved server when another discovered server uses the same port', async () => {
    const endpointA = 'http://192.168.1.10:7878';
    const endpointB = 'http://192.168.1.20:7878';
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (
        url === `${endpointA}/v1/models` ||
        url === `${endpointB}/v1/models`
      ) {
        return Promise.resolve(modelList());
      }
      return Promise.reject(new Error('no server'));
    });
    const serverId = useRemoteServerStore.getState().addServer({
      name: 'Desktop A',
      endpoint: endpointA,
      providerType: 'openai-compatible',
    });

    const result = await remoteServerManager.scanAndReconcile();

    expect(
      useRemoteServerStore.getState().getServerById(serverId)?.endpoint,
    ).toBe(endpointA);
    expect(result).toEqual({
      moved: [],
      found: [
        {
          endpoint: endpointB,
          type: 'gateway',
          name: 'Off Grid AI Gateway (192.168.1.20)',
        },
      ],
    });
  });

  it('scans when auto-discovery is enabled and the active server is reachable', async () => {
    const endpoint = 'http://192.168.1.10:7878';
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${endpoint}/v1/models`) return Promise.resolve(modelList());
      return Promise.reject(new Error('no server'));
    });
    const store = useRemoteServerStore.getState();
    const serverId = store.addServer({
      name: 'Desktop',
      endpoint,
      providerType: 'openai-compatible',
    });
    store.setActiveServerId(serverId);
    useAppStore.getState().updateSettings({ autoDiscoverRemoteModels: true });

    await remoteServerManager.recoverActiveConnection();

    expect(
      useRemoteServerStore.getState().serverHealth[serverId]?.isHealthy,
    ).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.1.2:7878/v1/models',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
