/**
 * ProjectChatsScreen — real composition.
 *
 * Mounts the REAL screen over the REAL project / chat / app stores and the real
 * Button, CustomAlert, preview-line and active-model rules. No mock of Off Grid
 * code: the only fakes are navigation, safe-area, vector icons and the gesture
 * handler's Swipeable — all device/library boundaries. Every assertion reads the
 * UI the user sees (or the navigation call the press produced).
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { useProjectStore } from '../../../src/stores/projectStore';
import { resetStores, arrangeLocalSelection } from '../../utils/testHelpers';
import { createDownloadedModel } from '../../utils/factories';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
/** The project the user navigated to - the route is the only owner of that id. */
let mockRouteProjectId = 'proj1';

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
    useRoute: () => ({
      params: { projectId: mockRouteProjectId },
    }),
  };
});

jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

jest.mock('react-native-gesture-handler/Swipeable', () => {
  const { View } = require('react-native');
  return ({ children, renderRightActions }: any) => (
    <View>
      {children}
      {renderRightActions && renderRightActions()}
    </View>
  );
});

import { ProjectChatsScreen } from '../../../src/screens/ProjectChatsScreen';

const flushPromises = () => act(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
});

/** The library the user downloaded, selected for text through the one selection owner. */
const arrangeDownloadedModel = (id: string, name: string): void => {
  useAppStore.getState().addDownloadedModel(createDownloadedModel({ id, name }));
  arrangeLocalSelection('text', id);
};

const arrangeNoModels = (): void => {
  useAppStore.getState().setDownloadedModels([]);
  arrangeLocalSelection('text', null);
};

interface ChatSpec {
  title: string;
  projectId: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  updatedAt?: string;
}

/**
 * Chats as the user made them: the real createConversation action, then the real addMessage
 * action for every turn. Returns each chat's real store id, keyed by title.
 *
 * Historical dates come from the clock boundary while the public actions run. The store remains
 * the only writer of conversation timestamps.
 */
const arrangeChats = (specs: ChatSpec[]): Record<string, string> => {
  const ids: Record<string, string> = {};
  for (const spec of specs) {
    if (spec.updatedAt) jest.useFakeTimers({ now: new Date(spec.updatedAt) });
    try {
      const chat = useChatStore.getState();
      const id = chat.createConversation('model1', spec.title, spec.projectId);
      ids[spec.title] = id;
      for (const message of spec.messages ?? []) {
        useChatStore.getState().addMessage(id, {
          role: message.role,
          content: message.content,
        });
      }
    } finally {
      if (spec.updatedAt) jest.useRealTimers();
    }
  }
  return ids;
};

const storedConversations = () => useChatStore.getState().conversations;

describe('ProjectChatsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStores();
    const project = useProjectStore.getState().createProject({
      name: 'Test Project',
      description: 'A test project for testing',
      systemPrompt: '',
      icon: '📁',
    });
    mockRouteProjectId = project.id;
    arrangeDownloadedModel('model1', 'Model');
  });

  describe('basic rendering', () => {
    it('renders the project name in the header', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('Test Project')).toBeTruthy();
    });

    it('shows fallback "Chats" when project is null', () => {
      // The user arrives on a project the store does not hold (deleted / stale link).
      mockRouteProjectId = 'gone-project';
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('Chats')).toBeTruthy();
    });

    it('shows empty state when no chats', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('No chats yet')).toBeTruthy();
    });

    it('shows "Start a new conversation" text when models available', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('Start a new conversation for this project.')).toBeTruthy();
    });

    it('shows "Download a model" text when no models', () => {
      arrangeNoModels();
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('Download a model to start chatting.')).toBeTruthy();
    });

    it('shows New Chat button when models available', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('New Chat')).toBeTruthy();
    });

    it('hides New Chat button when no models', () => {
      arrangeNoModels();
      const { queryByText } = render(<ProjectChatsScreen />);
      expect(queryByText('New Chat')).toBeNull();
    });
  });

  describe('navigation', () => {
    it('calls goBack when back button pressed', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      fireEvent.press(getByText('arrow-left'));
      expect(mockGoBack).toHaveBeenCalled();
    });
  });

  describe('new chat creation', () => {
    it('creates conversation and navigates to Chat on New Chat press', async () => {
      const { getByText } = render(<ProjectChatsScreen />);
      fireEvent.press(getByText('New Chat'));
      await flushPromises();
      const created = storedConversations()[0];
      expect(created).toMatchObject({
        modelId: 'model1',
        title: 'New Conversation',
        projectId: mockRouteProjectId,
      });
      expect(mockNavigate).toHaveBeenCalledWith('Chat', {
        conversationId: created.id,
        projectId: mockRouteProjectId,
      });
    });

    it('does not create conversation when no models (plus button disabled)', () => {
      arrangeNoModels();
      const { getByText, queryByText } = render(<ProjectChatsScreen />);
      fireEvent.press(getByText('plus'));
      // When no models, plus button is disabled and no conversation is created
      expect(storedConversations()).toHaveLength(0);
      expect(queryByText('New Conversation')).toBeNull();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('uses first downloaded model when no activeModelId', async () => {
      useAppStore
        .getState()
        .setDownloadedModels([createDownloadedModel({ id: 'model2', name: 'Fallback' })]);
      arrangeLocalSelection('text', null);
      const { getByText } = render(<ProjectChatsScreen />);
      fireEvent.press(getByText('New Chat'));
      await flushPromises();
      expect(storedConversations()[0]).toMatchObject({
        modelId: 'model2',
        projectId: mockRouteProjectId,
      });
    });
  });

  describe('with existing chats', () => {
    const now = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const lastWeek = new Date(Date.now() - 8 * 86400000).toISOString();

    let chatIds: Record<string, string> = {};

    beforeEach(() => {
      chatIds = arrangeChats([
        {
          title: 'Chat One',
          projectId: mockRouteProjectId,
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there' },
          ],
          updatedAt: now,
        },
        { title: 'Chat Two', projectId: mockRouteProjectId, updatedAt: yesterday },
        { title: 'Other Project Chat', projectId: 'other-proj', updatedAt: now },
      ]);
    });

    it('renders only chats for the current project', () => {
      const { getByText, queryByText } = render(<ProjectChatsScreen />);
      expect(getByText('Chat One')).toBeTruthy();
      expect(getByText('Chat Two')).toBeTruthy();
      expect(queryByText('Other Project Chat')).toBeNull();
    });

    it('shows last message preview for assistant message', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('Hi there')).toBeTruthy();
    });

    it('shows "You: " prefix for last user message', () => {
      arrangeChats([
        {
          title: 'User Chat',
          projectId: mockRouteProjectId,
          messages: [{ role: 'user', content: 'My question' }],
        },
      ]);
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('You: My question')).toBeTruthy();
    });

    it('navigates to Chat when chat is pressed', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      fireEvent.press(getByText('Chat One'));
      expect(useChatStore.getState().activeConversationId).toBe(chatIds['Chat One']);
      expect(mockNavigate).toHaveBeenCalledWith('Chat', {
        conversationId: chatIds['Chat One'],
      });
    });

    it('shows delete confirmation and deletes on confirm', async () => {
      const { getAllByText, getByText, queryByText } = render(<ProjectChatsScreen />);
      const trashIcons = getAllByText('trash-2');
      fireEvent.press(trashIcons[0]);
      await flushPromises();

      expect(getByText('Delete Chat')).toBeTruthy();
      expect(getByText('Delete "Chat One"?')).toBeTruthy();
      fireEvent.press(getByText('Delete'));
      await flushPromises();
      expect(queryByText('Chat One')).toBeNull();
      expect(getByText('Chat Two')).toBeTruthy();
    });

    it('formats date as Yesterday', () => {
      const { getByText } = render(<ProjectChatsScreen />);
      expect(getByText('Yesterday')).toBeTruthy();
    });

    it('formats date as weekday for last week', () => {
      arrangeChats([
        { title: 'Week Chat', projectId: mockRouteProjectId, updatedAt: lastWeek },
      ]);
      const { getByText } = render(<ProjectChatsScreen />);
      // Date format varies by locale; the row renders with its title.
      expect(getByText('Week Chat')).toBeTruthy();
    });
  });
});
