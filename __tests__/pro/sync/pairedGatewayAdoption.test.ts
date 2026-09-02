jest.mock('@offgrid/core/services/modelServices/remoteServerApplication', () => ({
  mobileRemoteServerApplication: { adoptPairedDevices: jest.fn(async () => ({ save: [], remove: [] })) },
}));
jest.mock('../../../pro/sync/manualMeshEndpoint', () => ({ manualMeshEndpointStore: { get: (id: string) => (id === 'mac' ? { deviceId: 'mac', host: '100.64.0.9' } : undefined) } }));
jest.mock('@offgrid/core/utils/logger', () => ({ __esModule: true, default: { warn: jest.fn(), log: jest.fn() } }));
jest.mock('../../../pro/sync/syncStore', () => {
  const listeners = new Set<(state: unknown) => void>();
  let state: { rosterHydrated: boolean; knownDevices: unknown[] } = { rosterHydrated: false, knownDevices: [] };
  return {
    useSyncStore: {
      getState: () => state,
      subscribe: (listener: (state: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      __set: (next: typeof state) => {
        state = next;
        listeners.forEach(listener => listener(state));
      },
    },
  };
});

import { initPairedGatewayAdoption } from '../../../pro/sync/pairedGatewayAdoption';
import { mobileRemoteServerApplication } from '@offgrid/core/services/modelServices/remoteServerApplication';
import { useSyncStore } from '../../../pro/sync/syncStore';

const adopt = mobileRemoteServerApplication.adoptPairedDevices as jest.Mock;
const setState = (useSyncStore as unknown as { __set: (s: unknown) => void }).__set;
const mac = { id: 'mac', name: 'Mac', platform: 'macos', host: '10.0.0.5', port: 4040, gatewayPort: 7878, routeId: 'lan' };
const placed = { id: 'mac', name: 'Mac', platform: 'macos', host: '10.0.0.5', privateHost: '100.64.0.9', routeId: 'lan', gatewayPort: 7878 };

describe('initPairedGatewayAdoption', () => {
  it('feeds the paired roster to shared once hydrated, and again only when the roster changes', async () => {
    const stop = initPairedGatewayAdoption();
    expect(adopt).not.toHaveBeenCalled();
    setState({ rosterHydrated: true, knownDevices: [mac] });
    await Promise.resolve();
    expect(adopt).toHaveBeenCalledTimes(1);
    expect(adopt).toHaveBeenCalledWith([placed]);
    setState({ rosterHydrated: true, knownDevices: [{ ...mac, name: 'Renamed' }] });
    await Promise.resolve();
    expect(adopt).toHaveBeenCalledTimes(1);
    setState({ rosterHydrated: true, knownDevices: [{ ...mac, host: '10.0.0.9' }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(adopt).toHaveBeenCalledTimes(2);
    stop();
  });
});
