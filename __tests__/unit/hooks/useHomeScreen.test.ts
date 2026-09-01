/**
 * useHomeScreen Hook Unit Tests
 *
 * Tests for the HomeScreen orchestration hook covering:
 * - startNewChat / continueChat navigation
 * - handleDeleteConversation alert flow
 * - handleEjectAll (no-op, success, remote, error)
 * - handleSelectRemoteTextModel / handleUnloadRemoteTextModel
 * - handleSelectRemoteImageModel / handleUnloadRemoteImageModel
 * - activeTextModel / activeImageModel computation
 * - remoteTextModels / remoteImageModels filtering
 */

import { renderHook, act } from '@testing-library/react-native';

let mockActiveTextSnapshot: any = {
  model: null,
  modelId: null,
  modelName: 'Unknown',
  isRemote: false,
};
let mockActiveImageSnapshot: any = {
  modality: 'image',
  model: null,
};

jest.mock('../../../src/hooks/useActiveTextModel', () => ({
  useActiveTextModel: () => mockActiveTextSnapshot,
}));

jest.mock('../../../src/hooks/useActiveMobileModel', () => ({
  useActiveMobileModel: (modality: string) =>
    modality === 'image'
      ? mockActiveImageSnapshot
      : { modality: 'text', model: mockActiveTextSnapshot.model },
}));

// ============================================================================
// Service mocks
// ============================================================================
// useActiveTextModel imports the service module directly, so mocking only the barrel left the real
// service reading the real store while this suite drove a mocked one.
jest.mock('../../harness/activeModelLifecycle', () => ({
  activeModelService: {
    ...require('../../utils/activeModelServiceStub').activeModelSelectionStub(),
  },
}));

jest.mock('../../../src/services', () => ({
  modelLibrary: {
    getDownloadedModels: jest.fn().mockResolvedValue([]),
    getDownloadedImageModels: jest.fn().mockResolvedValue([]),
    linkOrphanMmProj: jest.fn().mockResolvedValue(undefined),
  },
  hardwareService: {
    getDeviceInfo: jest.fn().mockResolvedValue({ deviceName: 'TestPhone' }),
  },
  getResourceUsage: jest.fn().mockResolvedValue({
    totalMemory: 8000,
    usedMemory: 2000,
    availableMemory: 6000,
  }),
  subscribeToModelState: jest.fn(() => jest.fn()),
  syncWithNativeState: jest.fn().mockResolvedValue(undefined),
  selectMobileModel: jest.fn().mockResolvedValue(undefined),
  clearMobileModel: jest.fn().mockResolvedValue(undefined),
  unloadTextModel: jest.fn().mockResolvedValue(undefined),
  activeModelService: {
    // The model-selection seam, from the one place it is defined.
    ...require('../../utils/activeModelServiceStub').activeModelSelectionStub(),
    syncWithNativeState: jest.fn(),
    getResourceUsage: jest.fn().mockResolvedValue({ totalMemory: 8000, usedMemory: 2000, availableMemory: 6000 }),
    subscribe: jest.fn(() => jest.fn()),
    unloadAllModels: jest.fn().mockResolvedValue({ textUnloaded: true, imageUnloaded: false }),
  },
  remoteServerManager: {
    setActiveRemoteTextModel: jest.fn().mockResolvedValue(undefined),
    setActiveRemoteImageModel: jest.fn().mockResolvedValue(undefined),
    clearActiveRemoteModel: jest.fn(),
    addServer: jest.fn().mockResolvedValue({ id: 'mock-id', name: 'mock', endpoint: 'http://mock' }),
    updateServer: jest.fn().mockResolvedValue(undefined),
    testConnection: jest.fn().mockResolvedValue({ success: true }),
  },
  ResourceUsage: {},
}));

jest.mock('../../../src/screens/HomeScreen/hooks/useModelLoading', () => ({
  useModelLoading: jest.fn(() => ({
    handleSelectTextModel: jest.fn(),
    handleUnloadTextModel: jest.fn(),
    handleSelectImageModel: jest.fn(),
    handleUnloadImageModel: jest.fn(),
  })),
}));

jest.mock('../../../src/components', () => ({
  initialAlertState: { visible: false, title: '', message: '', buttons: [] },
  showAlert: jest.fn((title, message, buttons) => ({ visible: true, title, message, buttons: buttons || [] })),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
}));

// ============================================================================
// Store mocks
// ============================================================================
const mockCreateConversation = jest.fn(() => 'conv-new');
const mockSetActiveConversation = jest.fn();
const mockDeleteConversation = jest.fn();

jest.mock('../../../src/stores', () => {
  const appState = {
    downloadedModels: [],
    setDownloadedModels: jest.fn(),
    activeModelId: null,
    setActiveModelId: jest.fn(),
    downloadedImageModels: [],
    setDownloadedImageModels: jest.fn(),
    activeImageModelId: null,
    setActiveImageModelId: jest.fn(),
    deviceInfo: { deviceName: 'TestPhone' },
    setDeviceInfo: jest.fn(),
    generatedImages: [],
    settings: { contextLength: 4096 },
    updateSettings: jest.fn(),
  };
  const remoteState = {
    servers: [] as any[],
    discoveredModels: {},
    activeRemoteTextModelId: null,
    activeRemoteImageModelId: null,
    activeServerId: null,
  };
  const useAppStore: any = jest.fn((selector?: any) => (selector ? selector(appState) : appState));
  useAppStore.getState = () => appState;
  const useRemoteServerStore: any = jest.fn((selector?: any) => (selector ? selector(remoteState) : remoteState));
  useRemoteServerStore.getState = () => remoteState;
  return {
    useAppStore,
    useChatStore: jest.fn(() => ({
      conversations: [],
      createConversation: mockCreateConversation,
      setActiveConversation: mockSetActiveConversation,
      deleteConversation: mockDeleteConversation,
    })),
    useRemoteServerStore,
  };
});

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { useHomeScreen } from '../../../src/screens/HomeScreen/hooks/useHomeScreen';
import {
  clearMobileModel,
  selectMobileModel,
} from '../../../src/services';
import { useAppStore, useChatStore, useRemoteServerStore } from '../../../src/stores';
import { showAlert, hideAlert } from '../../../src/components';

const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate } as any;

describe('useHomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveTextSnapshot = {
      model: null,
      modelId: null,
      modelName: 'Unknown',
      isRemote: false,
    };
    mockActiveImageSnapshot = { modality: 'image', model: null };
    (useRemoteServerStore as unknown as jest.Mock).mockImplementation((selector?: any) => {
      const state = {
        servers: [],
        discoveredModels: {},
        activeRemoteTextModelId: null,
        activeRemoteImageModelId: null,
        activeServerId: null,
      };
      return selector ? selector(state) : state;
    });
    (useChatStore as unknown as jest.Mock).mockReturnValue({
      conversations: [],
      createConversation: mockCreateConversation,
      setActiveConversation: mockSetActiveConversation,
      deleteConversation: mockDeleteConversation,
    });
    (useAppStore as unknown as jest.Mock).mockImplementation((sel?: any) => {
      const st = {
        downloadedModels: [],
        setDownloadedModels: jest.fn(),
        activeModelId: null,
        setActiveModelId: jest.fn(),
        downloadedImageModels: [],
        setDownloadedImageModels: jest.fn(),
        activeImageModelId: null,
        setActiveImageModelId: jest.fn(),
        deviceInfo: { deviceName: 'TestPhone' },
        setDeviceInfo: jest.fn(),
        generatedImages: [],
        settings: { contextLength: 4096 },
      };
      return sel ? sel(st) : st;
    });
  });

  // ==========================================================================
  // Navigation
  // ==========================================================================
  describe('startNewChat', () => {
    it('does nothing when no active model', () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      act(() => { result.current.startNewChat(); });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('creates conversation and navigates when local model is active', () => {
      mockActiveTextSnapshot = {
        model: { id: 'local-model-1', name: 'Local' },
        modelId: 'local-model-1',
        modelName: 'Local',
        isRemote: false,
      };
      (useAppStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        downloadedModels: [{ id: 'local-model-1', name: 'Local' }], setDownloadedModels: jest.fn(),
        activeModelId: 'local-model-1', setActiveModelId: jest.fn(),
        downloadedImageModels: [], setDownloadedImageModels: jest.fn(),
        activeImageModelId: null, setActiveImageModelId: jest.fn(),
        deviceInfo: null, setDeviceInfo: jest.fn(),
        generatedImages: [], settings: { contextLength: 4096 },
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      act(() => { result.current.startNewChat(); });
      expect(mockNavigate).toHaveBeenCalledWith('Chat', {});
    });

    it('uses remote text model id when no local model is active', () => {
      mockActiveTextSnapshot = {
        model: { id: 'remote-model-1', name: 'Remote', serverId: 'server-1' },
        modelId: 'remote-model-1',
        modelName: 'Remote',
        isRemote: true,
      };
      (useRemoteServerStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        servers: [], discoveredModels: { 'server-1': [{ id: 'remote-model-1', name: 'Remote' }] },
        activeRemoteTextModelId: 'remote-model-1',
        activeRemoteImageModelId: null,
        activeServerId: 'server-1',
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      act(() => { result.current.startNewChat(); });
      expect(mockNavigate).toHaveBeenCalledWith('Chat', {});
    });
  });

  describe('continueChat', () => {
    it('sets active conversation and navigates', () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      act(() => { result.current.continueChat('conv-123'); });
      expect(mockSetActiveConversation).toHaveBeenCalledWith('conv-123');
      expect(mockNavigate).toHaveBeenCalledWith('Chat', { conversationId: 'conv-123' });
    });
  });

  // ==========================================================================
  // handleDeleteConversation
  // ==========================================================================
  describe('handleDeleteConversation', () => {
    it('shows delete confirmation alert', () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      const conversation = { id: 'conv-1', title: 'My Chat' } as any;
      act(() => { result.current.handleDeleteConversation(conversation); });
      expect(showAlert).toHaveBeenCalledWith(
        'Delete Conversation',
        expect.stringContaining('My Chat'),
        expect.any(Array),
      );
    });

    it('deletes conversation when confirmed', () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      const conversation = { id: 'conv-1', title: 'My Chat' } as any;
      act(() => { result.current.handleDeleteConversation(conversation); });
      const buttons = (showAlert as jest.Mock).mock.calls[0][2];
      const deleteBtn = buttons.find((b: any) => b.text === 'Delete');
      act(() => { deleteBtn.onPress(); });
      expect(mockDeleteConversation).toHaveBeenCalledWith('conv-1');
      expect(hideAlert).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // handleEjectAll
  // ==========================================================================
  describe('handleEjectAll', () => {
    it('does nothing when no active models', () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      act(() => { result.current.handleEjectAll(); });
      expect(showAlert).not.toHaveBeenCalled();
    });

    it('shows eject confirmation when local model is active', () => {
      (useAppStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        downloadedModels: [], setDownloadedModels: jest.fn(),
        activeModelId: 'model-1', setActiveModelId: jest.fn(),
        downloadedImageModels: [], setDownloadedImageModels: jest.fn(),
        activeImageModelId: null, setActiveImageModelId: jest.fn(),
        deviceInfo: null, setDeviceInfo: jest.fn(),
        generatedImages: [], settings: { contextLength: 4096 },
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      act(() => { result.current.handleEjectAll(); });
      expect(showAlert).toHaveBeenCalledWith(
        'Eject All Models',
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ text: 'Cancel' }),
          expect.objectContaining({ text: 'Eject All' }),
        ]),
      );
    });

    it('shows eject confirmation when remote model is active', () => {
      mockActiveTextSnapshot = {
        model: { id: 'remote-1', name: 'Remote', serverId: 'server-1' },
        modelId: 'remote-1',
        modelName: 'Remote',
        isRemote: true,
      };
      (useRemoteServerStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        servers: [], discoveredModels: {},
        activeRemoteTextModelId: 'remote-1',
        activeRemoteImageModelId: null,
        activeServerId: 'server-1',
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      act(() => { result.current.handleEjectAll(); });
      expect(showAlert).toHaveBeenCalledWith('Eject All Models', expect.any(String), expect.any(Array));
    });
  });

  // ==========================================================================
  // Remote model handlers
  // ==========================================================================
  describe('handleSelectRemoteTextModel', () => {
    it('selects the shared remote text route and clears loading state', async () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      const model = { id: 'remote-1', serverId: 'server-1', name: 'Remote Llama', capabilities: {} } as any;
      await act(async () => { await result.current.handleSelectRemoteTextModel(model); });
      expect(selectMobileModel).toHaveBeenCalledWith({
        source: 'remote',
        hostId: 'server-1',
        modality: 'text',
        modelId: 'remote-1',
      });
      expect(result.current.loadingState.isLoading).toBe(false);
    });

    it('shows error alert when remote text route selection fails', async () => {
      (selectMobileModel as jest.Mock).mockRejectedValueOnce(
        new Error('Server offline'),
      );
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      const model = { id: 'r1', serverId: 's1', name: 'Model', capabilities: {} } as any;
      await act(async () => { await result.current.handleSelectRemoteTextModel(model); });
      expect(showAlert).toHaveBeenCalledWith('Error', expect.stringContaining('Server offline'));
    });
  });

  describe('handleUnloadRemoteTextModel', () => {
    it('clears the shared text route', async () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      await act(async () => { await result.current.handleUnloadRemoteTextModel(); });
      expect(clearMobileModel).toHaveBeenCalledWith('text');
    });
  });

  describe('handleSelectRemoteImageModel', () => {
    it('selects the shared remote image route', async () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      const model = { id: 'img-1', serverId: 'server-1', name: 'Vision Model', capabilities: {} } as any;
      await act(async () => { await result.current.handleSelectRemoteImageModel(model); });
      expect(selectMobileModel).toHaveBeenCalledWith({
        source: 'remote',
        hostId: 'server-1',
        modality: 'image',
        modelId: 'img-1',
      });
    });

    it('shows error alert when remote image route selection fails', async () => {
      (selectMobileModel as jest.Mock).mockRejectedValueOnce(
        new Error('Vision unavailable'),
      );
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      const model = { id: 'img-1', serverId: 'server-1', name: 'Vision', capabilities: {} } as any;
      await act(async () => { await result.current.handleSelectRemoteImageModel(model); });
      expect(showAlert).toHaveBeenCalledWith('Error', expect.stringContaining('Vision unavailable'));
    });
  });

  describe('handleUnloadRemoteImageModel', () => {
    it('clears the shared image route', async () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      await act(async () => { await result.current.handleUnloadRemoteImageModel(); });
      expect(clearMobileModel).toHaveBeenCalledWith('image');
    });
  });

  // ==========================================================================
  // Computed values
  // ==========================================================================
  describe('activeTextModel computation', () => {
    it('returns local model when active', () => {
      const localModel = { id: 'local-1', name: 'Local Llama' } as any;
      mockActiveTextSnapshot = {
        model: localModel,
        modelId: localModel.id,
        modelName: localModel.name,
        isRemote: false,
      };
      (useAppStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        downloadedModels: [localModel],
        setDownloadedModels: jest.fn(),
        activeModelId: 'local-1',
        setActiveModelId: jest.fn(),
        downloadedImageModels: [], setDownloadedImageModels: jest.fn(),
        activeImageModelId: null, setActiveImageModelId: jest.fn(),
        deviceInfo: null, setDeviceInfo: jest.fn(),
        generatedImages: [], settings: { contextLength: 4096 },
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      expect(result.current.activeTextModel).toEqual(localModel);
    });

    it('returns remote text model when no local model', () => {
      const remoteModel = { id: 'remote-1', serverId: 'server-1', name: 'Remote', capabilities: { supportsVision: false } } as any;
      mockActiveTextSnapshot = {
        model: remoteModel,
        modelId: remoteModel.id,
        modelName: remoteModel.name,
        isRemote: true,
      };
      (useRemoteServerStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        servers: [{ id: 'server-1' }],
        discoveredModels: { 'server-1': [remoteModel] },
        activeRemoteTextModelId: 'remote-1',
        activeRemoteImageModelId: null,
        activeServerId: 'server-1',
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      expect(result.current.activeTextModel).toEqual(remoteModel);
    });

    it('returns null when no active model', () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      expect(result.current.activeTextModel).toBeNull();
    });
  });


  // ==========================================================================
  // Error paths in unload handlers
  // ==========================================================================
  describe('handleUnloadRemoteTextModel error path', () => {
    it('shows error alert when clearing the shared text route fails', async () => {
      (clearMobileModel as jest.Mock).mockRejectedValueOnce(new Error('Clear failed'));
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      await act(async () => { await result.current.handleUnloadRemoteTextModel(); });
      expect(showAlert).toHaveBeenCalledWith('Error', 'Failed to disconnect remote model');
    });
  });

  describe('handleUnloadRemoteImageModel error path', () => {
    it('shows error alert when clearing the shared image route fails', async () => {
      (clearMobileModel as jest.Mock).mockRejectedValueOnce(new Error('Clear failed'));
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      await act(async () => { await result.current.handleUnloadRemoteImageModel(); });
      expect(showAlert).toHaveBeenCalledWith('Error', 'Failed to disconnect remote model');
    });
  });

  // ==========================================================================
  // activeRemoteImageModel computation
  // ==========================================================================
  describe('activeImageModel computation with remote image model', () => {
    it('returns remote image model when active', () => {
      const remoteImgModel = { id: 'img-remote-1', serverId: 'server-1', name: 'Vision', capabilities: { supportsVision: true } } as any;
      mockActiveImageSnapshot = {
        modality: 'image',
        model: {
          id: remoteImgModel.id,
          name: remoteImgModel.name,
          source: 'remote',
          serverId: remoteImgModel.serverId,
        },
      };
      (useRemoteServerStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        servers: [{
          id: 'server-1',
          name: 'Server',
          catalog: { image: [remoteImgModel] },
        }],
        discoveredModels: { 'server-1': [remoteImgModel] },
        activeRemoteTextModelId: null,
        activeRemoteImageModelId: 'img-remote-1',
        activeServerId: 'server-1',
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      expect(result.current.activeImageModel).toEqual({
        id: 'img-remote-1',
        name: 'Vision',
        serverId: 'server-1',
        capabilities: {
          supportsVision: false,
          supportsToolCalling: false,
          supportsThinking: false,
        },
        details: { serverName: 'Server' },
        lastUpdated: '',
      });
    });
  });

  describe('remoteTextModels / remoteImageModels filtering', () => {
    it('includes all remote models (including VL) in remoteTextModels', () => {
      const textModel = { id: 't1', serverId: 's1', name: 'Text', capabilities: { supportsVision: false } } as any;
      const vlModel = { id: 'i1', serverId: 's1', name: 'Vision', capabilities: { supportsVision: true } } as any;
      (useRemoteServerStore as unknown as jest.Mock).mockImplementation((sel?: any) => { const st = {
        servers: [{ id: 's1' }],
        discoveredModels: { s1: [textModel, vlModel] },
        activeRemoteTextModelId: null,
        activeRemoteImageModelId: null,
        activeServerId: null,
      }; return sel ? sel(st) : st; });
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      // All remote models (including VL) go into remoteTextModels — remote image gen not supported
      expect(result.current.remoteTextModels).toEqual([textModel, vlModel]);
      expect(result.current.remoteImageModels).toEqual([]);
    });

    it('returns empty arrays when no servers', () => {
      const { result } = renderHook(() => useHomeScreen(mockNavigation));
      expect(result.current.remoteTextModels).toEqual([]);
      expect(result.current.remoteImageModels).toEqual([]);
    });
  });
});
