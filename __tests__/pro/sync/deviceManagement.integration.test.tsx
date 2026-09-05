import { NativeModules } from 'react-native';
import {
  fireEvent as importedFireEvent,
  render,
  type RenderAPI,
} from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  OFFGRID_SYNC_PORT,
  PAIRING_QR_VALIDITY_MS,
  encodePairingQrPayload,
  parsePairingCode,
  parsePairingQrPayload,
  type DeviceInfo,
} from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import {
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';
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
import { SyncScreen } from '../../../pro/ui/SyncScreen';
import { SyncHomeCard } from '../../../pro/ui/SyncHomeCard';
import {
  resetDiscoveryBoundaries,
  resetTcpPortRoutes,
} from '../../utils/nativeSyncBoundaries';
import {
  pairingCodeOnScreen,
  TYPED_PAIRING_CODE,
  WRONG_TYPED_PAIRING_CODE,
} from '../../utils/pairFromPeer';
import { createDownloadedModel } from '../../utils/factories';
import {
  createLicensedMesh,
  installLicensedPhone,
} from '../../harness/licensedMesh';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

import { PAIRING_TRUST_FORMAT_VERSION } from '../../../pro/sync/pairingTrustDocument';
import { sheetAction } from '../../utils/sheets';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

/**
 * Retry a pairing attempt the way the sheet requires: enter the code, then press Retry.
 *
 * Retry stays disabled until what is typed parses, and the field does not keep the last value - which is
 * the point of retrying rather than reconnecting. The attempt that just failed proved nothing about the
 * code, so the user is asked for it again each time.
 */
function retryPairing(
  ui: RenderAPI,
  code: string,
  events: typeof importedFireEvent,
): void {
  events.changeText(ui.getByTestId('incoming-pairing-code'), code);
  events.press(ui.getByTestId('retry-pairing-attempt'));
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

/** Two devices that can pair: an in-memory licence provider, and a licensed peer to pair with. */
const mesh = createLicensedMesh();
let activeMesh = mesh;

describe('Pro mobile saved-device management journey', () => {
  let remote: ReturnType<typeof buildSyncEngine> | undefined;
  let extraRemotes: ReturnType<typeof buildSyncEngine>[] = [];
  let ui: ReturnType<typeof render> | undefined;
  let failNextPairingSave = false;
  let applicationFixture: MobileApplicationFixture;

  const loadFreshQrGraph = async (
    start: boolean,
    blobChannel?: Record<string, unknown>,
    configureMesh?: (target: typeof mesh) => void,
  ) => {
    installNativeBoundary({
      ram: {
        platform: 'ios',
        totalBytes: 8 * 1024 ** 3,
        availBytes: 6 * 1024 ** 3,
      },
    });
    const ReactFresh = require('react') as typeof import('react');
    const rtlFresh = requireRTL();
    const { NavigationContainer: NavigationContainerFresh } =
      require('@react-navigation/native') as typeof import('@react-navigation/native');
    const rnFresh = require('react-native') as typeof import('react-native');
    const QRCodeFresh = require('react-native-qrcode-svg')
      .default as typeof import('react-native-qrcode-svg').default;
    const { useAppStore: useFreshAppStore } =
      require('@offgrid/core/stores/appStore') as typeof import('../../../src/stores/appStore');
    const licensedMesh =
      require('../../harness/licensedMesh') as typeof import('../../harness/licensedMesh');
    const freshMesh = licensedMesh.createLicensedMesh();
    activeMesh = freshMesh;
    freshMesh.reset();
    const freshSecrets = licensedMesh.installLicensedPhone(freshMesh, {
      fingerprint: PHONE_FINGERPRINT,
      beforeWrite: service => {
        if (service === 'off-grid-sync-pairings' && failNextPairingSave) {
          failNextPairingSave = false;
          throw new Error('Keychain unavailable');
        }
      },
    });
    freshMesh.register({
      id: PHONE_FINGERPRINT,
      name: 'This phone',
      platform: 'ios',
    });
    configureMesh?.(freshMesh);
    rnFresh.NativeModules.SyncProximityModule = new (
      require('../../utils/proximityNativeBoundary') as typeof import('../../utils/proximityNativeBoundary')
    ).ProximityAir().device({
      id: PHONE_FINGERPRINT,
      name: 'This phone',
      platform: 'ios',
    });
    if (blobChannel) rnFresh.NativeModules.SyncBlobChannelModule = blobChannel;
    useFreshAppStore.getState().setOnboardingComplete(true);
    useFreshAppStore.getState().setProActive(true);
    useFreshAppStore
      .getState()
      .setDownloadedModels([createDownloadedModel({ engine: 'litert' })]);
    if (start) {
      const { startMobileApplicationFixture } =
        require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
      applicationFixture = await startMobileApplicationFixture({ pro: true });
    } else {
      const { installPro } =
        require('../../harness/proHarness') as typeof import('../../harness/proHarness');
      await installPro();
      (
        require('../../../src/services/composition/application') as typeof import('../../../src/services/composition/application')
      ).getMobileApplication();
    }
    const { SyncScreen: SyncScreenFresh } =
      require('../../../pro/ui/SyncScreen') as typeof import('../../../pro/ui/SyncScreen');
    const { ProRoot: ProRootFresh } =
      require('../../../pro/ui/ProRoot') as typeof import('../../../pro/ui/ProRoot');
    const { AppNavigator: AppNavigatorFresh } =
      require('../../../src/navigation/AppNavigator') as typeof import('../../../src/navigation/AppNavigator');
    return {
      ReactFresh,
      rtlFresh,
      NavigationContainerFresh,
      rnFresh,
      QRCodeFresh,
      useFreshAppStore,
      SyncScreenFresh,
      ProRootFresh,
      AppNavigatorFresh,
      freshStoredPairings: () => freshSecrets.get('off-grid-sync-pairings'),
      freshMesh,
      camera:
        require('react-native-vision-camera') as typeof import('react-native-vision-camera'),
      buildFreshSyncEngine: (
        require('../../../src/services/sync/engine') as typeof import('../../../src/services/sync/engine')
      ).buildSyncEngine,
      NativeTcpFresh: require('react-native-tcp-socket').default as RnTcpModule,
      FreshMembershipPersistence: (
        require('../../utils/membershipPersistenceBoundary') as typeof import('../../utils/membershipPersistenceBoundary')
      ).MembershipPersistenceBoundary,
      nativeSync:
        require('../../utils/nativeSyncBoundaries') as typeof import('../../utils/nativeSyncBoundaries'),
    };
  };

  beforeEach(async () => {
    mesh.reset();
    extraRemotes = [];
    await AsyncStorage.clear();
    resetDiscoveryBoundaries();
    resetTcpPortRoutes();
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
    // A licensed phone with a Keychain that really stores. The licence matters as much as the pairing
    // store: without it the phone cannot ask for the installation roster, and a peer that pairs
    // perfectly then has no row to appear in.
    installLicensedPhone(mesh, {
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
    const { ProximityAir } =
      require('../../utils/proximityNativeBoundary') as typeof import('../../utils/proximityNativeBoundary');
    NativeModules.SyncProximityModule = new ProximityAir().device({
      id: PHONE_FINGERPRINT,
      name: 'This phone',
      platform: 'ios',
    });
  });

  afterEach(async () => {
    jest.useRealTimers();
    activeMesh.restore();
    activeMesh = mesh;
    ui?.unmount();
    await remote?.engine.stop();
    await Promise.all(extraRemotes.map(peer => peer.engine.stop()));
    await applicationFixture?.application.sync.stop();
    _clearScreensForTesting();
    _clearSlotsForTesting();
    _clearSectionsForTesting();
    useAppStore.getState().setThemeMode('system');
    delete (NativeModules as Record<string, unknown>).SyncBlobChannelModule;
    delete NativeModules.SyncProximityModule;
    (useCameraDevice as jest.Mock).mockReturnValue(undefined);
    (useCameraPermission as jest.Mock).mockReturnValue({
      hasPermission: false,
      requestPermission: jest.fn(),
    });
    (useCodeScanner as jest.Mock).mockClear();
  });

  afterAll(async () => {
    await applicationFixture?.dispose();
  });


  it('shows the current pairing QR on demand and updates it after rotation', async () => {
    const graph = await loadFreshQrGraph(true, {
      lanAddress: jest.fn(async () => '192.168.1.25'),
      interfaceCandidates: jest.fn(async () => [
        { host: '192.168.1.25', interfaceName: 'en0' },
        { host: '100.70.80.90', interfaceName: 'utun4' },
      ]),
    });
    const {
      ReactFresh,
      rtlFresh,
      NavigationContainerFresh,
      rnFresh,
      QRCodeFresh,
      useFreshAppStore,
      SyncScreenFresh,
    } = graph;
    useFreshAppStore.getState().setThemeMode('dark');
    ui = rtlFresh.render(
      ReactFresh.createElement(
        NavigationContainerFresh,
        null,
        ReactFresh.createElement(SyncScreenFresh),
      ),
    );

    const firstCode = await pairingCodeOnScreen(ui);
    expect(ui.getByLabelText('Show pairing QR code')).toBeTruthy();
    expect(ui.queryByTestId('sync-pairing-qr')).toBeNull();
    const codeRow = rtlFresh.within(ui.getByTestId('sync-pairing-code-row'));
    const actionRow = rtlFresh.within(
      ui.getByTestId('sync-pairing-code-actions'),
    );
    expect(codeRow.getByTestId('sync-pairing-code-value')).toBeTruthy();
    expect(actionRow.getByTestId('sync-rotate-pairing-code')).toBeTruthy();
    const showQr = ui.getByTestId('sync-show-pairing-qr');
    const scanQr = ui.getByTestId('sync-open-pairing-scanner');
    expect(actionRow.getByTestId('sync-show-pairing-qr')).toBe(showQr);
    expect(actionRow.getByTestId('sync-open-pairing-scanner')).toBe(scanQr);
    expect(rnFresh.StyleSheet.flatten(showQr.props.style)).toEqual(
      expect.objectContaining({ width: 44, height: 44 }),
    );
    expect(rnFresh.StyleSheet.flatten(scanQr.props.style)).toEqual(
      expect.objectContaining({ width: 44, height: 44 }),
    );
    expect(
      (
        rnFresh.NativeModules.SyncBlobChannelModule as {
          interfaceCandidates: jest.Mock;
        }
      ).interfaceCandidates,
    ).not.toHaveBeenCalled();

    rtlFresh.fireEvent.press(ui.getByTestId('sync-show-pairing-qr'));
    expect(ui.getByTestId('sync-pairing-qr-loading')).toBeTruthy();
    const firstQr = await rtlFresh.waitFor(() =>
      ui!.getByTestId('sync-pairing-qr'),
    );
    expect(firstQr.props.accessibilityRole).toBe('image');
    expect(firstQr.props.accessibilityValue).toBeUndefined();
    const firstQrSvg = ui.UNSAFE_getByType(QRCodeFresh);
    const firstValue = firstQrSvg.props.value as string;
    const firstPayload = parsePairingQrPayload(firstValue);
    expect(firstPayload).toEqual(
      expect.objectContaining({
        device: expect.objectContaining({ id: PHONE_FINGERPRINT }),
        pairingCode: parsePairingCode(firstCode),
        routes: [
          { kind: 'lan', host: '192.168.1.25', port: OFFGRID_SYNC_PORT },
          {
            kind: 'tailscale',
            host: '100.70.80.90',
            port: OFFGRID_SYNC_PORT,
          },
        ],
        issuedAt: expect.any(Number),
      }),
    );
    expect(firstQr.props.accessibilityHint).toMatch(/pairing code/i);
    expect(firstQrSvg.props.value).toBe(firstValue);
    expect(firstQrSvg.props.ecl).toBe('H');
    expect(firstQrSvg.props.size).toBe(240);
    expect(firstQrSvg.props.logoSize).toBe(42);
    expect(firstQrSvg.props.color).toBe('#0A0A0A');
    expect(firstQrSvg.props.backgroundColor).toBe('#FFFFFF');
    const darkLogo = firstQrSvg.props.logo;
    expect(darkLogo).toBeTruthy();

    useFreshAppStore.getState().setThemeMode('light');
    expect(
      await rtlFresh.waitFor(() => ui!.getByTestId('sync-pairing-qr')),
    ).toBeTruthy();
    expect(ui.UNSAFE_getByType(QRCodeFresh).props.logo).not.toBe(darkLogo);
    rtlFresh.fireEvent.press(ui.getByText('Close'));
    await rtlFresh.waitFor(() =>
      expect(ui!.queryByTestId('sync-pairing-qr')).toBeNull(),
    );

    rtlFresh.fireEvent.press(ui.getByTestId('sync-rotate-pairing-code'));
    await rtlFresh.waitFor(() =>
      expect(
        ui!.getByTestId('sync-pairing-code-value').props.children,
      ).not.toBe(firstCode),
    );
    const nextCode = await pairingCodeOnScreen(ui);
    jest.useFakeTimers({ now: Date.now() });
    rtlFresh.fireEvent.press(ui.getByTestId('sync-show-pairing-qr'));
    expect(ui.getByTestId('sync-pairing-qr-loading')).toBeTruthy();
    const rotatedQr = await rtlFresh.waitFor(() =>
      ui!.getByTestId('sync-pairing-qr'),
    );
    expect(rotatedQr.props.accessibilityValue).toBeUndefined();
    const rotatedValue = ui.UNSAFE_getByType(QRCodeFresh).props.value as string;
    expect(parsePairingQrPayload(rotatedValue)).toEqual(
      expect.objectContaining({ pairingCode: parsePairingCode(nextCode) }),
    );
    expect(rotatedValue).not.toBe(firstValue);
    expect(nextCode).not.toBe(firstCode);

    const rotatedPayload = parsePairingQrPayload(rotatedValue);
    await rtlFresh.act(async () => {
      jest.advanceTimersByTime(PAIRING_QR_VALIDITY_MS - 60_000);
      await Promise.resolve();
    });
    const refreshedValue = ui.UNSAFE_getByType(QRCodeFresh).props
      .value as string;
    const refreshedPayload = parsePairingQrPayload(refreshedValue);
    expect(refreshedValue).not.toBe(rotatedValue);
    expect(refreshedPayload).toEqual(
      expect.objectContaining({
        device: rotatedPayload?.device,
        pairingCode: rotatedPayload?.pairingCode,
        routes: rotatedPayload?.routes,
        issuedAt: expect.any(Number),
      }),
    );
    expect(refreshedPayload!.issuedAt).toBeGreaterThan(
      rotatedPayload!.issuedAt,
    );
    jest.useRealTimers();
  });

  it('keeps the QR action unavailable until the pairing code is ready', async () => {
    const { ReactFresh, rtlFresh, NavigationContainerFresh, SyncScreenFresh } =
      await loadFreshQrGraph(false);
    ui = rtlFresh.render(
      ReactFresh.createElement(
        NavigationContainerFresh,
        null,
        ReactFresh.createElement(SyncScreenFresh),
      ),
    );

    expect(ui.getByTestId('sync-pairing-code-value').props.children).toBe(
      'Loading...',
    );
    expect(
      ui.getByTestId('sync-show-pairing-qr').props.accessibilityState.disabled,
    ).toBe(true);
    rtlFresh.fireEvent.press(ui.getByTestId('sync-show-pairing-qr'));
    expect(ui.queryByTestId('sync-pairing-qr')).toBeNull();
  });

  it('shows one visible scanner, rejects an expired code, then pairs the exact QR device and route', async () => {
    const graph = await loadFreshQrGraph(true);
    const {
      ReactFresh,
      rtlFresh,
      NavigationContainerFresh,
      rnFresh,
      SyncScreenFresh,
      ProRootFresh,
      freshMesh,
      camera,
      buildFreshSyncEngine,
      NativeTcpFresh,
      FreshMembershipPersistence,
      nativeSync,
    } = graph;
    freshMesh.register({
      id: 'desktop-qr-peer',
      name: 'QR Desktop',
      platform: 'macos',
    });
    const remoteDevice: DeviceInfo = {
      id: 'desktop-qr-peer',
      name: 'QR Desktop',
      platform: 'macos',
      version: '1',
      host: '192.168.1.90',
      port: 0,
    };
    const persistence = new FreshMembershipPersistence();
    remote = buildFreshSyncEngine({
      pairingEntitlement: freshMesh.peer(),
      localDevice: remoteDevice,
      tcpModule: NativeTcpFresh,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        persistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: persistence,
      membershipPersistence: persistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    ui = rtlFresh.render(
      ReactFresh.createElement(
        ReactFresh.Fragment,
        null,
        ReactFresh.createElement(ProRootFresh),
        ReactFresh.createElement(
          NavigationContainerFresh,
          null,
          ReactFresh.createElement(SyncScreenFresh),
        ),
      ),
    );

    rtlFresh.fireEvent.press(ui.getByTestId('sync-open-pairing-scanner'));
    expect(ui.getByText('Camera access needed')).toBeTruthy();
    expect(
      rnFresh.StyleSheet.flatten(ui.getByTestId('qr-scanner-root').props.style),
    ).toEqual(expect.objectContaining({ zIndex: 2 }));
    expect(ui.getAllByTestId('qr-scanner-close')).toHaveLength(1);
    rtlFresh.fireEvent.press(ui.getByTestId('qr-scanner-close'));

    (camera.useCameraDevice as jest.Mock).mockReturnValue({
      id: 'back-camera',
    });
    (camera.useCameraPermission as jest.Mock).mockReturnValue({
      hasPermission: true,
      requestPermission: jest.fn(),
    });
    rtlFresh.fireEvent.press(ui.getByTestId('sync-open-pairing-scanner'));
    const scanner = (camera.useCodeScanner as jest.Mock).mock.calls.at(
      -1,
    )?.[0] as {
      onCodeScanned(codes: { value: string }[]): void;
    };
    const encode = (now: number) =>
      encodePairingQrPayload(
        {
          device: remoteDevice,
          pairingCode: TYPED_PAIRING_CODE,
          routes: [
            {
              kind: 'lan',
              host: remoteDevice.host,
              port: remoteDevice.port,
            },
          ],
        },
        now,
      );

    rtlFresh.act(() => {
      scanner.onCodeScanned([
        { value: encode(Date.now() - PAIRING_QR_VALIDITY_MS - 1) },
      ]);
    });
    expect(ui.getByText(/This QR code has expired/)).toBeTruthy();

    rtlFresh.act(() => {
      scanner.onCodeScanned([{ value: encode(Date.now()) }]);
    });
    expect(ui.getAllByText('Connecting to QR Desktop').length).toBeGreaterThan(
      0,
    );
    expect(ui.getByTestId('qr-scanner-loading')).toBeTruthy();
    await rtlFresh.waitFor(
      () =>
        expect(
          rtlFresh
            .within(ui!.getByTestId('sync-paired-desktop-qr-peer'))
            .getByText(/Connected/),
        ).toBeTruthy(),
      { timeout: 10_000 },
    );
    await rtlFresh.waitFor(() => {
      const failure = ui!.queryByTestId('qr-scanner-status');
      if (failure) throw new Error(`scanner failed: ${failure.props.children}`);
      expect(ui!.queryByTestId('qr-scanner-close')).toBeNull();
    });
    expect(
      nativeSync
        .getTcpDials()
        .some(
          dial =>
            dial.host === remoteDevice.host && dial.port === remoteDevice.port,
        ),
    ).toBe(true);

    const pairedRowsBeforeRepeat = applicationFixture.application.sync
      .snapshot()
      .paired.filter(device => device.id === remoteDevice.id);
    expect(pairedRowsBeforeRepeat).toHaveLength(1);
    const dialCountBeforeRepeat = nativeSync.getTcpDials().length;

    rtlFresh.fireEvent.press(ui.getByTestId('sync-open-pairing-scanner'));
    const repeatedScanner = (camera.useCodeScanner as jest.Mock).mock.calls.at(
      -1,
    )?.[0] as {
      onCodeScanned(codes: { value: string }[]): void;
    };
    rtlFresh.act(() => {
      repeatedScanner.onCodeScanned([{ value: encode(Date.now()) }]);
    });

    await rtlFresh.waitFor(() =>
      expect(ui!.queryByTestId('qr-scanner-close')).toBeNull(),
    );
    expect(ui.queryByText('Pairing failed')).toBeNull();
    expect(nativeSync.getTcpDials()).toHaveLength(dialCountBeforeRepeat);
    expect(
      applicationFixture.application.sync
        .snapshot()
        .paired.filter(device => device.id === remoteDevice.id),
    ).toHaveLength(1);

    const mobileDevice = applicationFixture.application.sync.snapshot().self;
    if (!mobileDevice) throw new Error('Sync did not create the Mobile device');
    persistence.dropActive(mobileDevice.id);
    remote.engine.disconnect(mobileDevice.id);
    await rtlFresh.waitFor(() =>
      expect(
        rtlFresh
          .within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`))
          .getByText(/Offline|Needs repair/),
      ).toBeTruthy(),
    );

    const dialCountBeforeRepairScan = nativeSync.getTcpDials().length;
    rtlFresh.fireEvent.press(ui.getByTestId('sync-open-pairing-scanner'));
    const repairScanner = (camera.useCodeScanner as jest.Mock).mock.calls.at(
      -1,
    )?.[0] as {
      onCodeScanned(codes: { value: string }[]): void;
    };
    rtlFresh.act(() => {
      repairScanner.onCodeScanned([{ value: encode(Date.now()) }]);
    });
    expect(ui.getByTestId('qr-scanner-loading')).toBeTruthy();

    await rtlFresh.waitFor(
      () =>
        expect(
          rtlFresh
            .within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`))
            .getByText(/Connected/),
        ).toBeTruthy(),
      { timeout: 10_000 },
    );
    expect(nativeSync.getTcpDials().length).toBeGreaterThan(
      dialCountBeforeRepairScan,
    );
    expect(persistence.getActive(mobileDevice.id)).toBeTruthy();
    expect(ui.queryByText('unknown_device')).toBeNull();
  }, 20_000);

  it('keeps Rescan running when one saved peer is unreachable and another is reachable', async () => {
    const devices: DeviceInfo[] = [
      {
        id: 'desktop-unreachable',
        name: 'Studio Desktop',
        platform: 'macos',
        version: '1',
        host: '127.0.0.1',
        port: 0,
      },
      {
        id: 'desktop-reachable',
        name: 'Travel Desktop',
        platform: 'macos',
        version: '1',
        host: '127.0.0.1',
        port: 0,
      },
    ];
    const graph = await loadFreshQrGraph(true, undefined, freshMesh => {
      for (const device of devices) {
        freshMesh.register({
          id: device.id,
          name: device.name,
          platform: device.platform,
        });
      }
    });
    const {
      ReactFresh,
      rtlFresh,
      NavigationContainerFresh,
      SyncScreenFresh,
      freshMesh,
      buildFreshSyncEngine,
      NativeTcpFresh,
      FreshMembershipPersistence,
      nativeSync,
    } = graph;
    for (const device of devices) {
      const persistence = new FreshMembershipPersistence();
      const peer = buildFreshSyncEngine({
        pairingEntitlement: freshMesh.peer(),
        localDevice: device,
        tcpModule: NativeTcpFresh,
        getPassphrase: async () => TYPED_PAIRING_CODE,
        getSharedSecret: deviceId =>
          persistence.getActive(deviceId)?.sharedSecret,
        pairingPersistence: persistence,
        membershipPersistence: persistence,
      });
      await peer.engine.start(0);
      device.port = peer.transport.boundPort ?? 0;
      extraRemotes.push(peer);
    }

    ui = rtlFresh.render(
      ReactFresh.createElement(
        NavigationContainerFresh,
        null,
        ReactFresh.createElement(SyncScreenFresh),
      ),
    );
    const mobile = applicationFixture.application.sync.snapshot().self;
    const discovery = nativeSync.getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) {
      throw new Error('Sync did not publish the mobile device');
    }
    const code = await pairingCodeOnScreen(ui);
    for (const peer of extraRemotes) {
      await peer.engine.pair(
        { ...mobile, host: '127.0.0.1', port: discovery.publishedPort },
        code,
      );
    }
    await rtlFresh.waitFor(() =>
      expect(ui!.getByTestId('sync-paired-desktop-unreachable')).toBeTruthy(),
    );
    await rtlFresh.waitFor(() =>
      expect(ui!.getByTestId('sync-paired-desktop-reachable')).toBeTruthy(),
    );

    await extraRemotes[0].engine.stop();
    discovery.lose(devices[0].id);
    await rtlFresh.waitFor(() =>
      expect(
        rtlFresh
          .within(ui!.getByTestId('sync-paired-desktop-unreachable'))
          .getByText(/Offline/),
      ).toBeTruthy(),
    );

    await rtlFresh.waitFor(() =>
      expect(ui!.queryByTestId('sync-scanning')).toBeNull(),
    );
    rtlFresh.fireEvent.press(ui.getByTestId('sync-rescan'));
    await rtlFresh.waitFor(() =>
      expect(ui!.getByTestId('sync-scanning')).toBeTruthy(),
    );
    discovery.resolve(devices[0]);
    discovery.resolve(devices[1]);

    await rtlFresh.waitFor(
      () =>
        expect(
          nativeSync
            .getTcpDials()
            .some(dial => dial.port === devices[0].port && dial.refused),
        ).toBe(true),
      { timeout: 10_000 },
    );
    await rtlFresh.waitFor(
      () =>
        expect(
          rtlFresh
            .within(ui!.getByTestId('sync-paired-desktop-unreachable'))
            .getByText(/Could not reach/),
        ).toBeTruthy(),
      { timeout: 10_000 },
    );
    expect(
      rtlFresh
        .within(ui.getByTestId('sync-paired-desktop-reachable'))
        .getByText(/Connected/),
    ).toBeTruthy();
    expect(ui.queryByTestId('sync-rescan-error')).toBeNull();
    expect(ui.getByTestId('sync-reconnect-desktop-unreachable')).toBeTruthy();
  }, 20_000);

  it('disconnects, reconnects, pairs again from an offline row, and forgets a paired desktop', async () => {
    // This desktop has been on the licence all along, as a real paired peer would be: the roster is
    // built from installations, so a peer with none is a peer the phone cannot show.
    const graph = await loadFreshQrGraph(true, undefined, freshMesh => {
      freshMesh.register({
        id: 'desktop-managed-peer',
        name: 'Off Grid AI Desktop',
        platform: 'macos',
      });
    });
    const {
      ReactFresh,
      rtlFresh,
      NavigationContainerFresh,
      AppNavigatorFresh,
      ProRootFresh,
      freshMesh,
      buildFreshSyncEngine,
      NativeTcpFresh,
      FreshMembershipPersistence,
      nativeSync,
      freshStoredPairings,
    } = graph;
    const remoteDevice: DeviceInfo = {
      id: 'desktop-managed-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    const remotePersistence = new FreshMembershipPersistence();
    remote = buildFreshSyncEngine({
      pairingEntitlement: freshMesh.peer(),
      localDevice: remoteDevice,
      tcpModule: NativeTcpFresh,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        remotePersistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: remotePersistence,
      membershipPersistence: remotePersistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    ui = rtlFresh.render(
      ReactFresh.createElement(
        ReactFresh.Fragment,
        null,
        ReactFresh.createElement(ProRootFresh),
        ReactFresh.createElement(
          NavigationContainerFresh,
          null,
          ReactFresh.createElement(AppNavigatorFresh),
        ),
      ),
    );
    expect(
      await rtlFresh.waitFor(() => ui!.getByTestId('sync-home-card')),
    ).toBeTruthy();
    rtlFresh.fireEvent.press(ui.getByTestId('open-sync-from-home'));
    expect(ui.getByTestId('sync-open-sharing')).toBeTruthy();
    expect(ui.getByTestId('sync-open-activity')).toBeTruthy();
    expect(ui.queryByTestId('sync-chats-toggle')).toBeNull();

    const mobile = applicationFixture.application.sync.snapshot().self;
    const discovery = nativeSync.getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) {
      throw new Error('Sync did not publish the mobile device');
    }
    const pairing = remote.engine.pair(
      { ...mobile, host: '127.0.0.1', port: discovery.publishedPort },
      await pairingCodeOnScreen(ui),
    );
    // Nothing to confirm: the peer presented this phone's own code, so pairing completes.
    await pairing;

    const connectedRow = await rtlFresh.waitFor(() =>
      ui!.getByTestId(`sync-paired-${remoteDevice.id}`),
    );
    expect(
      rtlFresh.within(connectedRow).getByText('macos - Connected'),
    ).toBeTruthy();
    expect(rtlFresh.within(connectedRow).queryByLabelText(/Rename/)).toBeNull();
    rtlFresh.fireEvent.press(ui.getByTestId('sync-rename-this-device'));
    expect(
      await rtlFresh.waitFor(() => ui!.getByText('Rename this device')),
    ).toBeTruthy();
    rtlFresh.fireEvent.changeText(
      ui.getByTestId('sync-rename-this-device-input'),
      'Travel Phone',
    );
    rtlFresh.fireEvent.press(ui.getByTestId('sync-rename-this-device-save'));
    await rtlFresh.waitFor(() =>
      expect(ui!.getByTestId('sync-this-device').props.children).toBe(
        'Travel Phone',
      ),
    );
    expect(rtlFresh.within(connectedRow).queryByLabelText(/Rename/)).toBeNull();

    rtlFresh.fireEvent.press(
      ui.getByTestId(`sync-disconnect-${remoteDevice.id}`),
    );
    await rtlFresh.waitFor(() =>
      expect(
        rtlFresh
          .within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`))
          .getByText(/Offline/),
      ).toBeTruthy(),
    );
    expect(ui.getByTestId(`sync-reconnect-${remoteDevice.id}`)).toBeTruthy();

    rtlFresh.fireEvent.press(ui.getByLabelText('Back'));
    await rtlFresh.waitFor(() =>
      expect(ui!.getByTestId('sync-home-card')).toBeTruthy(),
    );
    // The card counts the mesh: one saved device, none connected now that it has been disconnected.
    // It said "1 connected - 1 saved" a moment ago, so this is the transition and not a still frame.
    //
    // Not asserted: a "needs attention" line. The card prefers the local discoverability title, so it
    // says "Discoverable" here - true of this device, and silent about the peer that just dropped.
    expect(
      rtlFresh
        .within(ui!.getByTestId('sync-home-card'))
        .getByText(/0 connected - 1 saved/),
    ).toBeTruthy();
    expect(
      rtlFresh
        .within(ui!.getByTestId('sync-home-card'))
        .getByText(/Discoverable/),
    ).toBeTruthy();
    rtlFresh.fireEvent.press(ui.getByTestId('open-sync-from-home'));

    rtlFresh.fireEvent.press(
      ui.getByTestId(`sync-reconnect-${remoteDevice.id}`),
    );
    await rtlFresh.waitFor(() =>
      expect(
        rtlFresh
          .within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`))
          .getByText(/Connected/),
      ).toBeTruthy(),
    );
    rtlFresh.fireEvent.press(ui.getByLabelText('Back'));
    // And back up on the card the count has moved the other way, which is the reconnect seen from
    // outside the Sync screen.
    await rtlFresh.waitFor(() =>
      expect(
        rtlFresh
          .within(ui!.getByTestId('sync-home-card'))
          .getByText(/1 connected - 1 saved/),
      ).toBeTruthy(),
    );
    rtlFresh.fireEvent.press(ui.getByTestId('open-sync-from-home'));

    const pairingBeforeRepair = JSON.parse(freshStoredPairings() ?? '{}')
      .pairings[remoteDevice.id];
    const installationIdsBeforeRepair = freshMesh
      .installations()
      .map(installation => installation.fingerprint)
      .sort();
    await remote.engine.stop();
    nativeSync.getDiscoveryBoundaries().at(-1)!.lose(remoteDevice.id);
    await rtlFresh.waitFor(() =>
      expect(
        rtlFresh
          .within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`))
          .getByText(/Offline/),
      ).toBeTruthy(),
    );
    const offlineRow = ui.getByTestId(`sync-paired-${remoteDevice.id}`);
    expect(
      rtlFresh
        .within(offlineRow)
        .queryByTestId(`sync-disconnect-${remoteDevice.id}`),
    ).toBeNull();
    expect(rtlFresh.within(offlineRow).queryByLabelText(/Rename/)).toBeNull();
    // The row is already offline, so it has no second Disconnect. Pair again is a separate key action
    // that asks for the code the desktop shows now.
    rtlFresh.fireEvent.press(ui.getByTestId(`sync-repair-${remoteDevice.id}`));
    await rtlFresh.waitFor(() =>
      expect(ui!.getByText('Pair with Off Grid AI Desktop')).toBeTruthy(),
    );
    expect(ui.getByTestId('sync-pairing-code-input')).toBeTruthy();
    expect(ui.getByText('Pair again')).toBeTruthy();

    remote = buildFreshSyncEngine({
      pairingEntitlement: freshMesh.peer(),
      localDevice: remoteDevice,
      tcpModule: NativeTcpFresh,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        remotePersistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: remotePersistence,
      membershipPersistence: remotePersistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    nativeSync.getDiscoveryBoundaries().at(-1)!.resolve(remoteDevice);
    rtlFresh.fireEvent.changeText(
      ui.getByTestId('sync-pairing-code-input'),
      TYPED_PAIRING_CODE,
    );
    rtlFresh.fireEvent.press(ui.getByTestId('sync-pairing-code-confirm'));

    await rtlFresh.waitFor(() =>
      expect(
        rtlFresh
          .within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`))
          .getByText(/Connected/),
      ).toBeTruthy(),
    );
    const pairingAfterRepair = JSON.parse(freshStoredPairings() ?? '{}')
      .pairings[remoteDevice.id];
    expect(
      applicationFixture.application.sync
        .snapshot()
        .paired.find(({ id }) => id === remoteDevice.id)?.membershipId,
    ).toBe(pairingAfterRepair.membershipId);
    expect(remotePersistence.getActive(mobile.id)?.membershipId).toBe(
      pairingAfterRepair.membershipId,
    );
    expect(pairingAfterRepair.secret).not.toBe(pairingBeforeRepair.secret);
    expect(
      freshMesh
        .installations()
        .map(({ fingerprint }) => fingerprint)
        .sort(),
    ).toEqual(installationIdsBeforeRepair);
    expect(JSON.parse(freshStoredPairings() ?? '{}').tombstones).toEqual({});

    await remote.engine.stop();
    nativeSync.getDiscoveryBoundaries().at(-1)!.lose(remoteDevice.id);
    await rtlFresh.waitFor(() =>
      expect(
        rtlFresh
          .within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`))
          .getByText(/Offline/),
      ).toBeTruthy(),
    );
    // Confirmation is an in-app sheet, not a system modal - the app never uses one for this - so the
    // question is read on screen and answered by pressing it. The copy names the licence consequence,
    // because evicting frees a seat as well as ending the trust.
    rtlFresh.fireEvent.press(ui.getByTestId(`sync-forget-${remoteDevice.id}`));
    await rtlFresh.waitFor(() =>
      expect(ui!.getByText('Evict Off Grid AI Desktop?')).toBeTruthy(),
    );
    expect(
      ui.getByText(/removes Off Grid AI Desktop from your licensed devices/),
    ).toBeTruthy();
    rtlFresh.fireEvent.press(ui.getByText('Evict device'));
    await rtlFresh.waitFor(() => {
      const row = ui!.queryByTestId(`sync-paired-${remoteDevice.id}`);
      if (row) {
        const text = row
          .findAll(node => typeof node.props.children === 'string')
          .map(node => node.props.children)
          .join(' | ');
        throw new Error(`The evicted device is still shown: ${text}`);
      }
    });
    // An evicted device is GONE from this phone's lists - not available, not saved, and with no
    // eviction row of its own. It used to keep a synthesised row carrying retry/dismiss, which put a
    // device you had just removed back on screen beside the ones you can still connect to, reading as
    // though the removal had failed. The revocation is still tracked and retried in the background;
    // what is gone is the removed device's presence on this screen.
    await rtlFresh.waitFor(() =>
      expect(
        ui!.queryByTestId(`sync-discovered-${remoteDevice.id}`),
      ).toBeNull(),
    );
    expect(ui.queryByText(/Could not reach/)).toBeNull();
    expect(
      ui.getByText(`1 of ${freshMesh.maxMachines} devices saved`),
    ).toBeTruthy();

    remote = buildFreshSyncEngine({
      pairingEntitlement: freshMesh.peer(),
      localDevice: remoteDevice,
      tcpModule: NativeTcpFresh,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        remotePersistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: remotePersistence,
      membershipPersistence: remotePersistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await rtlFresh.waitFor(() =>
      expect(
        nativeSync.getDiscoveryBoundaries().at(-1)!.scanCount,
      ).toBeGreaterThan(0),
    );
    nativeSync.getDiscoveryBoundaries().at(-1)!.resolve(remoteDevice);
    await rtlFresh.waitFor(() =>
      expect(remotePersistence.getActive(mobile.id)).toBeUndefined(),
    );
    await rtlFresh.waitFor(() =>
      expect(
        JSON.parse(freshStoredPairings() ?? '{}').pendingRevocations,
      ).toEqual({}),
    );
    await rtlFresh.waitFor(() =>
      expect(
        rtlFresh
          .within(ui!.getByTestId(`sync-discovered-${remoteDevice.id}`))
          .getByTestId(`sync-pair-${remoteDevice.id}`),
      ).toBeTruthy(),
    );
    // Nothing left on disk that could reconnect this device, and a tombstone so the membership it was
    // evicted from stays retired if it ever comes back claiming that generation. The version is read
    // from the app rather than written down here, so a format bump does not read as a failure.
    const persisted = JSON.parse(freshStoredPairings() ?? '{}');
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

  it('saves one private endpoint and reconnects only to that address after restart', async () => {
    const graph = await loadFreshQrGraph(true, undefined, freshMesh => {
      freshMesh.register({
        id: 'desktop-private-peer',
        name: 'Travel Desktop',
        platform: 'macos',
      });
    });
    const {
      ReactFresh,
      rtlFresh,
      NavigationContainerFresh,
      AppNavigatorFresh,
      ProRootFresh,
      freshMesh,
      buildFreshSyncEngine,
      NativeTcpFresh,
      FreshMembershipPersistence,
      nativeSync,
    } = graph;
    const remoteDevice: DeviceInfo = {
      id: 'desktop-private-peer',
      name: 'Travel Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    const remotePersistence = new FreshMembershipPersistence();
    remote = buildFreshSyncEngine({
      pairingEntitlement: freshMesh.peer(),
      localDevice: remoteDevice,
      tcpModule: NativeTcpFresh,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        remotePersistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: remotePersistence,
      membershipPersistence: remotePersistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await applicationFixture.application.sync.start();

    ui = rtlFresh.render(
      ReactFresh.createElement(
        ReactFresh.Fragment,
        null,
        ReactFresh.createElement(ProRootFresh),
        ReactFresh.createElement(
          NavigationContainerFresh,
          null,
          ReactFresh.createElement(AppNavigatorFresh),
        ),
      ),
    );
    await rtlFresh.waitFor(() =>
      expect(ui!.getByTestId('sync-home-card')).toBeTruthy(),
    );
    rtlFresh.fireEvent.press(ui.getByTestId('open-sync-from-home'));

    const mobile = applicationFixture.application.sync.snapshot().self;
    const discovery = nativeSync.getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) {
      throw new Error('Sync did not publish the mobile device');
    }
    await remote.engine.pair(
      { ...mobile, host: '127.0.0.1', port: discovery.publishedPort },
      await pairingCodeOnScreen(ui),
    );
    await rtlFresh.waitFor(() =>
      expect(
        rtlFresh
          .within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`))
          .getByText(/Connected/),
      ).toBeTruthy(),
    );

    rtlFresh.fireEvent.press(
      ui.getByTestId(`sync-disconnect-${remoteDevice.id}`),
    );
    await rtlFresh.waitFor(() =>
      expect(
        rtlFresh
          .within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`))
          .getByText(/Offline/),
      ).toBeTruthy(),
    );

    rtlFresh.fireEvent.press(
      ui.getByTestId(`sync-manual-endpoint-${remoteDevice.id}`),
    );
    expect(
      await rtlFresh.waitFor(() => ui!.getByText('Connect by address')),
    ).toBeTruthy();
    expect(ui.getByText(/Only your devices can read it/)).toBeTruthy();
    rtlFresh.fireEvent.changeText(
      ui.getByTestId('sync-manual-address-input'),
      '100.100.20.30',
    );
    expect(ui.queryByTestId('sync-manual-port-input')).toBeNull();
    nativeSync.routeTcpPort(OFFGRID_SYNC_PORT, remoteDevice.port);
    const scansBeforeConnect = discovery.scanCount;
    nativeSync.resetTcpDials();
    rtlFresh.fireEvent.press(ui.getByTestId('sync-manual-endpoint-connect'));

    await rtlFresh.waitFor(() =>
      expect(
        rtlFresh
          .within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`))
          .getByText(/Connected/),
      ).toBeTruthy(),
    );
    expect(nativeSync.getTcpDials()).toContainEqual({
      host: '100.100.20.30',
      port: OFFGRID_SYNC_PORT,
    });
    expect(discovery.scanCount).toBe(scansBeforeConnect);

    await applicationFixture.application.sync.stop();
    ui.unmount();
    ui = undefined;
    await applicationFixture.application.sync.start();
    const restartedDiscovery = nativeSync.getDiscoveryBoundaries().at(-1);
    if (!restartedDiscovery) throw new Error('Sync discovery did not restart');
    nativeSync.resetTcpDials();
    await applicationFixture.application.sync.connect(remoteDevice.id);

    expect(nativeSync.getTcpDials()).toContainEqual({
      host: '100.100.20.30',
      port: OFFGRID_SYNC_PORT,
    });
  });

  it('stops nearby browsing and keeps the saved Sync port after restart', async () => {
    const graph = await loadFreshQrGraph(true);
    const {
      ReactFresh,
      rtlFresh,
      NavigationContainerFresh,
      AppNavigatorFresh,
      ProRootFresh,
      nativeSync,
    } = graph;
    await applicationFixture.application.sync.start();
    ui = rtlFresh.render(
      ReactFresh.createElement(
        ReactFresh.Fragment,
        null,
        ReactFresh.createElement(ProRootFresh),
        ReactFresh.createElement(
          NavigationContainerFresh,
          null,
          ReactFresh.createElement(AppNavigatorFresh),
        ),
      ),
    );
    await rtlFresh.waitFor(() =>
      expect(ui!.getByTestId('sync-home-card')).toBeTruthy(),
    );
    rtlFresh.fireEvent.press(ui.getByTestId('open-sync-from-home'));

    const discovery = nativeSync.getDiscoveryBoundaries().at(-1);
    if (!discovery) throw new Error('Sync discovery did not start');
    const stopsBefore = discovery.stopCount;
    expect(ui.queryByTestId('sync-toggle-browsing')).toBeNull();
    rtlFresh.fireEvent.press(ui.getByTestId('sync-open-device-settings'));
    expect(
      await rtlFresh.waitFor(() => ui!.getByText('Device settings')),
    ).toBeTruthy();
    rtlFresh.fireEvent(
      ui.getByTestId('sync-toggle-browsing'),
      'valueChange',
      false,
    );
    await rtlFresh.waitFor(() => {
      expect(discovery.stopCount).toBeGreaterThan(stopsBefore);
      expect(ui!.getByTestId('sync-browsing-off')).toBeTruthy();
    });

    expect(
      await rtlFresh.waitFor(() => ui!.getByTestId('sync-port-input')),
    ).toBeTruthy();
    rtlFresh.fireEvent.changeText(ui.getByTestId('sync-port-input'), '40123');
    rtlFresh.fireEvent.press(ui.getByTestId('sync-port-save'));
    await rtlFresh.waitFor(() => {
      expect(ui!.queryByTestId('sync-port-input')).toBeNull();
      expect(
        applicationFixture.application.sync.snapshot().listeningPort?.value,
      ).toBe(40123);
    });

    await applicationFixture.application.sync.stop();
    ui.unmount();
    ui = undefined;
    await applicationFixture.application.sync.start();

    expect(applicationFixture.application.sync.snapshot().browsing).toBe(false);
    expect(
      applicationFixture.application.sync.snapshot().listeningPort?.value,
    ).toBe(40123);
  });

  it('shows Mobile-initiated cancel, code, and persistence failures before a clean retry', async () => {
    const graph = await loadFreshQrGraph(true, undefined, freshMesh => {
      freshMesh.register({
        id: 'desktop-mismatch-peer',
        name: 'Off Grid AI Desktop',
        platform: 'macos',
      });
    });
    const {
      ReactFresh,
      rtlFresh,
      NavigationContainerFresh,
      AppNavigatorFresh,
      ProRootFresh,
      freshMesh,
      buildFreshSyncEngine,
      NativeTcpFresh,
      nativeSync,
    } = graph;
    const { fireEvent, waitFor, within } = rtlFresh;
    // This desktop holds an installation, as any licensed Mac does. Reconciliation RETIRES a device it
    // finds locally trusted but absent from the licence, so an unregistered peer is un-pairable by
    // design: the trust lands and is withdrawn moments later.
    const remoteDevice: DeviceInfo = {
      id: 'desktop-mismatch-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    const passphraseResolvers: Array<(passphrase: string | null) => void> = [];
    remote = buildFreshSyncEngine({
      pairingEntitlement: freshMesh.peer(),
      localDevice: remoteDevice,
      tcpModule: NativeTcpFresh,
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
    await applicationFixture.application.sync.start();
    const mobile = applicationFixture.application.sync.snapshot().self;
    if (!mobile) throw new Error('Sync did not create the Mobile device');

    ui = rtlFresh.render(
      ReactFresh.createElement(
        ReactFresh.Fragment,
        null,
        ReactFresh.createElement(ProRootFresh),
        ReactFresh.createElement(
          NavigationContainerFresh,
          null,
          ReactFresh.createElement(AppNavigatorFresh),
        ),
      ),
    );
    // Wait for the card, not just the button. The button can be on screen before the Sync route is
    // registered, and navigating to a route that does not exist yet does nothing at all - leaving the
    // test pressing on for several seconds while still on Home.
    await waitFor(() => expect(ui!.getByTestId('sync-home-card')).toBeTruthy());
    fireEvent.press(ui.getByTestId('open-sync-from-home'));
    const discovery = nativeSync.getDiscoveryBoundaries().at(-1);
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
    expect(
      ui.getByText(`2 of ${freshMesh.maxMachines} devices saved`),
    ).toBeTruthy();
    await waitFor(() => expect(passphraseResolvers).toHaveLength(1));
    fireEvent.press(sheetAction(ui, 'Waiting for confirmation', 'Cancel'));

    await waitFor(() =>
      expect(ui!.getByText('Pairing cancelled')).toBeTruthy(),
    );
    expect(
      within(ui.getByTestId('pairing-attempt-sheet')).getByText(
        'Pairing was cancelled.',
      ),
    ).toBeTruthy();
    retryPairing(ui, TYPED_PAIRING_CODE, fireEvent);
    await waitFor(() => expect(passphraseResolvers).toHaveLength(2));
    await waitFor(() =>
      expect(ui!.getByText('Waiting for confirmation')).toBeTruthy(),
    );
    passphraseResolvers[1](WRONG_TYPED_PAIRING_CODE);

    await waitFor(() => expect(ui!.getByText('Pairing failed')).toBeTruthy());
    expect(
      within(ui.getByTestId('pairing-attempt-sheet')).getByText(
        'The pairing codes did not match.',
      ),
    ).toBeTruthy();
    expect(ui.getByTestId('retry-pairing-attempt')).toBeTruthy();
    expect(
      applicationFixture.application.sync
        .snapshot()
        .paired.some(device => device.id === remoteDevice.id),
    ).toBe(false);

    retryPairing(ui, TYPED_PAIRING_CODE, fireEvent);
    await waitFor(() => expect(passphraseResolvers).toHaveLength(3));
    await waitFor(() =>
      expect(ui!.getByText('Waiting for confirmation')).toBeTruthy(),
    );
    failNextPairingSave = true;
    passphraseResolvers[2](TYPED_PAIRING_CODE);

    await waitFor(() => expect(ui!.getByText('Pairing failed')).toBeTruthy());
    expect(
      within(ui.getByTestId('pairing-attempt-sheet')).getByText(
        'The pairing could not be saved.',
      ),
    ).toBeTruthy();
    expect(remote.engine.isPaired(mobile.id)).toBe(false);
    expect(
      applicationFixture.application.sync
        .snapshot()
        .paired.some(device => device.id === remoteDevice.id),
    ).toBe(false);

    // A clean retry after the storage failure gets there, and the trust SURVIVES - which is the part
    // worth asserting, because a pairing whose trust is withdrawn moments later still reports success
    // on its way past.
    retryPairing(ui, TYPED_PAIRING_CODE, fireEvent);
    await waitFor(() => expect(passphraseResolvers).toHaveLength(4));
    await waitFor(() =>
      expect(ui!.getByText('Waiting for confirmation')).toBeTruthy(),
    );
    passphraseResolvers[3](TYPED_PAIRING_CODE);

    await waitFor(() =>
      expect(
        applicationFixture.application.sync
          .snapshot()
          .paired.some(device => device.id === remoteDevice.id),
      ).toBe(true),
    );
    expect(ui.queryByTestId('pairing-attempt-sheet')).toBeNull();
    expect(ui.queryByText('Pairing failed')).toBeNull();
  });
});
