import { callHook, _clearHooksForTesting } from '../../../src/bootstrap/hookRegistry';
import { getSlot, SLOTS, _clearSlotsForTesting } from '../../../src/bootstrap/slotRegistry';
import {
  getRegisteredScreens,
  registerScreen,
  _clearScreensForTesting,
} from '../../../src/navigation/screenRegistry';
import {
  getToolExtensions,
  registerToolExtension,
  _clearExtensionsForTesting,
} from '../../../src/services/tools/extensions';
import { registerSettingsSection } from '../../../src/components/settings/sectionRegistry';
import { registerHook } from '../../../src/bootstrap/hookRegistry';
import { registerSlot } from '../../../src/bootstrap/slotRegistry';
import { activate, deactivate } from '../../../pro';
import { syncService } from '../../../pro/sync/syncService';

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

describe('the Pro runtime when access expires', () => {
  beforeEach(() => {
    _clearHooksForTesting();
    _clearSlotsForTesting();
    _clearScreensForTesting();
    _clearExtensionsForTesting();
  });

  afterEach(async () => {
    await deactivate();
    // The restricted Sync bootstrap intentionally survives Pro deactivation. This test starts that
    // process, so it must also await and stop it before Jest removes the native boundary.
    await syncService.stop();
    _clearHooksForTesting();
    _clearSlotsForTesting();
    _clearScreensForTesting();
    _clearExtensionsForTesting();
  });

  it('removes every paid surface and stops Sync without an app restart', async () => {
    activate({
      registerToolExtension,
      registerScreen,
      registerSettingsSection,
      registerSlot,
      registerHook,
    });

    expect(getRegisteredScreens().map(screen => screen.name)).toEqual(
      expect.arrayContaining(['Sync', 'Clipboard', 'McpServers']),
    );
    expect(getToolExtensions().map(extension => extension.id)).toEqual(
      expect.arrayContaining(['mcp', 'email-calendar']),
    );
    expect(getSlot(SLOTS.appRoot)).toBeDefined();
    expect(callHook('audio.canSpeak')).toBeDefined();

    await deactivate();

    expect(getRegisteredScreens().map(screen => screen.name)).not.toEqual(
      expect.arrayContaining(['Sync', 'Clipboard', 'McpServers']),
    );
    expect(getToolExtensions().map(extension => extension.id)).toEqual([]);
    expect(getSlot(SLOTS.appRoot)).toBeUndefined();
    expect(callHook('audio.canSpeak')).toBeUndefined();
    expect(syncService.isRunning()).toBe(false);
  });
});
