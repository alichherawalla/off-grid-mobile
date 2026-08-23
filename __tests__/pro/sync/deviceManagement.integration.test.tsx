import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import {
  fireEvent,
  render,
  waitFor,
  within,
  type RenderAPI,
} from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TcpSocket from 'react-native-tcp-socket';
import type { DeviceInfo } from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import { AppNavigator } from '../../../src/navigation/AppNavigator';
import {
  registerScreen,
  _clearScreensForTesting,
} from '../../../src/navigation/screenRegistry';
import {
  _clearSlotsForTesting,
  registerSlot,
  SLOTS,
} from '../../../src/bootstrap/slotRegistry';
import { _clearSectionsForTesting } from '../../../src/components/settings/sectionRegistry';
import { useAppStore } from '../../../src/stores/appStore';
import { buildSyncEngine } from '../../../src/services/sync/engine';
import { syncService } from '../../../pro/sync/syncService';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { SyncScreen } from '../../../pro/ui/SyncScreen';
import { SyncHomeCard } from '../../../pro/ui/SyncHomeCard';
import { ProRoot } from '../../../pro/ui/ProRoot';
import {
  getDiscoveryBoundaries,
  resetDiscoveryBoundaries,
} from '../../utils/nativeSyncBoundaries';
import {
  pairingCodeOnScreen,
  TYPED_PAIRING_CODE,
  WRONG_TYPED_PAIRING_CODE,
} from '../../utils/pairFromPeer';
import { createDownloadedModel } from '../../utils/factories';
import { MembershipPersistenceBoundary } from '../../utils/membershipPersistenceBoundary';
import {
  createLicensedMesh,
  installLicensedPhone,
} from '../../harness/licensedMesh';

import { PAIRING_TRUST_FORMAT_VERSION } from '../../../pro/sync/pairingTrustDocument';
import { sheetAction } from '../../utils/sheets';

/**
 * Retry a pairing attempt the way the sheet requires: enter the code, then press Retry.
 *
 * Retry stays disabled until what is typed parses, and the field does not keep the last value - which is
 * the point of retrying rather than reconnecting. The attempt that just failed proved nothing about the
 * code, so the user is asked for it again each time.
 */
function retryPairing(ui: RenderAPI, code: string): void {
  fireEvent.changeText(ui.getByTestId('incoming-pairing-code'), code);
  fireEvent.press(ui.getByTestId('retry-pairing-attempt'));
}

/** This phone's fingerprint, which is also the sync device id its installation registers under. */
const PHONE_FINGERPRINT = 'fp-this-phone';

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

const nativeTcpBoundary = TcpSocket as unknown as RnTcpModule;

/** Two devices that can pair: an in-memory licence provider, and a licensed peer to pair with. */
const mesh = createLicensedMesh();

describe('Pro mobile saved-device management journey', () => {
  let remote: ReturnType<typeof buildSyncEngine> | undefined;
  let ui: ReturnType<typeof render> | undefined;
  let secrets: Map<string, string>;
  /** What the pairing store has actually written, read back out of the Keychain the app used. */
  const storedPairings = (): string | undefined =>
    secrets.get('off-grid-sync-pairings');
  let failNextPairingSave = false;

  beforeEach(async () => {
    mesh.reset();
    await AsyncStorage.clear();
    resetDiscoveryBoundaries();
    _clearScreensForTesting();
    _clearSlotsForTesting();
    _clearSectionsForTesting();
    registerScreen({ name: 'Sync', component: SyncScreen });
    registerSlot(SLOTS.homeSyncCard, SyncHomeCard);
    useAppStore.getState().setOnboardingComplete(true);
    // Pro is an entitlement the app is told about, so it is seeded like any other outside fact.
    useAppStore.getState().setProActive(true);
    useAppStore
      .getState()
      .setDownloadedModels([createDownloadedModel({ engine: 'litert' })]);
    useSyncStore.getState().reset();
    // A licensed phone with a Keychain that really stores. The licence matters as much as the pairing
    // store: without it the phone cannot ask for the installation roster, and a peer that pairs
    // perfectly then has no row to appear in.
    secrets = installLicensedPhone(mesh, {
      fingerprint: PHONE_FINGERPRINT,
      beforeWrite: service => {
        if (service === 'off-grid-sync-pairings' && failNextPairingSave) {
          failNextPairingSave = false;
          throw new Error('Keychain unavailable');
        }
      },
    });
    mesh.register({
      id: PHONE_FINGERPRINT,
      name: 'This phone',
      platform: 'ios',
    });
  });

  afterEach(async () => {
    mesh.restore();
    ui?.unmount();
    await remote?.engine.stop();
    await syncService.stop();
    _clearScreensForTesting();
    _clearSlotsForTesting();
    _clearSectionsForTesting();
  });

  it('disconnects, reconnects, pairs again from an offline row, and forgets a paired desktop', async () => {
    // This desktop has been on the licence all along, as a real paired peer would be: the roster is
    // built from installations, so a peer with none is a peer the phone cannot show.
    mesh.register({
      id: 'desktop-managed-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
    });
    const remoteDevice: DeviceInfo = {
      id: 'desktop-managed-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    const remotePersistence = new MembershipPersistenceBoundary();
    remote = buildSyncEngine({
      pairingEntitlement: mesh.peer(),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        remotePersistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: remotePersistence,
      membershipPersistence: remotePersistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await syncService.start();

    ui = render(
      <>
        <ProRoot />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </>,
    );
    expect(await waitFor(() => ui!.getByTestId('sync-home-card'))).toBeTruthy();
    fireEvent.press(ui.getByTestId('open-sync-from-home'));
    expect(ui.getByTestId('sync-open-sharing')).toBeTruthy();
    expect(ui.getByTestId('sync-open-activity')).toBeTruthy();
    expect(ui.queryByTestId('sync-chats-toggle')).toBeNull();

    const mobile = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) {
      throw new Error('Sync did not publish the mobile device');
    }
    const pairing = remote.engine.pair(
      { ...mobile, host: '127.0.0.1', port: discovery.publishedPort },
      await pairingCodeOnScreen(ui),
    );
    // Nothing to confirm: the peer presented this phone's own code, so pairing completes.
    await pairing;

    const { useSyncStore: probeStore } = require('../../../pro/sync/syncStore');
    process.stderr.write(
      `[probe] registry=${JSON.stringify(
        probeStore.getState().entitlementReconciliation?.registry,
      )} known=${JSON.stringify(
        probeStore.getState().knownDevices.map((d: { id: string }) => d.id),
      )}\n`,
    );
    const connectedRow = await waitFor(() =>
      ui!.getByTestId(`sync-paired-${remoteDevice.id}`),
    );
    expect(within(connectedRow).getByText(/Connected · WiFi/)).toBeTruthy();
    expect(within(connectedRow).queryByLabelText(/Rename/)).toBeNull();
    fireEvent.press(ui.getByTestId('sync-rename-this-device'));
    expect(await waitFor(() => ui!.getByText('Rename this device'))).toBeTruthy();
    fireEvent.changeText(
      ui.getByTestId('sync-rename-this-device-input'),
      'Travel Phone',
    );
    fireEvent.press(ui.getByTestId('sync-rename-this-device-save'));
    await waitFor(() =>
      expect(ui!.getByTestId('sync-this-device').props.children).toBe(
        'Travel Phone',
      ),
    );
    expect(within(connectedRow).queryByLabelText(/Rename/)).toBeNull();

    fireEvent.press(ui.getByTestId(`sync-disconnect-${remoteDevice.id}`));
    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
          /Offline/,
        ),
      ).toBeTruthy(),
    );
    expect(ui.getByTestId(`sync-reconnect-${remoteDevice.id}`)).toBeTruthy();

    fireEvent.press(ui.getByLabelText('Back'));
    await waitFor(() => expect(ui!.getByTestId('sync-home-card')).toBeTruthy());
    // The card counts the mesh: one saved device, none connected now that it has been disconnected.
    // It said "1 connected - 1 saved" a moment ago, so this is the transition and not a still frame.
    //
    // Not asserted: a "needs attention" line. The card prefers the local discoverability title, so it
    // says "Discoverable" here - true of this device, and silent about the peer that just dropped.
    expect(
      within(ui!.getByTestId('sync-home-card')).getByText(
        /0 connected - 1 saved/,
      ),
    ).toBeTruthy();
    fireEvent.press(ui.getByTestId('open-sync-from-home'));

    fireEvent.press(ui.getByTestId(`sync-reconnect-${remoteDevice.id}`));
    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
          /Connected/,
        ),
      ).toBeTruthy(),
    );
    fireEvent.press(ui.getByLabelText('Back'));
    // And back up on the card the count has moved the other way, which is the reconnect seen from
    // outside the Sync screen.
    await waitFor(() =>
      expect(
        within(ui!.getByTestId('sync-home-card')).getByText(
          /1 connected - 1 saved/,
        ),
      ).toBeTruthy(),
    );
    fireEvent.press(ui.getByTestId('open-sync-from-home'));

    const pairingBeforeRepair = JSON.parse(storedPairings() ?? '{}').pairings[
      remoteDevice.id
    ];
    const installationIdsBeforeRepair = mesh
      .installations()
      .map(installation => installation.fingerprint)
      .sort();
    await remote.engine.stop();
    getDiscoveryBoundaries().at(-1)!.lose(remoteDevice.id);
    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
          /Offline/,
        ),
      ).toBeTruthy(),
    );
    const offlineRow = ui.getByTestId(`sync-paired-${remoteDevice.id}`);
    expect(
      within(offlineRow).queryByTestId(`sync-disconnect-${remoteDevice.id}`),
    ).toBeNull();
    expect(within(offlineRow).queryByLabelText(/Rename/)).toBeNull();
    // The row is already offline, so it has no second Disconnect. Pair again is a separate key action
    // that asks for the code the desktop shows now.
    fireEvent.press(ui.getByTestId(`sync-repair-${remoteDevice.id}`));
    await waitFor(() =>
      expect(ui!.getByText('Pair with Off Grid AI Desktop')).toBeTruthy(),
    );
    expect(ui.getByTestId('sync-pairing-code-input')).toBeTruthy();
    expect(ui.getByText('Pair again')).toBeTruthy();

    remote = buildSyncEngine({
      pairingEntitlement: mesh.peer(),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        remotePersistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: remotePersistence,
      membershipPersistence: remotePersistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    getDiscoveryBoundaries().at(-1)!.resolve(remoteDevice);
    fireEvent.changeText(
      ui.getByTestId('sync-pairing-code-input'),
      TYPED_PAIRING_CODE,
    );
    fireEvent.press(ui.getByTestId('sync-pairing-code-confirm'));

    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
          /Connected/,
        ),
      ).toBeTruthy(),
    );
    const pairingAfterRepair = JSON.parse(storedPairings() ?? '{}').pairings[
      remoteDevice.id
    ];
    expect(pairingAfterRepair.secret).not.toBe(pairingBeforeRepair.secret);
    expect(
      mesh
        .installations()
        .map(({ fingerprint }) => fingerprint)
        .sort(),
    ).toEqual(installationIdsBeforeRepair);
    expect(JSON.parse(storedPairings() ?? '{}').tombstones).toEqual({});

    await remote.engine.stop();
    getDiscoveryBoundaries().at(-1)!.lose(remoteDevice.id);
    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
          /Offline/,
        ),
      ).toBeTruthy(),
    );
    // Confirmation is an in-app sheet, not a system modal - the app never uses one for this - so the
    // question is read on screen and answered by pressing it. The copy names the licence consequence,
    // because evicting frees a seat as well as ending the trust.
    fireEvent.press(ui.getByTestId(`sync-forget-${remoteDevice.id}`));
    await waitFor(() =>
      expect(ui!.getByText('Evict Off Grid AI Desktop?')).toBeTruthy(),
    );
    expect(
      ui.getByText(/removes Off Grid AI Desktop from your licensed devices/),
    ).toBeTruthy();
    fireEvent.press(ui.getByText('Evict device'));
    await waitFor(() =>
      expect(ui!.queryByTestId(`sync-paired-${remoteDevice.id}`)).toBeNull(),
    );
    // An evicted device is GONE from this phone's lists - not available, not saved, and with no
    // eviction row of its own. It used to keep a synthesised row carrying retry/dismiss, which put a
    // device you had just removed back on screen beside the ones you can still connect to, reading as
    // though the removal had failed. The revocation is still tracked and retried in the background;
    // what is gone is the removed device's presence on this screen.
    await waitFor(() =>
      expect(
        ui!.queryByTestId(`sync-discovered-${remoteDevice.id}`),
      ).toBeNull(),
    );
    expect(ui.queryByText(/Could not reach/)).toBeNull();
    expect(ui.getByText('1 of 5 devices saved')).toBeTruthy();

    remote = buildSyncEngine({
      pairingEntitlement: mesh.peer(),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        remotePersistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: remotePersistence,
      membershipPersistence: remotePersistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await waitFor(() =>
      expect(getDiscoveryBoundaries().at(-1)!.scanCount).toBeGreaterThan(0),
    );
    getDiscoveryBoundaries().at(-1)!.resolve(remoteDevice);
    await waitFor(() =>
      expect(remotePersistence.getActive(mobile.id)).toBeUndefined(),
    );
    await waitFor(() =>
      expect(JSON.parse(storedPairings() ?? '{}').pendingRevocations).toEqual(
        {},
      ),
    );
    await waitFor(() =>
      expect(
        within(
          ui!.getByTestId(`sync-discovered-${remoteDevice.id}`),
        ).getByTestId(`sync-pair-${remoteDevice.id}`),
      ).toBeTruthy(),
    );
    // Nothing left on disk that could reconnect this device, and a tombstone so the membership it was
    // evicted from stays retired if it ever comes back claiming that generation. The version is read
    // from the app rather than written down here, so a format bump does not read as a failure.
    const persisted = JSON.parse(storedPairings() ?? '{}');
    expect(persisted).toEqual(
      expect.objectContaining({
        version: PAIRING_TRUST_FORMAT_VERSION,
        pairings: {},
        stagedPairings: {},
        pendingRevocations: {},
      }),
    );
    expect(
      Object.values(
        persisted.tombstones as Record<string, { deviceId: string }>,
      ).map(tombstone => tombstone.deviceId),
    ).toEqual([remoteDevice.id]);
  });

  it('shows Mobile-initiated cancel, code, and persistence failures before a clean retry', async () => {
    // This desktop holds an installation, as any licensed Mac does. Reconciliation RETIRES a device it
    // finds locally trusted but absent from the licence, so an unregistered peer is un-pairable by
    // design: the trust lands and is withdrawn moments later.
    mesh.register({
      id: 'desktop-mismatch-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
    });
    const remoteDevice: DeviceInfo = {
      id: 'desktop-mismatch-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    const passphraseResolvers: Array<(passphrase: string | null) => void> = [];
    remote = buildSyncEngine({
      pairingEntitlement: mesh.peer(),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      getPassphrase: (_device, context) =>
        new Promise(resolve => {
          passphraseResolvers.push(resolve);
          context.signal.addEventListener('abort', () => resolve(null), {
            once: true,
          });
        }),
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await syncService.start();
    const mobile = useSyncStore.getState().thisDevice;
    if (!mobile) throw new Error('Sync did not create the Mobile device');

    ui = render(
      <>
        <ProRoot />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </>,
    );
    // Wait for the card, not just the button. The button can be on screen before the Sync route is
    // registered, and navigating to a route that does not exist yet does nothing at all - leaving the
    // test pressing on for several seconds while still on Home.
    await waitFor(() => expect(ui!.getByTestId('sync-home-card')).toBeTruthy());
    fireEvent.press(ui.getByTestId('open-sync-from-home'));
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!discovery) {
      throw new Error('Sync did not start native discovery');
    }
    // Only once this boundary is browsing: a resolve that lands before the service has registered its
    // listener is dropped, exactly as a real one would be.
    await waitFor(() => expect(discovery.scanCount).toBeGreaterThan(0));
    discovery.resolve(remoteDevice);
    // A Mac on your licence that this phone has never paired with is a SAVED device needing pairing,
    // not a stranger nearby: the roster knows it, only the trust is missing. So it is reached from the
    // saved list, and its action asks for the code because there is no credential to retry.
    await waitFor(() =>
      expect(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).toBeTruthy(),
    );
    fireEvent.press(ui.getByTestId(`sync-repair-${remoteDevice.id}`));
    fireEvent.changeText(
      await waitFor(() => ui!.getByTestId('sync-pairing-code-input')),
      TYPED_PAIRING_CODE,
    );
    fireEvent.press(ui.getByTestId('sync-pairing-code-confirm'));

    await waitFor(() =>
      expect(ui!.getByText('Waiting for confirmation')).toBeTruthy(),
    );
    expect(sheetAction(ui, 'Waiting for confirmation', 'Cancel')).toBeTruthy();
    // Two installations: this phone and the Mac. Both are on the licence throughout - what the pairing
    // adds is the trust between them, not a seat.
    expect(ui.getByText('2 of 5 devices saved')).toBeTruthy();
    await waitFor(() => expect(passphraseResolvers).toHaveLength(1));
    fireEvent.press(sheetAction(ui, 'Waiting for confirmation', 'Cancel'));

    await waitFor(() =>
      expect(ui!.getByText('Pairing cancelled')).toBeTruthy(),
    );
    expect(ui.getByText('Pairing was cancelled.')).toBeTruthy();
    retryPairing(ui, TYPED_PAIRING_CODE);
    await waitFor(() => expect(passphraseResolvers).toHaveLength(2));
    await waitFor(() =>
      expect(ui!.getByText('Waiting for confirmation')).toBeTruthy(),
    );
    passphraseResolvers[1](WRONG_TYPED_PAIRING_CODE);

    await waitFor(() => expect(ui!.getByText('Pairing failed')).toBeTruthy());
    expect(ui.getByText('The pairing codes did not match.')).toBeTruthy();
    expect(ui.getByTestId('retry-pairing-attempt')).toBeTruthy();
    expect(
      useSyncStore
        .getState()
        .knownDevices.some(device => device.id === remoteDevice.id),
    ).toBe(false);

    retryPairing(ui, TYPED_PAIRING_CODE);
    await waitFor(() => expect(passphraseResolvers).toHaveLength(3));
    await waitFor(() =>
      expect(ui!.getByText('Waiting for confirmation')).toBeTruthy(),
    );
    failNextPairingSave = true;
    passphraseResolvers[2](TYPED_PAIRING_CODE);

    await waitFor(() => expect(ui!.getByText('Pairing failed')).toBeTruthy());
    expect(ui.getByText('The pairing could not be saved.')).toBeTruthy();
    expect(remote.engine.isPaired(mobile.id)).toBe(false);
    expect(
      useSyncStore
        .getState()
        .knownDevices.some(device => device.id === remoteDevice.id),
    ).toBe(false);

    // A clean retry after the storage failure gets there, and the trust SURVIVES - which is the part
    // worth asserting, because a pairing whose trust is withdrawn moments later still reports success
    // on its way past.
    retryPairing(ui, TYPED_PAIRING_CODE);
    await waitFor(() => expect(passphraseResolvers).toHaveLength(4));
    await waitFor(() =>
      expect(ui!.getByText('Waiting for confirmation')).toBeTruthy(),
    );
    passphraseResolvers[3](TYPED_PAIRING_CODE);

    await waitFor(() =>
      expect(
        useSyncStore
          .getState()
          .knownDevices.some(device => device.id === remoteDevice.id),
      ).toBe(true),
    );
    expect(ui.queryByTestId('pairing-attempt-sheet')).toBeNull();
    expect(ui.queryByText('Pairing failed')).toBeNull();
  });
});
