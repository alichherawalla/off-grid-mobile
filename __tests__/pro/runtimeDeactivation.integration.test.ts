const mockListeners = new Set<
  (state: { active: boolean }, previous: { active: boolean }) => void
>();
let mockAccessState = { active: true };
const mockClipboardEntitlement = jest.fn();
const mockDisconnectServer = jest.fn();
const mockAudioCleanup = jest.fn();
const mockGrantCleanup = jest.fn();
const mockReconcileCleanup = jest.fn();

function mockSetAccess(active: boolean): void {
  const previous = mockAccessState;
  mockAccessState = { active };
  for (const listener of mockListeners) listener(mockAccessState, previous);
}

jest.mock('@offgrid/core/stores/appStore', () => ({
  useAppStore: {
    getState: () => mockAccessState,
    subscribe: (
      listener: (state: { active: boolean }, previous: { active: boolean }) => void,
    ) => {
      mockListeners.add(listener);
      return () => mockListeners.delete(listener);
    },
  },
}));
jest.mock('@offgrid/core/stores/proAccessSlice', () => ({
  selectHasProAccess: (state: { active: boolean }) => state.active,
}));
jest.mock('@offgrid/core/bootstrap/slotRegistry', () => ({
  SLOTS: {
    appRoot: 'app.root',
    homeSyncCard: 'home.syncCard',
    homeNotificationsButton: 'home.notificationsButton',
    chatOverlay: 'chat.overlay',
  },
}));
jest.mock('@offgrid/core/bootstrap/hookRegistry', () => ({
  HOOKS: {
    onboardingAdditionalSlides: 'onboarding.additionalSlides',
    clipboardRecordLocalText: 'clipboard.recordLocalText',
  },
}));
jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../pro/mcp/McpToolExtension', () => ({
  McpToolExtension: { id: 'mcp' },
}));
jest.mock('../../pro/tools/EmailCalendarExtension', () => ({
  EmailCalendarExtension: { id: 'email-calendar' },
}));
jest.mock('../../pro/audio', () => ({
  activateAudio: (options: {
    registerScreen: (screen: { name: string; component: () => null }) => void;
    registerSlot: (name: string, component: () => null) => void;
    registerHook: (name: string, hook: () => void) => void;
  }) => {
    options.registerScreen({ name: 'AudioSettings', component: () => null });
    options.registerSlot('audio.slot', () => null);
    options.registerHook('audio.hook', () => undefined);
    return mockAudioCleanup;
  },
}));

for (const modulePath of [
  '../../pro/ui/ComputerApprovalCard',
  '../../pro/ui/McpServersScreen',
  '../../pro/ui/McpToolsScreen',
  '../../pro/ui/McpGuideScreen',
  '../../pro/ui/SyncScreen',
  '../../pro/ui/SyncScreen/SyncSharingSettingsScreen',
  '../../pro/ui/SyncScreen/SyncActivityScreen',
  '../../pro/ui/SyncScreen/SyncFilesScreen',
  '../../pro/ui/ClipboardScreen',
  '../../pro/ui/SyncHomeCard',
  '../../pro/ui/HomeNotificationsButton',
  '../../pro/ui/SyncNotificationsScreen',
  '../../pro/ui/ProRoot',
]) {
  jest.mock(modulePath, () => new Proxy({}, { get: () => () => null }));
}

jest.mock('../../pro/mcp/mcpStore', () => ({
  useMcpStore: {
    getState: () => ({ servers: [{ id: 'server-1' }] }),
    persist: { hasHydrated: () => true, onFinishHydration: jest.fn() },
  },
}));
jest.mock('../../pro/mcp/mcpService', () => ({
  disconnectServer: mockDisconnectServer,
  reconnectSavedServers: jest.fn(async () => undefined),
}));
jest.mock('../../pro/mcp/mcpToolGrantService', () => ({
  initMcpToolGrants: () => mockGrantCleanup,
  initToolGrantReconcile: () => mockReconcileCleanup,
}));

jest.mock('../../pro/sync/syncService', () => ({
  syncService: { start: jest.fn(async () => undefined) },
}));
jest.mock('../../pro/sync/modelTransferService', () => ({
  modelTransferService: { start: jest.fn() },
}));
jest.mock('../../pro/sync/stateSyncService', () => ({
  stateSyncService: {
    start: jest.fn(async () => undefined),
    recordMutation: jest.fn(),
    stageMutation: jest.fn(),
    sendSharedFileRecord: jest.fn(),
  },
}));
jest.mock('../../pro/sync/clipboardSyncService', () => ({
  clipboardSyncService: {
    start: jest.fn(async () => undefined),
    setEntitlementActive: mockClipboardEntitlement,
    recordLocalText: jest.fn(async () => undefined),
  },
}));
jest.mock('../../pro/sync/chatStreamService', () => ({
  chatStreamService: {
    start: jest.fn(async () => undefined),
    discardConversation: jest.fn(),
  },
}));
jest.mock('../../pro/sync/knowledgeDocumentSyncService', () => ({
  knowledgeDocumentSyncService: {
    start: jest.fn(),
    handleLocalMutation: jest.fn(async () => undefined),
  },
}));
jest.mock('../../pro/sync/sharedFileSyncService', () => ({
  sharedFileSyncService: { start: jest.fn(async () => undefined) },
}));
jest.mock('../../pro/sync/fileTransferService', () => ({
  fileTransferService: { loadHistory: jest.fn(async () => undefined) },
}));
jest.mock('../../pro/sync/fileCompletionNotificationService', () => ({
  fileCompletionNotificationService: { start: jest.fn(async () => undefined) },
}));
jest.mock('../../pro/sync/entitlementActivation', () => ({
  setEntitlementImportedHandler: jest.fn(),
}));
jest.mock('../../pro/licensing/proLicenseProvider', () => ({
  proLicenseProvider: {},
}));

describe('the paid mobile runtime after live entitlement loss', () => {
  it('removes paid surfaces and stops paid work in the same process', async () => {
    const disposeByScreen = new Map<string, jest.Mock>();
    const disposeBySlot = new Map<string, jest.Mock>();
    const disposeByHook = new Map<string, jest.Mock>();
    const toolDisposers: jest.Mock[] = [];
    const settingsDisposers: jest.Mock[] = [];
    const options = {
      registerToolExtension: jest.fn(() => {
        const dispose = jest.fn();
        toolDisposers.push(dispose);
        return dispose;
      }),
      registerScreen: jest.fn((screen: { name: string }) => {
        const dispose = jest.fn();
        disposeByScreen.set(screen.name, dispose);
        return dispose;
      }),
      registerSettingsSection: jest.fn(() => {
        const dispose = jest.fn();
        settingsDisposers.push(dispose);
        return dispose;
      }),
      registerSlot: jest.fn((name: string) => {
        const dispose = jest.fn();
        disposeBySlot.set(name, dispose);
        return dispose;
      }),
      registerHook: jest.fn((name: string) => {
        const dispose = jest.fn();
        disposeByHook.set(name, dispose);
        return dispose;
      }),
    };
    const pro = require('../../pro') as typeof import('../../pro');

    pro.activate(options as Parameters<typeof pro.activate>[0]);
    expect(mockClipboardEntitlement).toHaveBeenLastCalledWith(true);

    mockSetAccess(false);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(mockClipboardEntitlement).toHaveBeenLastCalledWith(false);
    expect(toolDisposers).toHaveLength(2);
    expect(toolDisposers.every(dispose => dispose.mock.calls.length === 1)).toBe(true);
    expect(disposeByScreen.get('McpServers')).toHaveBeenCalledTimes(1);
    expect(disposeByScreen.get('McpTools')).toHaveBeenCalledTimes(1);
    expect(disposeByScreen.get('McpGuide')).toHaveBeenCalledTimes(1);
    expect(disposeByScreen.get('AudioSettings')).toHaveBeenCalledTimes(1);
    expect(disposeBySlot.get('app.root')).toHaveBeenCalledTimes(1);
    expect(disposeBySlot.get('audio.slot')).toHaveBeenCalledTimes(1);
    expect(disposeByHook.get('audio.hook')).toHaveBeenCalledTimes(1);
    expect(mockAudioCleanup).toHaveBeenCalledTimes(1);
    expect(mockGrantCleanup).toHaveBeenCalledTimes(1);
    expect(mockReconcileCleanup).toHaveBeenCalledTimes(1);
    expect(mockDisconnectServer).toHaveBeenCalledWith('server-1');

    // Entitlement-recovery Sync stays registered so the user can reactivate.
    expect(disposeByScreen.get('Sync')).not.toHaveBeenCalled();
  });
});
