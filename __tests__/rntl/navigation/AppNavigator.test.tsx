/**
 * AppNavigator — real composition.
 *
 * Mounts the REAL root navigator (real RootStack + real bottom tabs + the real
 * screen registry) over the REAL app store, the REAL screens, the REAL
 * components barrel and the REAL model services, running against the in-memory
 * device boundary (installNativeBoundary({ fs: true })).
 *
 * No Off Grid module is mocked. The only fakes are outside our system:
 * safe-area-context (so the test can drive a device inset), vector-icons and
 * the native filesystem. Every assertion reads the UI the user sees.
 *
 * Behaviours covered:
 *  - bootstrap gating: onboarding-not-done -> Onboarding route; done -> Main tabs
 *  - route registration: all five tab labels + tab testIDs exist
 *  - tab bar safe-area height/padding for gesture, iPhone and 3-button navigation
 */

import React from 'react';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

// Outside our system: the device's safe-area insets. Mutable so a test can
// stand in for gesture nav (0), iPhone home indicator (34) and Android
// 3-button nav (48) without touching production code.
const mockInsets = { top: 0, right: 0, bottom: 0, left: 0 };

jest.mock('react-native-safe-area-context', () => {
  const mockReact = require('react');
  return {
    SafeAreaProvider: ({ children }: any) => children,
    SafeAreaView: ({ children }: any) => children,
    SafeAreaInsetsContext: mockReact.createContext(mockInsets),
    SafeAreaFrameContext: mockReact.createContext({
      x: 0,
      y: 0,
      width: 390,
      height: 844,
    }),
    useSafeAreaInsets: () => mockInsets,
    initialWindowMetrics: {
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 0, left: 0, right: 0, bottom: 0 },
    },
  };
});

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

(globalThis as any).requestAnimationFrame = (cb: () => void) =>
  setTimeout(cb, 0);

describe('AppNavigator (real composition)', () => {
  let RTL: ReturnType<typeof requireRTL>;
  let AppNavigator: React.FC;
  let NavigationContainer: any;
  let useAppStore: any;

  const setInsetBottom = (bottom: number) => {
    mockInsets.bottom = bottom;
  };

  const mount = () =>
    RTL.render(
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>,
    );

  const settle = async () => {
    await RTL.act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
  };

  const mountAndSettle = async () => {
    const r = mount();
    await settle();
    return r;
  };

  /**
   * The onboarding flag is durable state: the real app recovers it from
   * AsyncStorage through the app store's own persist middleware on every launch.
   * Seeding that boundary and letting the store rehydrate reaches the
   * precondition the way a returning user does, instead of manufacturing it.
   */
  const seedPersistedOnboarding = async (complete: boolean) => {
    const storage = require('@react-native-async-storage/async-storage');
    await storage.setItem(
      'local-llm-app-storage',
      JSON.stringify({
        state: { hasCompletedOnboarding: complete },
        version: 0,
      }),
    );
    await useAppStore.persist.rehydrate();
  };

  /**
   * `downloadedModels` is NOT part of the app store's persisted slice - the real
   * recovery path is the model-library bootstrap, which only runs when the whole
   * Mobile application composition root is started. A root-route navigator test
   * mounts the navigator alone, so there is no persisted boundary and no gesture
   * that precedes mount for this one field; it is set directly and deliberately.
   */
  const setInstalledModels = (
    models: ReturnType<typeof installedTextModel>[],
  ) => {
    useAppStore.setState({ downloadedModels: models });
  };

  beforeEach(async () => {
    installNativeBoundary({ fs: true });
    jest.spyOn(global, 'fetch').mockImplementation(async input => {
      const url = String(input);
      return {
        ok: url.startsWith('https://huggingface.co/'),
        status: url.startsWith('https://huggingface.co/') ? 200 : 404,
        json: async () => [],
      } as Response;
    });

    RTL = requireRTL();
    NavigationContainer =
      require('@react-navigation/native').NavigationContainer;
    AppNavigator = require('../../../src/navigation/AppNavigator').AppNavigator;
    useAppStore = require('../../../src/stores').useAppStore;

    mockInsets.top = 0;
    mockInsets.right = 0;
    mockInsets.bottom = 0;
    mockInsets.left = 0;

    await seedPersistedOnboarding(true);
    setInstalledModels([installedTextModel()]);
  });

  afterEach(async () => {
    // installNativeBoundary() calls jest.resetModules() on every beforeEach. Without
    // tearing the previous graph down here each test orphans a mounted tree and an
    // un-stopped application on a module graph nobody can reach any more.
    RTL?.cleanup?.();
    const fixtures =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    await fixtures.currentMobileApplicationFixture()?.dispose();
    jest.restoreAllMocks();
  });

  /** A model the user has already downloaded — the real Main-tabs precondition. */
  const installedTextModel = () => ({
    id: 'm1',
    name: 'Model 1',
    author: 'a',
    fileName: 'm1.gguf',
    filePath: '/docs/models/m1.gguf',
    fileSize: 1024,
    quantization: 'Q4_K_M',
    downloadedAt: '',
  });

  // ---- Bootstrap gating (the root route the user lands on) ----

  describe('bootstrap gating', () => {
    it('lands on the Main tabs once onboarding is complete', async () => {
      const { getByTestId } = await mountAndSettle();
      expect(getByTestId('home-tab')).toBeTruthy();
    });

    it('does not show the Main tab bar before onboarding is complete', async () => {
      await seedPersistedOnboarding(false);
      const { queryByTestId } = await mountAndSettle();
      expect(queryByTestId('home-tab')).toBeNull();
    });

    it('routes a user with no downloaded model to auto setup, not the tabs', async () => {
      await seedPersistedOnboarding(true);
      setInstalledModels([]);
      const rendered = await mountAndSettle();
      expect(rendered.queryByTestId('home-tab')).toBeNull();
      await rendered.findByTestId('auto-setup-screen');
    });
  });

  // ---- Route registration ----

  describe('tab bar rendering', () => {
    it('renders all five tab labels', async () => {
      const { getAllByText } = await mountAndSettle();

      expect(getAllByText('Home').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Chats').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Projects').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Models').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Settings').length).toBeGreaterThanOrEqual(1);
    });

    it('renders all tab buttons with testIDs', async () => {
      const { getByTestId } = await mountAndSettle();

      expect(getByTestId('home-tab')).toBeTruthy();
      expect(getByTestId('chats-tab')).toBeTruthy();
      expect(getByTestId('projects-tab')).toBeTruthy();
      expect(getByTestId('models-tab')).toBeTruthy();
      expect(getByTestId('settings-tab')).toBeTruthy();
    });
  });

  // ---- Tab bar safe area insets ----

  describe('tab bar safe area insets', () => {
    const flatten = (style: any): any =>
      Array.isArray(style)
        ? Object.assign({}, ...style.filter(Boolean).map(flatten))
        : style ?? {};

    /**
     * Walk up from a tab button to the first ancestor that carries the tab-bar
     * container style (the node that owns paddingBottom/height). The direct
     * `.parent.parent` node does not, so an assertion pinned to it silently
     * asserts nothing.
     */
    const tabBarStyle = (rendered: any) => {
      let node: any = rendered.getByTestId('home-tab');
      while (node) {
        const flat = flatten(node.props?.style);
        if (flat.paddingBottom !== undefined && flat.height !== undefined) {
          return flat;
        }
        node = node.parent;
      }
      throw new Error('tab bar container style not found above home-tab');
    };

    it('uses a minimum paddingBottom of 20 when the bottom inset is 0 (gesture navigation)', async () => {
      setInsetBottom(0);
      const rendered = await mountAndSettle();

      expect(rendered.getByTestId('home-tab')).toBeTruthy();
      const flat = tabBarStyle(rendered);
      expect(flat.paddingBottom).toBe(20);
      expect(flat.height).toBe(80);
    });

    it('uses the device bottom inset when larger than the minimum (3-button navigation)', async () => {
      setInsetBottom(48);
      const rendered = await mountAndSettle();

      expect(rendered.getByTestId('home-tab')).toBeTruthy();
      const flat = tabBarStyle(rendered);
      expect(flat.paddingBottom).toBe(48);
      expect(flat.height).toBe(108);
    });

    it('uses a device bottom inset of 34 for the iPhone home indicator', async () => {
      setInsetBottom(34);
      const rendered = await mountAndSettle();

      expect(rendered.getByTestId('home-tab')).toBeTruthy();
      const flat = tabBarStyle(rendered);
      expect(flat.paddingBottom).toBe(34);
      expect(flat.height).toBe(94);
    });

    it('keeps every tab visible with a large bottom inset (regression: nav bar overlap)', async () => {
      setInsetBottom(48);
      const { getAllByText, getByTestId } = await mountAndSettle();

      expect(getAllByText('Home').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Chats').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Projects').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Models').length).toBeGreaterThanOrEqual(1);
      expect(getAllByText('Settings').length).toBeGreaterThanOrEqual(1);

      expect(getByTestId('home-tab')).toBeTruthy();
      expect(getByTestId('chats-tab')).toBeTruthy();
      expect(getByTestId('projects-tab')).toBeTruthy();
      expect(getByTestId('models-tab')).toBeTruthy();
      expect(getByTestId('settings-tab')).toBeTruthy();
    });
  });
});
