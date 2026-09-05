/**
 * ProjectDetailScreen Tests
 *
 * Tests for the project detail screen including:
 * - Project name and description display
 * - Empty chats state
 * - Back button navigation
 * - Edit project navigation
 * - Delete project flow
 * - Conversation list with project chats
 * - New chat creation
 * - Delete chat flow
 */

import React from 'react';
import { modelsFailureMessage } from '@offgrid/application';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
let mockRouteProjectId = 'proj1';
let mockUseRealNavigation = false;

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => mockUseRealNavigation
      ? actual.useNavigation()
      : {
          navigate: mockNavigate,
          goBack: mockGoBack,
          setOptions: jest.fn(),
          addListener: jest.fn(() => jest.fn()),
        },
    useRoute: () => mockUseRealNavigation
      ? actual.useRoute()
      : { params: { projectId: mockRouteProjectId } },
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
  };
});

// The library's SHIPPED jest mock, not a hand-rolled SafeAreaView. This file's own stub exported only
// that one component, so anything in the tree reaching for useSafeAreaInsets (a bottom sheet, for
// instance) took the whole suite down with "is not a function" - the same trap jest.setup.ts already
// documents for the navigation container.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(() => Promise.resolve([{
    uri: 'file:///mock/doc.pdf',
    name: 'doc.pdf',
    size: 5000,
  }])),
  keepLocalCopy: jest.fn(() => Promise.resolve([{ status: 'success', localUri: 'file:///mock/doc.pdf' }])),
}));

jest.mock('react-native-gesture-handler/Swipeable', () => {
  const { View } = require('react-native');
  return ({ children, renderRightActions }: any) => (
    <View>
      {children}
      {renderRightActions && renderRightActions()}
    </View>
  );
});

describe('ProjectDetailScreen basic rendering (real composition)', () => {
  let fixture: import('../../harness/mobileApplicationFixture').MobileApplicationFixture;
  let rtl: typeof import('@testing-library/react-native');
  let RealReact: typeof React;
  let RealProjectDetailScreen: typeof import('../../../src/screens/ProjectDetailScreen').ProjectDetailScreen;
  let RealProjectsScreen: typeof import('../../../src/screens/ProjectsScreen').ProjectsScreen;
  let RealProjectEditScreen: typeof import('../../../src/screens/ProjectEditScreen').ProjectEditScreen;
  let RealChatScreen: typeof import('../../../src/screens/ChatScreen').ChatScreen;
  let originalFetch: typeof global.fetch;
  const serverIds: string[] = [];
  let nativeBoundary: import('../../harness/nativeBoundary').NativeBoundary;

  beforeAll(async () => {
    for (const path of [
      '../../../src/stores',
      '../../../src/hooks/useActiveMobileModel',
      '../../../src/hooks/useMobileModelInventory',
      '../../../src/components',
      '../../../src/components/Button',
      '../../../src/components/CustomAlert',
      '../../../src/components/AnimatedEntry',
    ]) jest.unmock(path);
    const { installNativeBoundary, requireRTL } =
      require('../../harness/nativeBoundary') as typeof import('../../harness/nativeBoundary');
    nativeBoundary = installNativeBoundary({ download: true, fs: true, llama: true });
    nativeBoundary.fs!.seedFile(
      `${nativeBoundary.fs!.DocumentDirectoryPath}/all-MiniLM-L6-v2-Q8_0.gguf`,
      4,
    );
    const { doMockRealSqlite } =
      require('../../harness/sqliteFake') as typeof import('../../harness/sqliteFake');
    doMockRealSqlite();
    originalFetch = global.fetch;
    rtl = requireRTL();
    RealReact = require('react');
    ({ ProjectDetailScreen: RealProjectDetailScreen } = require('../../../src/screens/ProjectDetailScreen'));
    ({ ProjectsScreen: RealProjectsScreen } = require('../../../src/screens/ProjectsScreen'));
    ({ ProjectEditScreen: RealProjectEditScreen } = require('../../../src/screens/ProjectEditScreen'));
    ({ ChatScreen: RealChatScreen } = require('../../../src/screens/ChatScreen'));
    fixture = await (require('../../harness/mobileApplicationFixture') as
      typeof import('../../harness/mobileApplicationFixture')).startMobileApplicationFixture();
  });

  afterEach(async () => {
    jest.useRealTimers();
    rtl.cleanup();
    for (const serverId of serverIds.splice(0)) {
      await fixture.application.models.removeRemoteServer(serverId);
    }
    global.fetch = originalFetch;
    mockUseRealNavigation = false;
    mockGoBack.mockClear();
    mockNavigate.mockClear();
  });
  afterAll(async () => fixture.dispose());

  const createProject = (
    description: string | null = 'A test project description',
  ) => {
    const { useProjectStore } =
      require('../../../src/stores/projectStore') as typeof import('../../../src/stores/projectStore');
    const project = useProjectStore.getState().createProject({
      name: 'Test Project',
      description: description as string,
      systemPrompt: 'Be helpful',
      icon: '#10B981',
    });
    mockRouteProjectId = project.id;
    return project;
  };

  const renderProject = (
    description: string | null = 'A test project description',
  ) => {
    createProject(description);
    return rtl.render(RealReact.createElement(RealProjectDetailScreen));
  };

  const renderMissingProject = () => {
    mockRouteProjectId = 'project-that-does-not-exist';
    return rtl.render(RealReact.createElement(RealProjectDetailScreen));
  };

  const renderProjectHistory = (projectId: string) => {
    mockUseRealNavigation = true;
    const { NavigationContainer } = require('@react-navigation/native') as
      typeof import('@react-navigation/native');
    const { createNativeStackNavigator } =
      require('@react-navigation/native-stack') as typeof import('@react-navigation/native-stack');
    const Stack = createNativeStackNavigator();
    return rtl.render(
      <NavigationContainer
        initialState={{
          index: 1,
          routes: [
            { name: 'Projects' },
            { name: 'ProjectDetail', params: { projectId } },
          ],
        }}
      >
        <Stack.Navigator>
          <Stack.Screen name="Projects" component={RealProjectsScreen} />
          <Stack.Screen name="ProjectDetail" component={RealProjectDetailScreen} />
          <Stack.Screen name="ProjectEdit" component={RealProjectEditScreen} />
          <Stack.Screen name="Chat" component={RealChatScreen} />
        </Stack.Navigator>
      </NavigationContainer>,
    );
  };

  const renderProjectWithConversation = (title: string) => {
    const view = renderProject();
    const { useChatStore } =
      require('../../../src/stores/chatStore') as typeof import('../../../src/stores/chatStore');
    let conversationId = '';
    rtl.act(() => {
      conversationId = useChatStore.getState().createConversation(
        'external-model',
        title,
        mockRouteProjectId,
      );
    });
    return { view, conversationId, useChatStore };
  };

  const renderProjectWithActiveRemoteText = async (realNavigation = false) => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({
      object: 'list', data: [{ id: 'Llama-3.2-3B' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const saved = await fixture.application.models.saveRemoteServer({
      name: 'Project chat server',
      endpoint: 'http://192.168.1.3:8000/v1',
      provider: 'openai-compatible',
    });
    if (!saved.ok) throw new Error(modelsFailureMessage(saved.failure));
    serverIds.push(saved.value.id);
    const discovered = await fixture.application.models.discoverRemoteServers(saved.value.id);
    if (!discovered.ok) throw new Error(modelsFailureMessage(discovered.failure));
    const activated = await fixture.application.models.activateOnServer(
      saved.value.id, 'text', 'Llama-3.2-3B',
    );
    if (!activated.ok) throw new Error(modelsFailureMessage(activated.failure));
    const project = createProject();
    return realNavigation
      ? renderProjectHistory(project.id)
      : rtl.render(RealReact.createElement(RealProjectDetailScreen));
  };

  const renderProjectWithRemoteInventory = async (realNavigation = false) => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({
      siblings: [{
        rfilename: 'inventory.Q4_K_M.gguf',
        lfs: { size: 1024 },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const { startModelDownload } =
      require('../../../src/services/startModelDownload') as typeof import('../../../src/services/startModelDownload');
    await startModelDownload('author/inventory', {
      name: 'inventory.Q4_K_M.gguf',
      size: 1024,
      quantization: 'Q4_K_M',
      downloadUrl: 'https://huggingface.co/author/inventory/resolve/main/inventory.Q4_K_M.gguf',
    });
    const transfer = nativeBoundary.download!.active()[0];
    nativeBoundary.download!.complete(transfer.downloadId);
    await rtl.waitFor(async () => {
      const snapshot = await fixture.refreshModels();
      expect(snapshot.inventory.some(model => model.id.includes('author/inventory'))).toBe(true);
    });
    const project = createProject();
    return realNavigation
      ? renderProjectHistory(project.id)
      : rtl.render(RealReact.createElement(RealProjectDetailScreen));
  };

  const renderProjectWithDocument = async (fileName: string, size: number) => {
    const view = renderProject();
    const path = `${nativeBoundary.fs!.DocumentDirectoryPath}/${fileName}`;
    nativeBoundary.fs!.seedFile(path, size);
    const added = await fixture.application.rag.addDocument({
      projectId: mockRouteProjectId,
      path,
      fileName,
      size,
    });
    if (!added.ok) throw new Error(JSON.stringify(added.failure));
    return view;
  };

  const renderDatedConversation = (daysAgo: number) => {
    createProject();
    const past = new Date();
    past.setDate(past.getDate() - daysAgo);
    jest.useFakeTimers({ now: past });
    const { useChatStore } =
      require('../../../src/stores/chatStore') as typeof import('../../../src/stores/chatStore');
    useChatStore.getState().createConversation(
      'external-model', `Chat ${daysAgo}d ago`, mockRouteProjectId,
    );
    jest.useRealTimers();
    return {
      past,
      view: rtl.render(RealReact.createElement(RealProjectDetailScreen)),
    };
  };

  it('renders project name', () => {
    expect(renderProject().getByText('Test Project')).toBeTruthy();
  });

  it('does not show project description in header', () => {
    expect(renderProject().queryByText('A test project description')).toBeNull();
  });

  it('shows project initial in icon', () => {
    expect(renderProject().getByText('T')).toBeTruthy();
  });

  it('hides the chat count when the project has no chats', () => {
    expect(renderProject().queryByText('0 chats')).toBeNull();
  });

  it('shows Chats section title', () => {
    expect(renderProject().getByText('Chats')).toBeTruthy();
  });

  it('shows Delete Project button', () => {
    expect(renderProject().getByText('Delete Project')).toBeTruthy();
  });

  it('back button returns to the real Projects screen', async () => {
    const project = createProject();
    const view = renderProjectHistory(project.id);
    expect(await view.findByTestId('project-detail-screen')).toBeTruthy();

    rtl.fireEvent.press(view.getByLabelText('Back'));

    expect(await view.findByTestId('projects-screen')).toBeTruthy();
    expect(view.queryByTestId('project-detail-screen')).toBeNull();
  });

  it('edit button opens the real project editor', async () => {
    const project = createProject();
    const view = renderProjectHistory(project.id);
    rtl.fireEvent.press(view.getByText('edit-2'));
    expect(await view.findByTestId('project-edit-screen')).toBeTruthy();
    expect(view.queryByTestId('project-detail-screen')).toBeNull();
  });

  it('opens the selected project in the real editor', async () => {
    const project = createProject();
    const view = renderProjectHistory(project.id);

    rtl.fireEvent.press(await view.findByText('edit-2'));

    const name = await view.findByTestId('project-edit-name');
    expect(name.props.value).toBe('Test Project');
    expect(view.getByTestId('project-edit-system-prompt').props.value).toBe('Be helpful');
  });

  it('shows error when project is null', () => {
    expect(renderMissingProject().getByText('Project not found')).toBeTruthy();
  });

  it('shows "Go back" link when project not found', () => {
    expect(renderMissingProject().getByText('Go back')).toBeTruthy();
  });

  it('returns to the real Projects screen from a missing project', async () => {
    const view = renderProjectHistory('project-that-does-not-exist');
    expect(await view.findByText('Project not found')).toBeTruthy();

    rtl.fireEvent.press(view.getByText('Go back'));

    expect(await view.findByTestId('projects-screen')).toBeTruthy();
    expect(view.queryByText('Project not found')).toBeNull();
  });

  it('shows confirmation alert when Delete Project is pressed', () => {
    const view = renderProject();
    rtl.fireEvent.press(view.getByText('Delete Project'));
    expect(view.getAllByText('Delete Project')).toHaveLength(2);
  });

  it('includes project name in confirmation message', () => {
    const view = renderProject();
    rtl.fireEvent.press(view.getByText('Delete Project'));
    expect(view.getByText(/Delete "Test Project"\?/)).toBeTruthy();
  });

  it('deletes project and returns to the real Projects screen when confirmed', async () => {
    const project = createProject();
    const view = renderProjectHistory(project.id);
    expect(await view.findByTestId('project-detail-screen')).toBeTruthy();
    rtl.fireEvent.press(view.getByText('Delete Project'));
    rtl.fireEvent.press(view.getByText('Delete', { exact: true }));
    const { useProjectStore } =
      require('../../../src/stores/projectStore') as typeof import('../../../src/stores/projectStore');
    await rtl.waitFor(() => expect(useProjectStore.getState().getProject(project.id)).toBeUndefined());
    expect(await view.findByTestId('projects-screen')).toBeTruthy();
    expect(view.queryByTestId(`project-row-${project.id}`)).toBeNull();
  });

  it('does not delete project when cancelled', () => {
    const view = renderProject();
    const projectId = mockRouteProjectId;
    rtl.fireEvent.press(view.getByText('Delete Project'));
    rtl.fireEvent.press(view.getByText('Cancel'));
    const { useProjectStore } =
      require('../../../src/stores/projectStore') as typeof import('../../../src/stores/projectStore');
    expect(useProjectStore.getState().getProject(projectId)).toBeTruthy();
    expect(view.queryByText(/Delete "Test Project"\?/)).toBeNull();
    expect(view.getByTestId('project-detail-screen')).toBeTruthy();
  });

  it('shows confirmation alert when delete swipe action is pressed', () => {
    const { view } = renderProjectWithConversation('Delete Me Chat');
    expect(view.getByText('Delete Me Chat')).toBeTruthy();
    rtl.fireEvent.press(view.getAllByText('trash-2')[0]);
    expect(view.getByText('Delete Chat')).toBeTruthy();
  });

  it('deletes conversation when confirmed', async () => {
    const { view, conversationId, useChatStore } =
      renderProjectWithConversation('Delete Me');
    rtl.fireEvent.press(view.getAllByText('trash-2')[0]);
    rtl.fireEvent.press(view.getByText('Delete', { exact: true }));
    await rtl.waitFor(() => expect(
      useChatStore.getState().conversations.some(item => item.id === conversationId),
    ).toBe(false));
    expect(view.queryByText('Delete Me')).toBeNull();
  });

  it('shows Knowledge Base section title', () => {
    expect(renderProject().getByText('Knowledge Base')).toBeTruthy();
  });

  it('shows empty state when no documents', async () => {
    const view = renderProject();
    expect(await view.findByText('No documents added')).toBeTruthy();
  });

  it('shows Add button', () => {
    expect(renderProject().getByText('Add')).toBeTruthy();
  });

  it('shows conversations for this project', () => {
    const { view } = renderProjectWithConversation('Project Chat 1');
    expect(view.getByText('Project Chat 1')).toBeTruthy();
  });

  it('does not show conversations from other projects', () => {
    const view = renderProject();
    const currentProjectId = mockRouteProjectId;
    const { useProjectStore } =
      require('../../../src/stores/projectStore') as typeof import('../../../src/stores/projectStore');
    const other = useProjectStore.getState().createProject({
      name: 'Other Project', description: '', systemPrompt: '', icon: '#000000',
    });
    const { useChatStore } =
      require('../../../src/stores/chatStore') as typeof import('../../../src/stores/chatStore');
    rtl.act(() => {
      useChatStore.getState().createConversation('external-model', 'Other Project Chat', other.id);
    });
    mockRouteProjectId = currentProjectId;
    expect(view.queryByText('Other Project Chat')).toBeNull();
    expect(view.getByText('No chats yet')).toBeTruthy();
  });

  it('shows correct chat count in stats', () => {
    const { view, useChatStore } = renderProjectWithConversation('Chat 1');
    rtl.act(() => {
      useChatStore.getState().createConversation(
        'external-model', 'Chat 2', mockRouteProjectId,
      );
    });
    expect(view.getByText('2')).toBeTruthy();
  });

  it('opens the real Chat screen when a conversation is tapped', async () => {
    const project = createProject();
    const { useChatStore } =
      require('../../../src/stores/chatStore') as typeof import('../../../src/stores/chatStore');
    const conversationId = useChatStore.getState().createConversation(
      'external-model', 'Tappable Chat', project.id,
    );
    const view = renderProjectHistory(project.id);
    rtl.fireEvent.press(view.getByText('Tappable Chat'));
    expect(useChatStore.getState().getActiveConversation()?.id).toBe(conversationId);
    expect(await view.findByText('New Chat')).toBeTruthy();
    expect(view.getByText('No Model Selected')).toBeTruthy();
  });

  it('shows last message preview in conversation item', () => {
    const { view, conversationId, useChatStore } =
      renderProjectWithConversation('Chat With Preview');
    rtl.act(() => {
      useChatStore.getState().addMessage(conversationId, {
        role: 'user', content: 'Hello there',
      });
      useChatStore.getState().addMessage(conversationId, {
        role: 'assistant', content: 'Hi! How can I help?',
      });
    });
    expect(view.getByText('Hi! How can I help?')).toBeTruthy();
  });

  it('shows "You: " prefix for user messages in preview', () => {
    const { view, conversationId, useChatStore } =
      renderProjectWithConversation('Chat With User Preview');
    rtl.act(() => {
      useChatStore.getState().addMessage(conversationId, {
        role: 'user', content: 'Last user message',
      });
    });
    expect(view.getByText(/You: Last user message/)).toBeTruthy();
  });

  it('shows empty chats message', () => {
    expect(renderProject().getByText('No chats yet')).toBeTruthy();
  });

  it('hides "Start a Chat" button when no models downloaded', () => {
    expect(renderProject().queryByText('Start a Chat')).toBeNull();
  });

  it('disables New button when no models available', () => {
    expect(renderProject().getByRole('button', {
      name: 'New',
      disabled: true,
    })).toBeTruthy();
  });

  it('shows "Start a Chat" button when models available', async () => {
    const view = await renderProjectWithActiveRemoteText();
    expect(view.getByText('Start a Chat')).toBeTruthy();
  });

  it('opens the real project chat when "New" is pressed', async () => {
    const view = await renderProjectWithActiveRemoteText(true);
    const selectedModelId = fixture.application.models.snapshot().active.text
      ?.model?.id;
    expect(selectedModelId).toBeTruthy();
    rtl.fireEvent.press(view.getByRole('button', { name: 'New' }));
    const { useChatStore } =
      require('../../../src/stores/chatStore') as typeof import('../../../src/stores/chatStore');
    const conversation = useChatStore.getState().conversations.find(
      item => item.projectId === mockRouteProjectId,
    );
    expect(conversation).toBeTruthy();
    expect(conversation!.modelId).toBe(selectedModelId);
    expect(await view.findByTestId('chat-screen')).toBeTruthy();
    expect(view.queryByTestId('project-detail-screen')).toBeNull();
  });

  it('starts a real Chat screen when the selected text route is available', async () => {
    const view = await renderProjectWithActiveRemoteText(true);
    rtl.fireEvent.press(await view.findByText('Start a Chat'));
    expect(await view.findByTestId('chat-screen')).toBeTruthy();
    expect(view.queryByTestId('project-detail-screen')).toBeNull();
  });

  it('shows documents when loaded', async () => {
    const view = await renderProjectWithDocument('readme.txt', 2048);
    expect(await view.findByText('readme.txt')).toBeTruthy();
  });

  it('shows formatted file size', async () => {
    const view = await renderProjectWithDocument('big.txt', 1048576);
    expect(await view.findByText('1.0 MB')).toBeTruthy();
  });

  it('shows "Yesterday" for conversations updated 1 day ago (line 116)', () => {
    expect(renderDatedConversation(1).view.getByText('Yesterday')).toBeTruthy();
  });

  it('shows weekday name for conversations updated 3 days ago (line 118)', () => {
    const { view, past } = renderDatedConversation(3);
    expect(view.getByText(past.toLocaleDateString(undefined, {
      weekday: 'short',
    }))).toBeTruthy();
  });

  it('shows month/day for conversations updated 8 days ago (line 120)', () => {
    const { view, past } = renderDatedConversation(8);
    expect(view.getByText(past.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
    }))).toBeTruthy();
  });

  it('does not render description when empty', () => {
    expect(renderProject('').queryByText('A test project description')).toBeNull();
  });

  it('does not render description when null', () => {
    expect(renderProject(null).queryByText('A test project description')).toBeNull();
  });

  it('Add button is enabled before any indexing', () => {
    expect(renderProject().getByRole('button', {
      name: 'Add', disabled: false,
    })).toBeTruthy();
  });

  it('File count updates after each file is indexed', async () => {
    const view = renderProject();
    const path = `${nativeBoundary.fs!.DocumentDirectoryPath}/doc1.txt`;
    nativeBoundary.fs!.seedFile(path, 1000);
    const DocumentPicker = require('@react-native-documents/picker') as {
      pick: jest.Mock; keepLocalCopy: jest.Mock;
    };
    DocumentPicker.pick.mockResolvedValue([{
      uri: 'content://external/doc1.txt', name: 'doc1.txt', size: 1000,
    }]);
    DocumentPicker.keepLocalCopy.mockResolvedValue([{
      status: 'success', localUri: `file://${path}`,
    }]);
    rtl.fireEvent.press(view.getByTestId('kb-add-document'));
    expect(await view.findByText('doc1.txt')).toBeTruthy();
    expect(view.getByLabelText('Knowledge Base has 1 documents')).toBeTruthy();
  });

  it('starts a chat when only an inventory model is available', async () => {
    const view = await renderProjectWithRemoteInventory(true);
    const inventoryModelId = fixture.application.models.snapshot().inventory
      .find(model => model.modality === 'text')?.id;
    expect(inventoryModelId).toBeTruthy();
    rtl.fireEvent.press(view.getByText('Start a Chat'));
    const { useChatStore } =
      require('../../../src/stores/chatStore') as typeof import('../../../src/stores/chatStore');
    const conversation = useChatStore.getState().conversations.find(
      item => item.projectId === mockRouteProjectId,
    );
    expect(conversation).toBeTruthy();
    expect(conversation!.modelId).toBe(inventoryModelId);
    expect(await view.findByText('New Chat')).toBeTruthy();
    expect(view.getByText('No Model Selected')).toBeTruthy();
  });

  it('disables Add while indexing and re-enables it after completion', async () => {
    const view = renderProject();
    const path = `${nativeBoundary.fs!.DocumentDirectoryPath}/held.txt`;
    nativeBoundary.fs!.seedFile(path, 12);
    const DocumentPicker = require('@react-native-documents/picker') as {
      pick: jest.Mock; keepLocalCopy: jest.Mock;
    };
    DocumentPicker.pick.mockResolvedValue([{
      uri: 'content://external/held.txt', name: 'held.txt', size: 12,
    }]);
    DocumentPicker.keepLocalCopy.mockResolvedValue([{
      status: 'success', localUri: `file://${path}`,
    }]);
    const RNFS = require('react-native-fs') as { readFile: jest.Mock };
    const previousReadFile = RNFS.readFile.getMockImplementation()!;
    let releaseRead!: (value: string) => void;
    const heldRead = new Promise<string>(resolve => { releaseRead = resolve; });
    RNFS.readFile.mockImplementation((readPath: string, ...args: unknown[]) =>
      readPath === path ? heldRead : previousReadFile(readPath, ...args));
    try {
      rtl.fireEvent.press(view.getByTestId('kb-add-document'));
      expect(await view.findByText('Indexing held.txt...')).toBeTruthy();
      expect(view.getByRole('button', { name: 'Add', disabled: true })).toBeTruthy();
      releaseRead('held content');
      expect(await view.findByText('held.txt')).toBeTruthy();
      expect(view.getByRole('button', { name: 'Add', disabled: false })).toBeTruthy();
    } finally {
      RNFS.readFile.mockImplementation(previousReadFile);
    }
  });

  it('indexes every selected file in a multi-file import', async () => {
    const view = renderProject();
    const base = nativeBoundary.fs!.DocumentDirectoryPath;
    nativeBoundary.fs!.seedFile(`${base}/file1.txt`, 1000);
    nativeBoundary.fs!.seedFile(`${base}/file2.txt`, 2000);
    const DocumentPicker = require('@react-native-documents/picker') as {
      pick: jest.Mock; keepLocalCopy: jest.Mock;
    };
    DocumentPicker.pick.mockResolvedValue([
      { uri: 'content://external/file1.txt', name: 'file1.txt', size: 1000 },
      { uri: 'content://external/file2.txt', name: 'file2.txt', size: 2000 },
    ]);
    DocumentPicker.keepLocalCopy
      .mockResolvedValueOnce([{ status: 'success', localUri: `file://${base}/file1.txt` }])
      .mockResolvedValueOnce([{ status: 'success', localUri: `file://${base}/file2.txt` }]);
    rtl.fireEvent.press(view.getByTestId('kb-add-document'));
    expect(await view.findByText('file1.txt')).toBeTruthy();
    expect(await view.findByText('file2.txt')).toBeTruthy();
    expect(view.getByLabelText('Knowledge Base has 2 documents')).toBeTruthy();
  });
});
