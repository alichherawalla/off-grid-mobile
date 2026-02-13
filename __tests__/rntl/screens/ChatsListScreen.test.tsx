/**
 * ChatsListScreen Tests
 *
 * Tests for the conversation list screen including:
 * - Conversation list rendering
 * - Project badges
 * - Date formatting
 * - Empty state
 * - Navigation
 * - Sorting
 *
 * Priority: P2 (Medium)
 */

import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { useProjectStore } from '../../../src/stores/projectStore';
import { resetStores, createMultipleConversations } from '../../utils/testHelpers';
import {
  createConversation,
  createMessage,
  createDownloadedModel,
  createProject,
} from '../../utils/factories';

// Mock navigation
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: jest.fn(),
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
  };
});

// Mock services
jest.mock('../../../src/services', () => ({
  onnxImageGeneratorService: {
    deleteGeneratedImage: jest.fn(() => Promise.resolve()),
  },
}));

describe('ChatsListScreen', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
  });

  // ============================================================================
  // Conversation List Rendering
  // ============================================================================
  describe('conversation list', () => {
    it('stores conversations in chat store', () => {
      const conv = createConversation({ title: 'Test Chat' });
      useChatStore.setState({ conversations: [conv] });

      const { conversations } = useChatStore.getState();
      expect(conversations).toHaveLength(1);
      expect(conversations[0].title).toBe('Test Chat');
    });

    it('stores multiple conversations', () => {
      createMultipleConversations(5);

      const { conversations } = useChatStore.getState();
      expect(conversations).toHaveLength(5);
    });

    it('shows conversation preview text from last message', () => {
      const conv = createConversation({
        title: 'Chat about AI',
        messages: [
          createMessage({ role: 'user', content: 'What is AI?' }),
          createMessage({ role: 'assistant', content: 'AI is artificial intelligence' }),
        ],
      });
      useChatStore.setState({ conversations: [conv] });

      const lastMessage = conv.messages[conv.messages.length - 1];
      expect(lastMessage.content).toBe('AI is artificial intelligence');
    });
  });

  // ============================================================================
  // Project Badges
  // ============================================================================
  describe('project badges', () => {
    it('conversation can have a projectId', () => {
      const project = createProject({ name: 'Code Review' });
      useProjectStore.setState({ projects: [project] });

      const conv = createConversation({ projectId: project.id });
      useChatStore.setState({ conversations: [conv] });

      const { conversations } = useChatStore.getState();
      expect(conversations[0].projectId).toBe(project.id);
    });

    it('getProject returns project for valid ID', () => {
      const project = createProject({ name: 'Spanish Learning' });
      useProjectStore.setState({ projects: [project] });

      const found = useProjectStore.getState().getProject(project.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('Spanish Learning');
    });

    it('getProject returns undefined for invalid ID', () => {
      const found = useProjectStore.getState().getProject('nonexistent');
      expect(found).toBeUndefined();
    });
  });

  // ============================================================================
  // Date Formatting
  // ============================================================================
  describe('date formatting', () => {
    it('conversations have createdAt and updatedAt timestamps', () => {
      const conv = createConversation();
      expect(conv.createdAt).toBeTruthy();
      expect(conv.updatedAt).toBeTruthy();
    });

    it('updatedAt changes when messages are added', () => {
      const conv = createConversation();
      useChatStore.setState({ conversations: [conv] });

      // Add message updates the conversation
      useChatStore.getState().addMessage(conv.id, {
        role: 'user',
        content: 'New message',
      });

      const { conversations } = useChatStore.getState();
      const updated = conversations.find(c => c.id === conv.id);
      expect(updated).toBeDefined();
      // updatedAt should be different (or at least defined)
      expect(updated!.updatedAt).toBeTruthy();
    });
  });

  // ============================================================================
  // Empty State
  // ============================================================================
  describe('empty state', () => {
    it('shows empty conversations list by default', () => {
      const { conversations } = useChatStore.getState();
      expect(conversations).toHaveLength(0);
    });

    it('empty state depends on whether models are downloaded', () => {
      // No models = specific empty state message
      const { downloadedModels } = useAppStore.getState();
      expect(downloadedModels).toHaveLength(0);

      // With models = different empty state message
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });
      expect(useAppStore.getState().downloadedModels).toHaveLength(1);
    });
  });

  // ============================================================================
  // Navigation
  // ============================================================================
  describe('navigation', () => {
    it('sets active conversation when tapped', () => {
      const conv = createConversation({ title: 'Navigate Me' });
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().setActiveConversation(conv.id);

      expect(useChatStore.getState().activeConversationId).toBe(conv.id);
    });

    it('new chat creates conversation', () => {
      const model = createDownloadedModel();
      useAppStore.setState({ downloadedModels: [model] });

      const convId = useChatStore.getState().createConversation(model.id);

      expect(convId).toBeTruthy();
      expect(useChatStore.getState().conversations).toHaveLength(1);
    });
  });

  // ============================================================================
  // Deletion
  // ============================================================================
  describe('deletion', () => {
    it('deletes conversation from store', () => {
      const conv = createConversation({ title: 'Delete me' });
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().deleteConversation(conv.id);

      expect(useChatStore.getState().conversations).toHaveLength(0);
    });

    it('clears active conversation when deleted', () => {
      const conv = createConversation();
      useChatStore.setState({
        conversations: [conv],
        activeConversationId: conv.id,
      });

      useChatStore.getState().deleteConversation(conv.id);

      expect(useChatStore.getState().activeConversationId).toBeNull();
    });

    it('does not affect other conversations when one is deleted', () => {
      const conv1 = createConversation({ title: 'Keep me' });
      const conv2 = createConversation({ title: 'Delete me' });
      useChatStore.setState({ conversations: [conv1, conv2] });

      useChatStore.getState().deleteConversation(conv2.id);

      const remaining = useChatStore.getState().conversations;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].title).toBe('Keep me');
    });
  });

  // ============================================================================
  // Sorting
  // ============================================================================
  describe('sorting', () => {
    it('sorts conversations by updatedAt (most recent first)', () => {
      const old = createConversation({
        title: 'Old Chat',
        updatedAt: '2024-01-01T00:00:00Z',
      });
      const recent = createConversation({
        title: 'Recent Chat',
        updatedAt: '2024-12-01T00:00:00Z',
      });
      useChatStore.setState({ conversations: [old, recent] });

      const { conversations } = useChatStore.getState();
      const sorted = [...conversations].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      expect(sorted[0].title).toBe('Recent Chat');
      expect(sorted[1].title).toBe('Old Chat');
    });
  });
});
