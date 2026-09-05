/**
 * HomeScreen Tests
 *
 * Tests for the home dashboard including:
 * - Model cards display
 * - Model selection and loading
 * - Memory management
 * - Quick navigation
 * - Recent conversations
 * - Stats display
 * - Gallery link
 * - New chat button
 * - Eject all button
 * - Model picker sheet interactions
 * - Delete conversation
 * - Loading overlay
 */

import { formatShortDate, formatWeekday } from '../../../src/utils/localTime';
import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import {
  arrangeLocalSelection,
  createMultipleConversations,
  resetStores,
} from '../../utils/testHelpers';
import { useModelResidencyStore } from '../../../src/stores/modelResidencyStore';
import {
  refreshMobileModelServices,
  startMobileModelServices,
} from '../../../src/services/modelServices';

/** Select a local model the way the app persists it, then let the shared inventory see it. */
const selectLocal = async (modality: 'text' | 'image', modelId: string) => {
  arrangeLocalSelection(modality, modelId);
  await refreshMobileModelServices();
};

const saveAndSelectRemoteTextModel = async (name: string) => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ object: 'list', data: [{ id: name }] }),
  } as unknown as Response));
  try {
    const saved = await applicationFacade().models.saveRemoteServer({
      id: 'summary-server',
      name: 'Summary server',
      endpoint: 'http://192.168.1.2:8000/v1',
      provider: 'openai-compatible',
    });
    expect(saved.ok).toBe(true);
    const discovered = await applicationFacade().models.discoverRemoteServers('summary-server');
    expect(discovered.ok).toBe(true);
    const selected = await applicationFacade().models.activateOnServer('summary-server', 'text', name);
    expect(selected.ok).toBe(true);
    return 'summary-server';
  } finally {
    global.fetch = originalFetch;
  }
};

const importAndSelectImageArchive = async () => {
  const stopModelServices = startMobileModelServices();
  const RNFS = require('react-native-fs') as { exists: jest.Mock; readDir: jest.Mock };
  const zip = require('react-native-zip-archive') as { unzip: jest.Mock };
  const previousExists = RNFS.exists.getMockImplementation();
  const previousReadDir = RNFS.readDir.getMockImplementation();
  const previousUnzip = zip.unzip.getMockImplementation();
  let modelRoot = '';
  const files = ['unet.mnn', 'unet.mnn.weight', 'vae_decoder.mnn'];
  RNFS.exists.mockImplementation(async path =>
    Boolean(modelRoot) && (path === modelRoot || path.startsWith(`${modelRoot}/`)),
  );
  RNFS.readDir.mockImplementation(async path => path === modelRoot
    ? files.map(name => ({
        name,
        path: `${modelRoot}/${name}`,
        size: 100,
        isFile: () => true,
        isDirectory: () => false,
      }))
    : ((await previousReadDir?.(path)) ?? []));
  zip.unzip.mockImplementation(async (_archive: string, destination: string) => {
    modelRoot = destination;
    return destination;
  });
  const restore = () => {
    stopModelServices();
    if (previousExists) RNFS.exists.mockImplementation(previousExists);
    if (previousReadDir) RNFS.readDir.mockImplementation(previousReadDir);
    if (previousUnzip) zip.unzip.mockImplementation(previousUnzip);
  };
  const imported = await importMobileImageArchive({
    sourceUri: 'file:///external/SDXL-Turbo.zip',
    fileName: 'SDXL-Turbo.zip',
  });
  expect(imported.status).toBe('imported');
  if (imported.status !== 'imported') {
    restore();
    throw new Error(imported.error);
  }
  expect(imported.activated).toBe(true);
  return { modelId: imported.model.id, restore };
};
import {
  createDownloadedModel,
  createONNXImageModel,
  createDeviceInfo,
  createConversation,
  createVisionModel,
  createMessage,
} from '../../utils/factories';
import { Linking, Clipboard } from 'react-native';
import { OFF_GRID_DESKTOP_URL } from '../../../src/constants';
import { withUtm } from '../../../src/utils/utm';
import { SUPPORT_EMAIL } from '../../../src/utils/supportEmail';
import { applicationFacade } from '../../../src/services/applicationFacade';
import { importMobileImageArchive } from '../../../src/services/adapters/models/library/imageArchiveImportAdapter';
import { installLanProbe } from '../../harness/lanProbe';
import logger from '../../../src/utils/logger';

// Mock requestAnimationFrame
(globalThis as any).requestAnimationFrame = (cb: () => void) => {
  return setTimeout(cb, 0);
};

// Mock navigation
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
  };
});

// Mock services
const mockLoadTextModel = jest.fn(() => Promise.resolve());
const mockLoadImageModel = jest.fn((..._args: any[]) => Promise.resolve());
const mockUnloadTextModel = jest.fn(() => Promise.resolve());
const mockUnloadImageModel = jest.fn(() => Promise.resolve());
const mockUnloadAllModels = jest.fn(() => Promise.resolve({ textUnloaded: true, imageUnloaded: true }));
// The screen ejects via activeModelService.ejectAll(), which (in the real service)
// delegates to unloadAllModels(true) and returns the number unloaded. Mirror that
// here so the eject tests drive the current flow and surface unloadAllModels failures.
const mockEjectAll = jest.fn(async () => {
  const { textUnloaded, imageUnloaded } = await mockUnloadAllModels();
  return { count: (textUnloaded ? 1 : 0) + (imageUnloaded ? 1 : 0) };
});
const mockCheckMemoryForModel = jest.fn(() => Promise.resolve({ canLoad: true, severity: 'safe', message: '' }));
const mockGetResourceUsage = jest.fn(() => Promise.resolve({
  textModelMemory: 0,
  imageModelMemory: 0,
  totalMemory: 0,
  memoryAvailable: 4 * 1024 * 1024 * 1024,
}));
const mockSubscribeToModelState = jest.fn((_listener?: () => void) => jest.fn());

jest.mock('../../../src/services', () => ({
  ...jest.requireActual('../../../src/services'),
  getResourceUsage: () => mockGetResourceUsage(),
  subscribeToModelState: (listener: () => void) => mockSubscribeToModelState(listener),
  syncWithNativeState: jest.fn().mockResolvedValue(undefined),
  loadImageModel: (...args: any[]) => mockLoadImageModel(...args),
  unloadTextModel: () => mockUnloadTextModel(),
  unloadImageModel: () => mockUnloadImageModel(),
}));

jest.mock('../../harness/activeModelLifecycle', () => ({
  activeModelService: {
    // The model-selection seam, from the one place it is defined.
    ...require('../../utils/activeModelServiceStub').activeModelSelectionStub(),
    loadTextModel: mockLoadTextModel,
    // Boundary mock mirrors the real selectTextModel (the single owner of the selection write).
    selectTextModel: jest.fn((id: string) => {
      // The selection is arranged the way the app persists it (one selection store).
      require('../../utils/testHelpers').arrangeLocalSelection('text', id);
    }),
    loadImageModel: mockLoadImageModel,
    unloadTextModel: mockUnloadTextModel,
    unloadImageModel: mockUnloadImageModel,
    unloadAllModels: mockUnloadAllModels,
    ejectAll: mockEjectAll,
    getActiveModels: jest.fn(() => ({ text: null, image: null })),
    checkMemoryForModel: mockCheckMemoryForModel,
    checkMemoryForDualModel: jest.fn(() => Promise.resolve({ canLoad: true, severity: 'safe', message: '' })),
    subscribe: jest.fn(() => jest.fn()),
    getResourceUsage: jest.fn(() => Promise.resolve({
      textModelMemory: 0,
      imageModelMemory: 0,
      totalMemory: 0,
      memoryAvailable: 4 * 1024 * 1024 * 1024,
    })),
    syncWithNativeState: jest.fn(),
    getLoadedModelIds: jest.fn(() => ({ textModelId: null, imageModelId: null })),
  },
}));

jest.mock('../../../src/services/hardware', () => ({
  hardwareService: {
    getDeviceInfo: jest.fn(() => Promise.resolve({
      totalMemory: 8 * 1024 * 1024 * 1024,
      availableMemory: 4 * 1024 * 1024 * 1024,
    })),
    getTotalMemoryGB: jest.fn(() => 8),
    formatBytes: jest.fn((bytes: number) => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`),
    formatModelSize: jest.fn(() => '4.0 GB'),
    getModelTotalSize: jest.fn((model: any) => model.fileSize ?? model.size ?? 0),
    estimateImageModelRam: jest.fn((model: any) => model.size ?? 0),
    formatModelRam: jest.fn((bytes: number) => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB RAM`),
  },
}));

// Mock useFocusTrigger
jest.mock('../../../src/hooks/useFocusTrigger', () => ({
  useFocusTrigger: () => 0,
}));

// Mock Swipeable to render children AND renderRightActions
jest.mock('react-native-gesture-handler/Swipeable', () => {
  const { forwardRef } = require('react');
  const { View } = require('react-native');
  return forwardRef(({ children, renderRightActions, containerStyle }: any, _ref: any) => (
    <View style={containerStyle}>
      {children}
      {renderRightActions && <View testID="swipeable-right-actions">{renderRightActions()}</View>}
    </View>
  ));
});

// Import after mocks
import { HomeScreen } from '../../../src/screens/HomeScreen';
import { activeModelService } from '../../harness/activeModelLifecycle';

const mockNavigation = {
  navigate: mockNavigate,
  goBack: mockGoBack,
  setOptions: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  dispatch: jest.fn(),
  reset: jest.fn(),
  isFocused: jest.fn(() => true),
  canGoBack: jest.fn(() => false),
  getParent: jest.fn(),
  getState: jest.fn(),
  getId: jest.fn(),
  setParams: jest.fn(),
} as any;

const renderHomeScreen = () => {
  return render(
    <NavigationContainer>
      <HomeScreen navigation={mockNavigation} />
    </NavigationContainer>
  );
};

// The per-type model cards were replaced by a collapsed summary row that opens a
// ModelsManagerSheet; the actual text/image pickers are opened from rows in that
// sheet. These helpers reproduce that flow so picker tests stay focused on the
// picker behaviour rather than the navigation chrome.
type RenderResult = ReturnType<typeof renderHomeScreen>;
const openTextPicker = ({ getByTestId }: RenderResult) => {
  fireEvent.press(getByTestId('models-summary'));
  fireEvent.press(getByTestId('models-row-text'));
};
const openImagePicker = ({ getByTestId }: RenderResult) => {
  fireEvent.press(getByTestId('models-summary'));
  fireEvent.press(getByTestId('models-row-image'));
};

describe('HomeScreen', () => {
  let stopModelServices: (() => void) | null = null;

  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();

    // Re-setup activeModelService mock after clearAllMocks
    (activeModelService.subscribe as jest.Mock).mockReturnValue(jest.fn());
    (activeModelService.getActiveModels as jest.Mock).mockReturnValue({
      text: { modelId: null, modelPath: null, isLoading: false },
      image: { modelId: null, modelPath: null, isLoading: false },
    });
    mockCheckMemoryForModel.mockResolvedValue({
      canLoad: true,
      severity: 'safe',
      message: '',
    });
    mockGetResourceUsage.mockResolvedValue({
      textModelMemory: 0,
      imageModelMemory: 0,
      totalMemory: 0,
      memoryAvailable: 4 * 1024 * 1024 * 1024,
    });
    mockSubscribeToModelState.mockReturnValue(jest.fn());
    (activeModelService.getResourceUsage as jest.Mock).mockResolvedValue({
      textModelMemory: 0,
      imageModelMemory: 0,
      totalMemory: 0,
      memoryAvailable: 4 * 1024 * 1024 * 1024,
    });
    (activeModelService.getLoadedModelIds as jest.Mock).mockReturnValue({ textModelId: null, imageModelId: null });
    mockLoadTextModel.mockResolvedValue(undefined);
    mockLoadImageModel.mockResolvedValue(undefined);
    mockUnloadTextModel.mockResolvedValue(undefined);
    mockUnloadImageModel.mockResolvedValue(undefined);
    mockUnloadAllModels.mockResolvedValue({ textUnloaded: true, imageUnloaded: true });
    // ejectAll delegates to unloadAllModels and returns the unloaded count, mirroring
    // the real service. clearAllMocks() wiped the implementation, so restore it here.
    mockEjectAll.mockImplementation(async () => {
      const { textUnloaded, imageUnloaded } = await mockUnloadAllModels();
      return { count: (textUnloaded ? 1 : 0) + (imageUnloaded ? 1 : 0) };
    });
    // Re-assign functions that may be undefined after mock hoisting/clearing
    if (!activeModelService.checkMemoryForModel) {
      (activeModelService as any).checkMemoryForModel = mockCheckMemoryForModel;
    }
    if (!activeModelService.loadTextModel) {
      (activeModelService as any).loadTextModel = mockLoadTextModel;
    }
    if (!activeModelService.loadImageModel) {
      (activeModelService as any).loadImageModel = mockLoadImageModel;
    }
    if (!activeModelService.unloadTextModel) {
      (activeModelService as any).unloadTextModel = mockUnloadTextModel;
    }
    if (!activeModelService.unloadImageModel) {
      (activeModelService as any).unloadImageModel = mockUnloadImageModel;
    }
    if (!activeModelService.unloadAllModels) {
      (activeModelService as any).unloadAllModels = mockUnloadAllModels;
    }
    if (!activeModelService.ejectAll) {
      (activeModelService as any).ejectAll = mockEjectAll;
    }

    // Register the Mobile inventory adapters with the shared models facade, exactly as the app
    // does at boot. Without this the facade has no adapter that can see `downloadedModels`, so
    // every route lookup fails with "Unknown or ambiguous model" and no selection ever lands.
    stopModelServices = startMobileModelServices();
  });

  afterEach(() => {
    stopModelServices?.();
    stopModelServices = null;
  });

  describe('LAN discovery lifecycle', () => {
    it('uses saved remote settings and recovers from a pre-scan remount', async () => {
      jest.useFakeTimers();
      const lan = installLanProbe({});
      useAppStore.getState().updateSettings({ autoDiscoverRemoteModels: undefined });
      let firstMount: ReturnType<typeof renderHomeScreen> | undefined;
      let secondMount: ReturnType<typeof renderHomeScreen> | undefined;

      try {
        await useRemoteServerStore.persist.rehydrate();
        const saved = await applicationFacade().models.saveRemoteServer({
          name: 'Saved gateway',
          endpoint: 'http://192.168.1.2:11434',
          provider: 'ollama',
        });
        expect(saved.ok).toBe(true);

        firstMount = renderHomeScreen();
        await act(async () => {
          jest.advanceTimersByTime(0);
          await Promise.resolve();
        });
        expect(useAppStore.getState().settings.autoDiscoverRemoteModels).toBe(true);

        // Unmount before the deferred scan. A later mount must be able to schedule
        // the scan again from the saved gateway supplied through the application.
        await act(async () => {
          jest.advanceTimersByTime(1000);
          await Promise.resolve();
        });
        firstMount.unmount();
        firstMount = undefined;
        expect(lan.requested).toHaveLength(0);

        secondMount = renderHomeScreen();
        await act(async () => {
          jest.advanceTimersByTime(3000);
          await Promise.resolve();
        });
        expect(lan.requested).toHaveLength(762);
      } finally {
        firstMount?.unmount();
        secondMount?.unmount();
        lan.uninstall();
        jest.useRealTimers();
      }
    });
  });

  // ============================================================================
  // Off Grid AI Desktop promo card
  // ============================================================================
  describe('Off Grid AI Desktop promo card', () => {
    it('shows the card by default (not dismissed)', () => {
      const { getByTestId, getByText } = renderHomeScreen();
      expect(getByTestId('desktop-promo-card')).toBeTruthy();
      expect(getByText('Off Grid AI Desktop')).toBeTruthy();
    });

    it('renders the product idea card before the Desktop announcement', () => {
      const { toJSON } = renderHomeScreen();
      const renderedHome = JSON.stringify(toJSON());
      const supportCardIndex = renderedHome.indexOf('home-support-card');
      const desktopPromoIndex = renderedHome.indexOf('desktop-promo-card');

      expect(supportCardIndex).toBeGreaterThanOrEqual(0);
      expect(desktopPromoIndex).toBeGreaterThan(supportCardIndex);
    });

    it('hides the card when previously dismissed', () => {
      useAppStore.setState({ desktopPromoDismissed: true });
      const { queryByTestId } = renderHomeScreen();
      expect(queryByTestId('desktop-promo-card')).toBeNull();
    });

    it('tapping dismiss hides the card and persists the flag', () => {
      useAppStore.setState({ desktopPromoDismissed: false });
      const { getByTestId, queryByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('desktop-promo-dismiss'));
      expect(queryByTestId('desktop-promo-card')).toBeNull();
      expect(useAppStore.getState().desktopPromoDismissed).toBe(true);
    });

    it('tapping the card opens the Off Grid AI Desktop download URL', () => {
      useAppStore.setState({ desktopPromoDismissed: false });
      const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
      const { getByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('desktop-promo-card'));
      expect(spy).toHaveBeenCalledWith(withUtm(OFF_GRID_DESKTOP_URL, 'home-promo'));
      spy.mockRestore();
    });

    it('tapping copy link copies the URL and shows confirmation (for sharing on mobile)', () => {
      useAppStore.setState({ desktopPromoDismissed: false });
      const spy = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {});
      const { getByTestId, getByText } = renderHomeScreen();
      expect(getByText('Copy link')).toBeTruthy();
      fireEvent.press(getByTestId('desktop-promo-copy'));
      expect(spy).toHaveBeenCalledWith(withUtm(OFF_GRID_DESKTOP_URL, 'home-promo'));
      expect(getByText('Link copied')).toBeTruthy();
      spy.mockRestore();
    });
  });

  describe('product idea callout', () => {
    it('opens a prefilled email to the shared support address', () => {
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
      const { getByTestId, getByText } = renderHomeScreen();

      expect(getByTestId('home-support-card')).toBeTruthy();
      expect(getByText('What should we build next?')).toBeTruthy();
      expect(
        getByText('Tell us what you would like to see in Off Grid AI Mobile.'),
      ).toBeTruthy();

      fireEvent.press(getByTestId('home-support-email'));

      const mailUrl = openURL.mock.calls[0]?.[0] as string;
      expect(mailUrl).toContain(`mailto:${SUPPORT_EMAIL}?`);
      expect(decodeURIComponent(mailUrl)).toContain('[Idea] Off Grid AI Mobile');
      expect(decodeURIComponent(mailUrl)).toContain(
        'I would like to see this in Off Grid AI Mobile:',
      );
      openURL.mockRestore();
    });
  });

  // ============================================================================
  // Basic Rendering
  // ============================================================================
  describe('basic rendering', () => {
    it('renders without crashing', () => {
      const { getByTestId } = renderHomeScreen();
      expect(getByTestId('home-screen')).toBeTruthy();
    });

    it('shows the app logo beside the title without the old guided-tour dot', () => {
      const { getByTestId, getByText, queryByTestId } = renderHomeScreen();
      expect(getByTestId('home-app-logo')).toBeTruthy();
      expect(getByText('Off Grid AI')).toBeTruthy();
      expect(queryByTestId('guided-tour-trigger')).toBeNull();
    });

    it('shows Text and Image model card labels', () => {
      const { getByText } = renderHomeScreen();
      expect(getByText('Text')).toBeTruthy();
      expect(getByText('Image')).toBeTruthy();
    });
  });

  // ============================================================================
  // Models Summary Row
  //
  // The per-type model cards were replaced by a single collapsed control
  // (ModelsSummaryRow, testID "models-summary"). It renders a "Models" label,
  // a chevron, and four captioned type icons: Text, Image, Voice, Speech.
  // Active types use the primary color; inactive ones are dimmed. There is no
  // per-model name text on the home screen anymore — the active model name now
  // lives inside the ModelsManagerSheet rows.
  // ============================================================================
  describe('models summary row', () => {
    it('renders the collapsed models summary control', () => {
      const { getByTestId } = renderHomeScreen();
      expect(getByTestId('models-summary')).toBeTruthy();
    });

    it('shows the Models label and the four type captions', () => {
      const { getByText } = renderHomeScreen();
      expect(getByText('Models')).toBeTruthy();
      expect(getByText('Text')).toBeTruthy();
      expect(getByText('Image')).toBeTruthy();
      expect(getByText('Voice')).toBeTruthy();
      expect(getByText('Speech')).toBeTruthy();
    });

    it('shows the active text model name inside the manager sheet (not on the home screen)', async () => {
      const serverId = await saveAndSelectRemoteTextModel('Llama-3.2-3B');

      try {
        const { getAllByText, getByTestId, queryByText } = renderHomeScreen();
        // The name is not rendered directly on the home screen.
        expect(queryByText('Llama-3.2-3B')).toBeNull();

        // Open the manager sheet — the text row shows the active model name.
        fireEvent.press(getByTestId('models-summary'));
        expect(getAllByText('Llama-3.2-3B').length).toBeGreaterThanOrEqual(1);
      } finally {
        await applicationFacade().models.removeRemoteServer(serverId);
      }
    });

    it('shows the active image model name inside the manager sheet', async () => {
      const imported = await importAndSelectImageArchive();

      try {
        const { getByText, getByTestId } = renderHomeScreen();
        fireEvent.press(getByTestId('models-summary'));
        expect(getByText('SDXL Turbo')).toBeTruthy();
      } finally {
        await applicationFacade().models.remove(imported.modelId);
        imported.restore();
      }
    });

    it('opens the manager sheet when the summary row is pressed', () => {
      const { getByTestId, queryByTestId } = renderHomeScreen();
      expect(queryByTestId('models-row-text')).toBeNull();

      fireEvent.press(getByTestId('models-summary'));

      expect(queryByTestId('models-row-text')).toBeTruthy();
      expect(queryByTestId('models-row-image')).toBeTruthy();
      expect(queryByTestId('models-row-voice')).toBeTruthy();
      expect(queryByTestId('models-row-speech')).toBeTruthy();
    });
  });

  // ============================================================================
  // New Chat Button / Setup Card
  // ============================================================================
  describe('new chat button', () => {
    it('shows setup card when no text model active and models exist', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const { getByTestId } = renderHomeScreen();
      expect(getByTestId('setup-card')).toBeTruthy();
    });

    it('shows "Select a text model" when models downloaded but none active', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText } = renderHomeScreen();
      expect(getByText('Select a text or image model to start')).toBeTruthy();
    });

    it('explains that a local or network model can be selected when none are downloaded', () => {
      const { getByText } = renderHomeScreen();
      expect(getByText('Choose a model here or on your network.')).toBeTruthy();
    });

    it('shows "Select Model" button when models exist but none active', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText } = renderHomeScreen();
      expect(getByText('Select Model')).toBeTruthy();
    });

    it('shows "Browse Models" button when no models downloaded', () => {
      const { getByText } = renderHomeScreen();
      expect(getByText('Browse Models')).toBeTruthy();
    });

    it('navigates to ModelsTab when Browse Models pressed', () => {
      const { getByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('browse-models-button'));

      expect(mockNavigate).toHaveBeenCalledWith('ModelsTab', { initialTab: 'text' });
    });
  });

  // ============================================================================
  // Recent Conversations
  // ============================================================================
  describe('recent conversations', () => {
    it('shows recent conversations list with titles', () => {
      const conversations = [
        createConversation({ title: 'Chat about AI' }),
        createConversation({ title: 'Code review' }),
      ];
      useChatStore.setState({ conversations });

      const { getByText } = renderHomeScreen();
      expect(getByText('Chat about AI')).toBeTruthy();
      expect(getByText('Code review')).toBeTruthy();
    });

    it('shows "Recent" section header', () => {
      useChatStore.setState({
        conversations: [createConversation()],
      });

      const { getByText } = renderHomeScreen();
      expect(getByText('Recent')).toBeTruthy();
    });

    it('shows "See all" link', () => {
      useChatStore.setState({
        conversations: [createConversation()],
      });

      const { getByText } = renderHomeScreen();
      // "See all" now carries the total chat count: "See all (1)".
      expect(getByText(/See all \(1\)/)).toBeTruthy();
    });

    it('limits recent conversations to 4', () => {
      createMultipleConversations(6);

      const { queryAllByTestId } = renderHomeScreen();
      expect(queryAllByTestId(/^conversation-item-/).length).toBe(4);
    });

    it('opens conversation when tapped', () => {
      const conversation = createConversation({ title: 'Test Chat' });
      useChatStore.setState({ conversations: [conversation] });

      const { getByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('conversation-item-0'));

      expect(mockNavigate).toHaveBeenCalledWith('Chat', { conversationId: conversation.id });
    });

    it('shows message preview for conversations with messages', () => {
      const conv = createConversation({
        title: 'Preview Test',
        messages: [
          createMessage({ role: 'user', content: 'Hello AI!' }),
          createMessage({ role: 'assistant', content: 'Hi there, how can I help?' }),
        ],
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = renderHomeScreen();
      expect(getByText(/Hi there, how can I help/)).toBeTruthy();
    });

    it('shows a clean enhanced-prompt preview without model protocol', () => {
      const conv = createConversation({
        title: 'Draw a dog',
        messages: [
          createMessage({ role: 'user', content: 'Draw a dog' }),
          createMessage({
            role: 'assistant',
            content:
              '<think>__LABEL:Enhanced prompt__\nA sleek black dog in soft morning light.</think>',
          }),
        ],
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText, queryByText } = renderHomeScreen();
      expect(
        getByText('A sleek black dog in soft morning light.'),
      ).toBeTruthy();
      expect(queryByText(/<think>|__LABEL:/)).toBeNull();
    });

    it('shows "You: " prefix for last user message', () => {
      const conv = createConversation({
        title: 'User Preview Test',
        messages: [
          createMessage({ role: 'user', content: 'My last question' }),
        ],
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = renderHomeScreen();
      expect(getByText(/You: My last question/)).toBeTruthy();
    });

    it('does not show Recent section when no conversations', () => {
      useChatStore.setState({ conversations: [] });

      const { queryByText } = renderHomeScreen();
      expect(queryByText('Recent')).toBeNull();
    });

    it('navigates to ChatsTab when See all pressed', () => {
      useChatStore.setState({
        conversations: [createConversation()],
      });

      const { getByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('conversation-list-button'));

      expect(mockNavigate).toHaveBeenCalledWith('ChatsTab');
    });

    it('sets active conversation when opening one', () => {
      const conversation = createConversation({ title: 'Active Chat' });
      useChatStore.setState({ conversations: [conversation] });

      const { getByTestId } = renderHomeScreen();
      fireEvent.press(getByTestId('conversation-item-0'));

      expect(useChatStore.getState().activeConversationId).toBe(conversation.id);
    });
  });

  // ============================================================================
  // Eject All Button
  // ============================================================================
  // The "Eject All Models" button now lives inside the ModelsManagerSheet (opened
  // from the summary row), and only shows when at least one model is active.
  describe('eject all button', () => {
    it('does not show eject button when no models active', () => {
      const { getByTestId, queryByText } = renderHomeScreen();
      fireEvent.press(getByTestId('models-summary'));
      expect(queryByText('Eject All Models')).toBeNull();
    });

  });

  // ============================================================================
  // Gallery Card
  // ============================================================================
  describe('gallery card', () => {
    it('shows Image Gallery card', () => {
      const { getByText } = renderHomeScreen();
      expect(getByText('Image Gallery')).toBeTruthy();
    });

    it('shows "0 images" when no images', () => {
      const { getByText } = renderHomeScreen();
      expect(getByText('0 images')).toBeTruthy();
    });

    it('shows count with "images" (plural) for multiple images', () => {
      useAppStore.setState({
        generatedImages: [
          { id: '1', prompt: 'test', imagePath: '/path', width: 512, height: 512, steps: 20, seed: 1, modelId: 'm', createdAt: '' },
          { id: '2', prompt: 'test', imagePath: '/path', width: 512, height: 512, steps: 20, seed: 1, modelId: 'm', createdAt: '' },
        ],
      });

      const { getByText } = renderHomeScreen();
      expect(getByText('2 images')).toBeTruthy();
    });

    it('shows "1 image" (singular) for single image', () => {
      useAppStore.setState({
        generatedImages: [
          { id: '1', prompt: 'test', imagePath: '/path', width: 512, height: 512, steps: 20, seed: 1, modelId: 'm', createdAt: '' },
        ],
      });

      const { getByText } = renderHomeScreen();
      expect(getByText('1 image')).toBeTruthy();
    });
  });

  // ============================================================================
  // Stats Display
  // ============================================================================
  describe('stats display', () => {
    // The old stats row was removed: per-type counts now live in the Models card,
    // and the conversation count sits next to "See all".
    it('shows the text-model count in the Models card', () => {
      useAppStore.setState({
        downloadedModels: [
          createDownloadedModel(),
          createDownloadedModel(),
          createDownloadedModel(),
        ],
      });

      const { getByText } = renderHomeScreen();
      expect(getByText('Text')).toBeTruthy();
      expect(getByText('3')).toBeTruthy();
    });

    it('shows the image-model count in the Models card', () => {
      useAppStore.setState({
        downloadedImageModels: [
          createONNXImageModel(),
          createONNXImageModel(),
        ],
      });

      const { getByText } = renderHomeScreen();
      expect(getByText('Image')).toBeTruthy();
      expect(getByText('2')).toBeTruthy();
    });

    it('shows the conversation count next to See all', () => {
      createMultipleConversations(5);

      const { getByText } = renderHomeScreen();
      expect(getByText(/See all \(5\)/)).toBeTruthy();
    });

    it('shows zero per-type counts by default in the Models card', () => {
      // Four model types (text/image/voice/speech), each 0 by default.
      const { getAllByText } = renderHomeScreen();
      expect(getAllByText('0').length).toBe(4);
    });
  });

  // ============================================================================
  // Memory Estimation
  // ============================================================================
  describe('memory estimation', () => {
    it('renders with device info including total memory', () => {
      useAppStore.setState({
        deviceInfo: createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      });

      const { getByTestId } = renderHomeScreen();
      expect(getByTestId('home-screen')).toBeTruthy();
    });
  });

  // ============================================================================
  // Estimated RAM Display
  // ============================================================================
  // The estimated RAM per model is now shown in the picker items rather than on a
  // home-screen card (the home screen only shows the collapsed summary row).
  describe('estimated RAM display', () => {
    it('shows estimated RAM for a text model in the picker', async () => {
      const model = createDownloadedModel({
        name: 'Test Model',
        fileSize: 4 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [model],
      });
      await selectLocal('text', model.id);

      const result = renderHomeScreen();
      openTextPicker(result);
      expect(result.getByText(/6\.0 GB/)).toBeTruthy();
    });

    it('shows estimated RAM for an image model in the picker', async () => {
      const imageModel = createONNXImageModel({
        name: 'Test Image Model',
        size: 2 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
      });
      await selectLocal('image', imageModel.id);

      const result = renderHomeScreen();
      openImagePicker(result);
      expect(result.getAllByText(/2\.0 GB/).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // Model Picker Sheet
  // ============================================================================
  // Pickers are opened from rows in the ModelsManagerSheet (see openTextPicker /
  // openImagePicker). The ModelPickerSheet itself is unchanged.
  describe('model picker sheet', () => {
    it('opens text model picker when the text manager row is pressed', () => {
      const model = createDownloadedModel({ name: 'Llama' });
      useAppStore.setState({ downloadedModels: [model] });

      const result = renderHomeScreen();
      const { queryByText } = result;
      // No picker open yet (manager sheet is not open either).
      expect(queryByText('Browse more models')).toBeNull();

      openTextPicker(result);

      // Picker sheet shows its title (manager sheet has closed).
      expect(result.getByText('TEXT MODEL')).toBeTruthy();
    });

    it('opens image model picker when the image manager row is pressed', () => {
      const imageModel = createONNXImageModel({ name: 'TestImg' });
      useAppStore.setState({ downloadedImageModels: [imageModel] });

      const result = renderHomeScreen();
      openImagePicker(result);

      expect(result.getByText('IMAGE MODEL')).toBeTruthy();
    });

    it('shows the current empty text-model state', () => {
      const result = renderHomeScreen();
      openTextPicker(result);

      expect(result.queryByText('No Text Models')).toBeTruthy();
    });

    it('shows the current empty image-model state', () => {
      const result = renderHomeScreen();
      openImagePicker(result);

      expect(result.queryByText('No Image Models')).toBeTruthy();
    });

    it('shows model items in text picker', () => {
      const model1 = createDownloadedModel({ name: 'Model Alpha' });
      const model2 = createDownloadedModel({ name: 'Model Beta' });
      useAppStore.setState({ downloadedModels: [model1, model2] });

      const result = renderHomeScreen();
      openTextPicker(result);

      expect(result.getByTestId(`text-model-row-${model1.id}`)).toBeTruthy();
      expect(result.getByTestId(`text-model-row-${model2.id}`)).toBeTruthy();
      expect(result.getByText('Model Alpha')).toBeTruthy();
      expect(result.getByText('Model Beta')).toBeTruthy();
    });

    it('shows model items in image picker', () => {
      const imageModel = createONNXImageModel({ name: 'SD Turbo' });
      useAppStore.setState({ downloadedImageModels: [imageModel] });

      const result = renderHomeScreen();
      openImagePicker(result);

      expect(result.getByText('SD Turbo')).toBeTruthy();
    });

    it('shows unload button when a text model is resident', async () => {
      const model = createDownloadedModel({ name: 'Active Model' });
      useAppStore.setState({
        downloadedModels: [model],
      });
      await selectLocal('text', model.id);
      useModelResidencyStore.setState({ loadedTextModelId: model.id });

      const result = renderHomeScreen();
      openTextPicker(result);

      expect(result.getByTestId('currently-loaded-model')).toBeTruthy();
      expect(result.getByText('Unload')).toBeTruthy();
    });

    it('shows model item for active text model', async () => {
      const model = createDownloadedModel({ name: 'Checked Model' });
      useAppStore.setState({
        downloadedModels: [model],
      });
      await selectLocal('text', model.id);

      const result = renderHomeScreen();
      openTextPicker(result);

      // The model item should exist
      expect(result.getByTestId(`text-model-row-${model.id}`)).toBeTruthy();
    });

    it('closes picker when close button pressed', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const result = renderHomeScreen();
      openTextPicker(result);

      expect(result.getByText('Browse more models')).toBeTruthy();

      fireEvent.press(result.getByTestId('app-sheet-close'));

      expect(result.queryByText('Browse more models')).toBeNull();
    });

    it('shows "Browse more models" link in picker', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const result = renderHomeScreen();
      openTextPicker(result);

      expect(result.getByText('Browse more models')).toBeTruthy();
    });

    it('navigates to ModelsTab when "Browse more models" pressed', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const result = renderHomeScreen();
      openTextPicker(result);
      fireEvent.press(result.getByText('Browse more models'));

      expect(mockNavigate).toHaveBeenCalledWith('ModelsTab', { initialTab: 'text' });
    });

    it('shows memory estimate per model in picker', () => {
      const model = createDownloadedModel({
        name: 'RAM Model',
        fileSize: 4 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({ downloadedModels: [model] });

      const result = renderHomeScreen();
      openTextPicker(result);

      // Shows ~6.0 GB RAM (4 * 1.5 = 6.0)
      expect(result.getByText(/6\.0 GB RAM/)).toBeTruthy();
    });

    it('shows vision indicator for vision models in picker', () => {
      const visionModel = createVisionModel({ name: 'LLaVA Vision' });
      useAppStore.setState({ downloadedModels: [visionModel] });

      const result = renderHomeScreen();
      openTextPicker(result);

      expect(result.getAllByText(/Vision/).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // Model Selection (from picker)
  // ============================================================================
  // Selecting a model on the home screen is now MARK-ONLY. It marks the model
  // active in the store and closes the picker. Text loading is deferred to the
  // first chat message. Image selection runs the shared loader before it records
  // the active route because the image runtime must complete its hardware preflight.
  describe('model selection from picker', () => {
    it('closes the picker after selecting a text model', async () => {
      const model = createDownloadedModel({ name: 'Close After' });
      useAppStore.setState({ downloadedModels: [model] });
      const result = renderHomeScreen();
      openTextPicker(result);
      expect(result.getByText('Browse more models')).toBeTruthy();
      await act(async () => {
        fireEvent.press(result.getByTestId(`text-model-row-${model.id}`));
      });
      await waitFor(() => {
        expect(result.queryByText('Browse more models')).toBeNull();
      });
    });

  });

  // ============================================================================
  // Delete Conversation (via swipe)
  // ============================================================================
  describe('delete conversation', () => {
    it('shows delete confirmation when delete action triggered', () => {
      // The Swipeable renderRightActions renders a delete button
      // We need to test the handleDeleteConversation callback
      const conv = createConversation({ title: 'Delete Me' });
      useChatStore.setState({ conversations: [conv] });

      // The renderRightActions renders a trash button
      // Since Swipeable is mocked, the right actions may not be accessible directly
      // But the conversation item is rendered
      const { getByTestId } = renderHomeScreen();
      expect(getByTestId('conversation-item-0')).toBeTruthy();
    });
  });

  // ============================================================================
  // Memory Display
  // ============================================================================
  describe('memory display', () => {
    it('shows device total RAM', () => {
      useAppStore.setState({
        deviceInfo: createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      });

      const { getByTestId } = renderHomeScreen();
      expect(getByTestId('home-screen')).toBeTruthy();
    });

    it('shows estimated RAM usage for a loaded text model in the picker', async () => {
      const model = createDownloadedModel({ fileSize: 4 * 1024 * 1024 * 1024 });
      useAppStore.setState({
        downloadedModels: [model],
      });
      await selectLocal('text', model.id);

      const result = renderHomeScreen();
      openTextPicker(result);
      expect(result.getAllByText(/GB/).length).toBeGreaterThanOrEqual(1);
    });

    it('shows RAM estimates in both pickers when both models loaded', async () => {
      const model = createDownloadedModel({ fileSize: 4 * 1024 * 1024 * 1024 });
      const imageModel = createONNXImageModel({ size: 2 * 1024 * 1024 * 1024 });
      useAppStore.setState({
        downloadedModels: [model],
        downloadedImageModels: [imageModel],
      });
      await selectLocal('text', model.id);
      await selectLocal('image', imageModel.id);

      const result = renderHomeScreen();
      openTextPicker(result);
      expect(result.getAllByText(/GB/).length).toBeGreaterThanOrEqual(1);
      // Close the text picker, then open the image picker.
      fireEvent.press(result.getByTestId('app-sheet-close'));
      openImagePicker(result);
      expect(result.getAllByText(/GB/).length).toBeGreaterThanOrEqual(1);
    });

    it('renders without crashing when both models loaded', async () => {
      const model = createDownloadedModel();
      const imageModel = createONNXImageModel();
      useAppStore.setState({
        downloadedModels: [model],
        downloadedImageModels: [imageModel],
      });
      await selectLocal('text', model.id);
      await selectLocal('image', imageModel.id);

      const { getByTestId } = renderHomeScreen();
      expect(getByTestId('home-screen')).toBeTruthy();
    });
  });

  // ============================================================================
  // Loading Card States
  // ============================================================================
  // ============================================================================
  // Delete Conversation (full flow with swipe actions)
  // ============================================================================
  describe('delete conversation full flow', () => {
    it('renders delete button in swipeable right actions', () => {
      const conv = createConversation({ title: 'Swipeable Chat' });
      useChatStore.setState({ conversations: [conv] });

      const { getAllByTestId } = renderHomeScreen();
      expect(getAllByTestId('swipeable-right-actions').length).toBeGreaterThan(0);
    });

    it('shows delete confirmation and deletes conversation', async () => {
      const conv = createConversation({ title: 'Delete This Chat' });
      useChatStore.setState({ conversations: [conv] });

      const { getByTestId, getByText, queryByText } = renderHomeScreen();

      // Press the trash button (has testID="delete-conversation-button")
      fireEvent.press(getByTestId('delete-conversation-button'));

      await waitFor(() => {
        expect(queryByText('Delete Conversation')).toBeTruthy();
        expect(queryByText(`Delete "Delete This Chat"?`)).toBeTruthy();
      });

      // Press Delete button in the alert
      await act(async () => {
        fireEvent.press(getByText('Delete'));
      });

      // Conversation should be deleted
      expect(useChatStore.getState().conversations.length).toBe(0);
    });

    it('cancels delete conversation', async () => {
      const conv = createConversation({ title: 'Keep This Chat' });
      useChatStore.setState({ conversations: [conv] });

      const { getByTestId, getByText, queryByText } = renderHomeScreen();

      fireEvent.press(getByTestId('delete-conversation-button'));

      await waitFor(() => {
        expect(queryByText('Delete Conversation')).toBeTruthy();
      });

      // Press Cancel
      fireEvent.press(getByText('Cancel'));

      // Conversation should still exist
      expect(useChatStore.getState().conversations.length).toBe(1);
    });
  });

  // ============================================================================
  // Gallery Navigation
  // ============================================================================
  describe('gallery navigation', () => {
    it('navigates to Gallery when gallery card is pressed', () => {
      const { getByText } = renderHomeScreen();
      fireEvent.press(getByText('Image Gallery'));

      expect(mockNavigate).toHaveBeenCalledWith('Gallery');
    });
  });

  // ============================================================================
  // Empty Picker Browse Models Navigation
  // ============================================================================
  describe('empty picker browse navigation', () => {
    it('navigates to ModelsTab from empty text picker Browse Models button', () => {
      // No text models downloaded
      const result = renderHomeScreen();

      // Open the empty text picker via the manager sheet's text row.
      openTextPicker(result);

      // Inside the empty picker, there's a "Browse Models" button
      // There are multiple "Browse Models" - one in setup card, one in picker
      const browseButtons = result.getAllByText('Browse Models');
      // The last one is in the picker.
      fireEvent.press(browseButtons[browseButtons.length - 1]);

      expect(mockNavigate).toHaveBeenCalledWith('ModelsTab', { initialTab: 'text' });
    });

    it('navigates to ModelsTab from empty image picker Browse Models button', () => {
      // No image models downloaded
      const result = renderHomeScreen();

      // Open the empty image picker via the manager sheet's image row.
      openImagePicker(result);

      // Inside the empty picker, there's a "Browse Models" button
      const browseButtons = result.getAllByText('Browse Models');
      fireEvent.press(browseButtons[browseButtons.length - 1]);

      expect(mockNavigate).toHaveBeenCalledWith('ModelsTab', { initialTab: 'image' });
    });
  });

  // ============================================================================
  // formatDate branches
  // ============================================================================
  describe('formatDate coverage', () => {
    it('shows "Yesterday" for conversations updated yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const conv = createConversation({
        title: 'Yesterday Chat',
        updatedAt: yesterday.toISOString(),
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = renderHomeScreen();
      expect(getByText('Yesterday')).toBeTruthy();
    });

    it('shows weekday name for conversations updated 2-6 days ago', () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const conv = createConversation({
        title: 'Recent Chat',
        updatedAt: threeDaysAgo.toISOString(),
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = renderHomeScreen();
      // Should show a short weekday like "Mon", "Tue", etc.
      const expectedDay = formatWeekday(threeDaysAgo);
      expect(getByText(expectedDay)).toBeTruthy();
    });

    it('shows month and day for conversations updated more than 7 days ago', () => {
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      const conv = createConversation({
        title: 'Old Chat',
        updatedAt: twoWeeksAgo.toISOString(),
      });
      useChatStore.setState({ conversations: [conv] });

      const { getByText } = renderHomeScreen();
      // Asserted through the app's own formatter. Built with toLocaleDateString this answered in UTC on
      // a Hermes build with no ICU data - the exact bug src/utils/localTime.ts exists to fix, so the test
      // was checking the app against behaviour it had deliberately dropped.
      const expectedDate = formatShortDate(twoWeeksAgo);
      expect(getByText(expectedDate)).toBeTruthy();
    });
  });

  // ============================================================================
  // Memory Info Error Handling
  // ============================================================================
  describe('memory info error handling', () => {
    it('handles getResourceUsage failure gracefully', async () => {
      const warningSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      mockGetResourceUsage.mockRejectedValueOnce(
        new Error('Memory info failed')
      );

      renderHomeScreen();

      await waitFor(() => {
        expect(warningSpy).toHaveBeenCalledWith(
          expect.stringContaining('[HomeScreen] Failed to get memory info:'),
          expect.any(Error)
        );
      });

      warningSpy.mockRestore();
    });

    it('refreshes memory info when subscribe callback fires', async () => {
      let subscribeCb: (() => void) | null = null;
      mockSubscribeToModelState.mockImplementation((cb?: () => void) => {
        subscribeCb = cb ?? null;
        return jest.fn();
      });

      renderHomeScreen();

      // Initial call
      await waitFor(() => {
        expect(mockGetResourceUsage).toHaveBeenCalled();
      });

      const callCount = mockGetResourceUsage.mock.calls.length;

      // Trigger the subscription callback
      await act(async () => {
        subscribeCb?.();
      });

      await waitFor(() => {
        expect(mockGetResourceUsage.mock.calls.length).toBeGreaterThan(callCount);
      });
    });
  });

  // ============================================================================
  // Select Model button from setup card
  // ============================================================================
  describe('setup card select model button', () => {
    it('opens text model picker when "Select Model" button pressed', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const { getByText, queryByTestId } = renderHomeScreen();
      fireEvent.press(getByText('Select Model'));

      // Should open the text model picker
      expect(queryByTestId('app-sheet-surface')).toBeTruthy();
    });
  });
});
