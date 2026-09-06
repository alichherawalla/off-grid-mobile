/**
 * useHomeScreen — the Home orchestration hook over the REAL stores, the real shared selection
 * owner, and the real model command application. Nothing the hook reads is faked: selection is
 * arranged the way the app persists it, remote servers are real store records, and every outcome
 * is read back from the hook's own state or the persisted selection.
 *
 * The only doubles: the navigation object the screen would pass in, the logger noise sink, and a
 * spy on the command seam when a test needs the device side to fail.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { resetModelApplication } from '../../harness/activeModelLifecycle';
import { useHomeScreen } from '../../../src/screens/HomeScreen/hooks/useHomeScreen';
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { refreshMobileModelServices } from '../../../src/services/modelServices';
import {
  arrangeLocalSelection,
  arrangeRemoteSelection,
  resetStores,
  selectedRemoteRoute,
} from '../../utils/testHelpers';
import { createDownloadedModel } from '../../utils/factories';
import type { RemoteModel } from '../../../src/types';

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate } as any;

const remoteModel = (
  id: string,
  serverId: string,
  name: string,
  supportsVision = false,
): RemoteModel => ({
  id,
  serverId,
  name,
  capabilities: { supportsVision, supportsToolCalling: false, supportsThinking: false },
  lastUpdated: new Date(0).toISOString(),
});

/** A saved server with its discovered text models, exactly as discovery leaves the store. */
const arrangeServer = (serverId: string, models: RemoteModel[], name = 'Server') => {
  useRemoteServerStore.setState(state => ({
    servers: [
      ...state.servers,
      {
        id: serverId,
        name,
        endpoint: `https://${serverId}.test/v1`,
        provider: 'openai-compatible',
        createdAt: new Date(0).toISOString(),
      } as never,
    ],
  }));
  useRemoteServerStore.getState().setDiscoveredModels(serverId, models);
};

const renderHome = () => renderHook(() => useHomeScreen(mockNavigation));

describe('useHomeScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    resetStores();
    useRemoteServerStore.setState({ servers: [], serverHealth: {} });
    await resetModelApplication();
  });

  describe('startNewChat', () => {
    it('does nothing when no active model', () => {
      const { result } = renderHome();
      act(() => { result.current.startNewChat(); });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('creates conversation and navigates when local model is active', async () => {
      useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'local-model-1', name: 'Local' })] });
      arrangeLocalSelection('text', 'local-model-1');
      await refreshMobileModelServices();
      const { result } = renderHome();
      await waitFor(() => expect(result.current.activeModelId).toBe('local-model-1'));
      act(() => { result.current.startNewChat(); });
      expect(mockNavigate).toHaveBeenCalledWith('Chat', {});
    });

    it('uses remote text model id when no local model is active', async () => {
      arrangeServer('server-1', [remoteModel('remote-model-1', 'server-1', 'Remote')]);
      await arrangeRemoteSelection('text', 'server-1', 'remote-model-1');
      const { result } = renderHome();
      await waitFor(() => expect(result.current.activeRemoteTextModelId).toBe('remote-model-1'));
      act(() => { result.current.startNewChat(); });
      expect(mockNavigate).toHaveBeenCalledWith('Chat', {});
    });
  });

  describe('continueChat', () => {
    it('sets active conversation and navigates', () => {
      const conversationId = useChatStore.getState().createConversation('m1');
      useChatStore.getState().setActiveConversation(null);
      const { result } = renderHome();
      act(() => { result.current.continueChat(conversationId); });
      expect(useChatStore.getState().activeConversationId).toBe(conversationId);
      expect(mockNavigate).toHaveBeenCalledWith('Chat', { conversationId });
    });
  });

  describe('handleDeleteConversation', () => {
    it('shows delete confirmation alert', () => {
      const { result } = renderHome();
      const conversation = { id: 'conv-1', title: 'My Chat' } as any;
      act(() => { result.current.handleDeleteConversation(conversation); });
      expect(result.current.alertState.visible).toBe(true);
      expect(result.current.alertState.title).toBe('Delete Conversation');
      expect(result.current.alertState.message).toContain('My Chat');
    });

    it('deletes conversation when confirmed', () => {
      const conversationId = useChatStore.getState().createConversation('m1');
      const conversation = useChatStore.getState().conversations.find(c => c.id === conversationId)!;
      const { result } = renderHome();
      act(() => { result.current.handleDeleteConversation(conversation); });
      const deleteBtn = result.current.alertState.buttons!.find((b: any) => b.text === 'Delete')!;
      act(() => { deleteBtn.onPress!(); });
      expect(useChatStore.getState().conversations.some(c => c.id === conversationId)).toBe(false);
      expect(result.current.alertState.visible).toBe(false);
    });
  });

  describe('handleEjectAll', () => {
    it('does nothing when no active models', () => {
      const { result } = renderHome();
      act(() => { result.current.handleEjectAll(); });
      expect(result.current.alertState.visible).toBe(false);
    });

    it('shows eject confirmation when local model is active', async () => {
      useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'model-1' })] });
      arrangeLocalSelection('text', 'model-1');
      await refreshMobileModelServices();
      const { result } = renderHome();
      await waitFor(() => expect(result.current.activeModelId).toBe('model-1'));
      act(() => { result.current.handleEjectAll(); });
      expect(result.current.alertState.title).toBe('Eject All Models');
      expect(result.current.alertState.buttons!.map((b: any) => b.text)).toEqual(['Cancel', 'Eject All']);
    });

    it('shows eject confirmation when remote model is active', async () => {
      arrangeServer('server-1', [remoteModel('remote-1', 'server-1', 'Remote')]);
      await arrangeRemoteSelection('text', 'server-1', 'remote-1');
      const { result } = renderHome();
      await waitFor(() => expect(result.current.activeRemoteTextModelId).toBe('remote-1'));
      act(() => { result.current.handleEjectAll(); });
      expect(result.current.alertState.title).toBe('Eject All Models');
    });
  });

  describe('handleSelectRemoteTextModel', () => {
    it('selects the shared remote text route and clears loading state', async () => {
      const model = remoteModel('remote-1', 'server-1', 'Remote Llama');
      arrangeServer('server-1', [model]);
      await refreshMobileModelServices();
      const { result } = renderHome();
      await act(async () => { await result.current.handleSelectRemoteTextModel(model); });
      expect(selectedRemoteRoute('text')).toEqual({ serverId: 'server-1', modelId: 'remote-1' });
      expect(result.current.loadingState.isLoading).toBe(false);
    });

  });

  describe('handleUnloadRemoteTextModel', () => {
    it('clears the shared text route', async () => {
      arrangeServer('server-1', [remoteModel('remote-1', 'server-1', 'Remote')]);
      await arrangeRemoteSelection('text', 'server-1', 'remote-1');
      const { result } = renderHome();
      await act(async () => { await result.current.handleUnloadRemoteTextModel(); });
      expect(selectedRemoteRoute('text')).toBeNull();
      expect(result.current.loadingState.isLoading).toBe(false);
    });

  });

  describe('handleSelectRemoteImageModel', () => {
    it('selects the shared remote image route', async () => {
      useRemoteServerStore.setState({
        servers: [{
          id: 'server-1',
          name: 'Server',
          endpoint: 'https://server-1.test/v1',
          provider: 'openai-compatible',
          createdAt: new Date(0).toISOString(),
          catalog: { image: [{ id: 'img-1', name: 'Vision Model' }] },
          selections: { image: 'img-1' },
        } as never],
      });
      await refreshMobileModelServices();
      const { result } = renderHome();
      const model = remoteModel('img-1', 'server-1', 'Vision Model');
      await act(async () => { await result.current.handleSelectRemoteImageModel(model); });
      expect(selectedRemoteRoute('image')).toEqual({ serverId: 'server-1', modelId: 'img-1' });
    });

  });

  describe('handleUnloadRemoteImageModel', () => {
    it('clears the shared image route', async () => {
      await arrangeRemoteSelection('image', 'server-1', 'img-1');
      const { result } = renderHome();
      await act(async () => { await result.current.handleUnloadRemoteImageModel(); });
      expect(selectedRemoteRoute('image')).toBeNull();
    });

  });

  describe('activeTextModel computation', () => {
    it('returns local model when active', async () => {
      const localModel = createDownloadedModel({ id: 'local-1', name: 'Local Llama' });
      useAppStore.setState({ downloadedModels: [localModel] });
      arrangeLocalSelection('text', 'local-1');
      await refreshMobileModelServices();
      const { result } = renderHome();
      await waitFor(() => expect(result.current.activeTextModel).toEqual(localModel));
    });

    it('returns remote text model when no local model', async () => {
      const remote = remoteModel('remote-1', 'server-1', 'Remote');
      arrangeServer('server-1', [remote]);
      await arrangeRemoteSelection('text', 'server-1', 'remote-1');
      const { result } = renderHome();
      await waitFor(() => expect(result.current.activeTextModel).toMatchObject(remote));
    });

    it('returns null when no active model', () => {
      const { result } = renderHome();
      expect(result.current.activeTextModel).toBeNull();
    });
  });

  describe('activeImageModel computation with remote image model', () => {
    it('returns remote image model when active', async () => {
      useRemoteServerStore.setState({
        servers: [{
          id: 'server-1',
          name: 'Server',
          endpoint: 'https://server-1.test/v1',
          provider: 'openai-compatible',
          createdAt: new Date(0).toISOString(),
          catalog: { image: [{ id: 'img-remote-1', name: 'Vision' }] },
        } as never],
      });
      await arrangeRemoteSelection('image', 'server-1', 'img-remote-1');
      const { result } = renderHome();
      await waitFor(() => expect(result.current.activeImageModel).toEqual({
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
      }));
    });
  });

  describe('remoteTextModels / remoteImageModels filtering', () => {
    it('includes all remote models (including VL) in remoteTextModels', async () => {
      const textModel = remoteModel('t1', 's1', 'Text');
      const vlModel = remoteModel('i1', 's1', 'Vision', true);
      arrangeServer('s1', [textModel, vlModel]);
      await refreshMobileModelServices();
      const { result } = renderHome();
      // All remote models (including VL) go into remoteTextModels — remote image gen not supported
      expect(result.current.remoteTextModels).toMatchObject([textModel, vlModel]);
      expect(result.current.remoteImageModels).toEqual([]);
    });

    it('returns empty arrays when no servers', () => {
      const { result } = renderHome();
      expect(result.current.remoteTextModels).toEqual([]);
      expect(result.current.remoteImageModels).toEqual([]);
    });
  });
});
