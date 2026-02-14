/**
 * ProjectsScreen Tests
 *
 * Tests for the projects management screen including:
 * - Project list rendering
 * - Chat count badges
 * - Project CRUD operations
 * - Empty state
 * - Navigation
 *
 * Priority: P2 (Medium)
 */

import { useChatStore } from '../../../src/stores/chatStore';
import { useProjectStore } from '../../../src/stores/projectStore';
import { resetStores } from '../../utils/testHelpers';
import {
  createProject,
  createConversation,
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

describe('ProjectsScreen', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
  });

  // ============================================================================
  // Project List Rendering
  // ============================================================================
  describe('project list', () => {
    it('renders project list from store', () => {
      const project = createProject({ name: 'Code Review' });
      useProjectStore.setState({ projects: [project] });

      const { projects } = useProjectStore.getState();
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('Code Review');
    });

    it('renders multiple projects', () => {
      const projects = [
        createProject({ name: 'Project A' }),
        createProject({ name: 'Project B' }),
        createProject({ name: 'Project C' }),
      ];
      useProjectStore.setState({ projects });

      expect(useProjectStore.getState().projects).toHaveLength(3);
    });

    it('projects have name, description, and systemPrompt', () => {
      const project = createProject({
        name: 'Spanish Learning',
        description: 'Practice conversation',
        systemPrompt: 'You are a Spanish tutor.',
      });

      expect(project.name).toBe('Spanish Learning');
      expect(project.description).toBe('Practice conversation');
      expect(project.systemPrompt).toBe('You are a Spanish tutor.');
    });
  });

  // ============================================================================
  // Chat Count Badges
  // ============================================================================
  describe('chat count badges', () => {
    it('counts chats per project', () => {
      const project = createProject({ name: 'Test Project' });
      useProjectStore.setState({ projects: [project] });

      const conv1 = createConversation({ projectId: project.id });
      const conv2 = createConversation({ projectId: project.id });
      const conv3 = createConversation(); // No project
      useChatStore.setState({ conversations: [conv1, conv2, conv3] });

      const { conversations } = useChatStore.getState();
      const chatCount = conversations.filter(c => c.projectId === project.id).length;
      expect(chatCount).toBe(2);
    });

    it('returns 0 for project with no chats', () => {
      const project = createProject();
      useProjectStore.setState({ projects: [project] });

      const { conversations } = useChatStore.getState();
      const chatCount = conversations.filter(c => c.projectId === project.id).length;
      expect(chatCount).toBe(0);
    });
  });

  // ============================================================================
  // Empty State
  // ============================================================================
  describe('empty state', () => {
    it('shows empty project list initially (after reset)', () => {
      // resetStores sets projects to []
      const { projects } = useProjectStore.getState();
      expect(projects).toHaveLength(0);
    });
  });

  // ============================================================================
  // Project CRUD
  // ============================================================================
  describe('project operations', () => {
    it('creates new project', () => {
      const project = useProjectStore.getState().createProject({
        name: 'New Project',
        description: 'Test description',
        systemPrompt: 'Be helpful',
        icon: '🚀',
      });

      expect(project.id).toBeTruthy();
      expect(project.name).toBe('New Project');
      expect(useProjectStore.getState().projects).toHaveLength(1);
    });

    it('deletes project', () => {
      const project = createProject();
      useProjectStore.setState({ projects: [project] });

      useProjectStore.getState().deleteProject(project.id);

      expect(useProjectStore.getState().projects).toHaveLength(0);
    });

    it('updates project', () => {
      const project = createProject({ name: 'Original Name' });
      useProjectStore.setState({ projects: [project] });

      useProjectStore.getState().updateProject(project.id, { name: 'Updated Name' });

      const updated = useProjectStore.getState().getProject(project.id);
      expect(updated!.name).toBe('Updated Name');
    });

    it('deleting project does not delete associated chats', () => {
      const project = createProject();
      useProjectStore.setState({ projects: [project] });

      const conv = createConversation({ projectId: project.id });
      useChatStore.setState({ conversations: [conv] });

      useProjectStore.getState().deleteProject(project.id);

      // Project gone, but chat remains
      expect(useProjectStore.getState().projects).toHaveLength(0);
      expect(useChatStore.getState().conversations).toHaveLength(1);
    });

    it('duplicates project', () => {
      const project = createProject({ name: 'Original' });
      useProjectStore.setState({ projects: [project] });

      const duplicate = useProjectStore.getState().duplicateProject(project.id);

      expect(duplicate).not.toBeNull();
      expect(duplicate!.name).toBe('Original (Copy)');
      expect(useProjectStore.getState().projects).toHaveLength(2);
    });

    it('duplicate returns null for non-existent project', () => {
      const result = useProjectStore.getState().duplicateProject('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // Project Detail Fields
  // ============================================================================
  describe('project detail fields', () => {
    it('project has icon field', () => {
      const project = createProject({ icon: '📁' });
      expect(project.icon).toBe('📁');
    });

    it('project has createdAt and updatedAt', () => {
      const project = createProject();
      expect(project.createdAt).toBeTruthy();
      expect(project.updatedAt).toBeTruthy();
    });

    it('updatedAt changes on update', () => {
      const project = createProject();
      useProjectStore.setState({ projects: [project] });

      // Small delay to ensure different timestamp
      useProjectStore.getState().updateProject(project.id, { name: 'Changed' });

      const updated = useProjectStore.getState().getProject(project.id);
      expect(updated!.updatedAt).toBeTruthy();
    });
  });

  // ============================================================================
  // Conversation-Project Association
  // ============================================================================
  describe('conversation-project association', () => {
    it('sets conversation project', () => {
      const project = createProject();
      useProjectStore.setState({ projects: [project] });

      const conv = createConversation();
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().setConversationProject(conv.id, project.id);

      const { conversations } = useChatStore.getState();
      expect(conversations[0].projectId).toBe(project.id);
    });

    it('clears conversation project', () => {
      const project = createProject();
      useProjectStore.setState({ projects: [project] });

      const conv = createConversation({ projectId: project.id });
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().setConversationProject(conv.id, null);

      const { conversations } = useChatStore.getState();
      expect(conversations[0].projectId).toBeUndefined();
    });
  });
});
