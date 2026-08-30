import React from 'react';
import { NativeModules } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { meshResidencyPolicy } from '../../../pro/sync/meshResidency';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { SyncScreen } from '../../../pro/ui/SyncScreen';

jest.unmock('@react-navigation/native');

jest.mock('react-native-tcp-socket', () => {
  const {
    createNativeTcpBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const {
    createNativeDiscoveryBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

const nativeResidency = {
  begin: jest.fn(async () => ({
    status: 'foreground_only',
    reason: 'timed_out',
  })),
  end: jest.fn(async () => undefined),
  state: jest.fn(async () => ({
    status: 'foreground_only',
    reason: 'timed_out',
  })),
  getConstants: jest.fn(() => ({
    survivesBackground: true,
    backgroundGraceSeconds: null,
    showsOngoingIndicator: true,
  })),
};

describe('Android mesh residency truth in the rendered Sync journey', () => {
  beforeEach(async () => {
    await meshResidencyPolicy.release();
    useSyncStore.getState().reset();
    useSyncStore.getState().setThisDevice({
      id: 'this-phone',
      name: 'This phone',
      platform: 'android',
      version: '107',
      host: '127.0.0.1',
      port: 42069,
    });
    useSyncStore.getState().setStatus('running');
    useSyncStore.getState().setDiscoverable(true);
    (NativeModules as unknown as Record<string, unknown>).MeshResidencyModule =
      nativeResidency;
  });

  afterEach(async () => {
    await meshResidencyPolicy.release();
    delete (NativeModules as unknown as Record<string, unknown>)
      .MeshResidencyModule;
  });

  it('replaces a false background-running claim with foreground-only guidance', async () => {
    const ui = render(
      <NavigationContainer>
        <SyncScreen />
      </NavigationContainer>,
    );

    await act(async () => {
      await meshResidencyPolicy.hold();
    });

    expect(ui.queryByText('Foreground only')).toBeNull();
    expect(ui.getByTestId('sync-residency-notice').props.children).toBe(
      'Sync works while Off Grid AI Mobile is open. Android could not keep this device reachable in the background.',
    );
    expect(ui.queryByText('Running in background')).toBeNull();
  });

  it('keeps the Discoverable toggle as the status owner when advertising health is stale', () => {
    useSyncStore.getState().setRuntimeHealth({
      transport: {
        listener: { state: 'ready' },
        routes: [{ id: 'lan', state: 'ready' }],
      },
      discovery: {
        routes: [
          {
            id: 'lan',
            browse: { state: 'ready' },
            advertise: {
              state: 'failed',
              error: 'Nearby network access is unavailable.',
            },
            peerCount: 0,
          },
        ],
      },
      scan: { state: 'settled', finishedAt: Date.now() },
      peerCount: 0,
    });

    const ui = render(
      <NavigationContainer>
        <SyncScreen />
      </NavigationContainer>,
    );

    expect(ui.queryByTestId('sync-toggle-discoverable')).toBeNull();
    fireEvent.press(ui.getByTestId('sync-open-device-settings'));
    expect(ui.getByTestId('sync-toggle-discoverable')).toBeTruthy();
    expect(ui.queryByText('Not discoverable')).toBeNull();
    expect(ui.getByText(/Other devices cannot find this device/)).toBeTruthy();
  });
});
