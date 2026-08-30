import { AppState } from 'react-native';
import { getIpAddress } from 'react-native-device-info';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import {
  startNetworkReconnectWatcher,
  stopNetworkReconnectWatcher,
} from '../../../src/services/networkReconnect';

jest.mock('react-native-device-info', () => ({
  getIpAddress: jest.fn(),
  isEmulator: jest.fn(() => Promise.resolve(false)),
}));

describe('network reconnect watcher', () => {
  let appStateListener: ((state: 'active' | 'background') => void) | undefined;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    stopNetworkReconnectWatcher();
    jest.clearAllMocks();
    useRemoteServerStore.getState().clearAllServers();
    global.fetch = jest.fn(() => Promise.reject(new Error('server offline')));
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        appStateListener = listener as (state: 'active' | 'background') => void;
        return { remove: jest.fn() };
      });
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
  });

  afterEach(() => {
    stopNetworkReconnectWatcher();
    useRemoteServerStore.getState().clearAllServers();
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('validates the active connection after a same-IP foreground rejoin', async () => {
    (getIpAddress as jest.Mock).mockResolvedValue('192.168.1.20');
    const store = useRemoteServerStore.getState();
    const serverId = store.addServer({
      name: 'Desktop',
      endpoint: 'http://192.168.1.10:7878',
      providerType: 'openai-compatible',
    });
    store.setActiveServerId(serverId);

    startNetworkReconnectWatcher();
    await Promise.resolve();
    appStateListener?.('background');
    appStateListener?.('active');
    await Promise.resolve();
    jest.advanceTimersByTime(2_500);
    for (let i = 0; i < 20; i++) await Promise.resolve();

    expect(
      useRemoteServerStore.getState().serverHealth[serverId]?.isHealthy,
    ).toBe(false);
  });

  it('discards an IP lookup that settles after teardown', async () => {
    let resolveIp: ((ip: string) => void) | undefined;
    (getIpAddress as jest.Mock).mockImplementation(
      () =>
        new Promise<string>(resolve => {
          resolveIp = resolve;
        }),
    );

    startNetworkReconnectWatcher();
    stopNetworkReconnectWatcher();
    resolveIp?.('192.168.1.20');
    await Promise.resolve();
    jest.runOnlyPendingTimers();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not validate an unchanged IP during steady-state polling', async () => {
    (getIpAddress as jest.Mock).mockResolvedValue('192.168.1.20');

    startNetworkReconnectWatcher();
    await Promise.resolve();
    jest.advanceTimersByTime(15_000);
    await Promise.resolve();
    jest.advanceTimersByTime(2_500);
    await Promise.resolve();

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
