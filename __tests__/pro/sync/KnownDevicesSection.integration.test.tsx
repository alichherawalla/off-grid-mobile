import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { SyncControlAction, SyncManagedDevice } from '@offgrid/sync';
import { KnownDevicesSection } from '../../../pro/ui/SyncScreen/KnownDevicesSection';

const enabled: SyncControlAction = { visible: true, enabled: true };
const hidden: SyncControlAction = { visible: false, enabled: false };

function savedDevice(id: string, name: string): SyncManagedDevice {
  return {
    id,
    name,
    platform: 'macos',
    version: '1',
    host: '127.0.0.1',
    port: 37878,
    saved: true,
    state: 'offline',
    onNetwork: false,
    route: { kind: 'unknown', label: 'Unknown' },
    availableRoutes: [],
    actions: {
      pair: hidden,
      pairAgain: hidden,
      reconnect: enabled,
      disconnect: hidden,
      rename: hidden,
      evict: enabled,
      retryEviction: hidden,
      dismissEviction: hidden,
      sendModel: hidden,
    },
    evictionConfirmation: {
      title: `Forget ${name}?`,
      description: 'This removes the saved device.',
      confirmLabel: 'Forget',
    },
  };
}

describe('<KnownDevicesSection/> action ownership', () => {
  it('shows reconnect progress only on the device being reconnected', async () => {
    let finishReconnect!: () => void;
    const onReconnect = jest.fn(
      () =>
        new Promise<void>(resolve => {
          finishReconnect = resolve;
        }),
    );
    const devices = [
      savedDevice('mac-debug', 'OGAD: Mac (Debug)'),
      savedDevice('iphone-debug', 'iPhone (Debug)'),
    ];
    const ui = render(
      <KnownDevicesSection
        devices={devices}
        pairingDeviceId={null}
        onPair={jest.fn()}
        onRepair={jest.fn(async () => 'reconnected')}
        onDisconnect={jest.fn(() => true)}
        onReconnect={onReconnect}
        onSetManualEndpoint={jest.fn()}
        manualEndpointDeviceIds={[]}
        onSendModel={jest.fn()}
        onForget={jest.fn(async () => undefined)}
        reachabilityErrors={{}}
      />,
    );

    fireEvent.press(ui.getByTestId('sync-reconnect-mac-debug'));

    expect(
      await ui.findByTestId('sync-reconnect-loader-mac-debug'),
    ).toBeTruthy();
    expect(ui.queryByTestId('sync-reconnect-loader-iphone-debug')).toBeNull();
    expect(ui.getByTestId('sync-reconnect-iphone-debug')).toBeTruthy();

    finishReconnect();
    await waitFor(() =>
      expect(ui.queryByTestId('sync-reconnect-loader-mac-debug')).toBeNull(),
    );
  });
});
