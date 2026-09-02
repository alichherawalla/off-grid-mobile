/**
 * RED-FLOW (UI, rendered) — Q11 at the pixel: after a context-full "New chat", the continuation chat is
 * MISSING from its project's chat list.
 *
 * Real startGenerationFn (a llama that throws context-overflow) raises the context-full alert; pressing its
 * "New chat" button runs the REAL chatStore.createConversation. Then the REAL ProjectChatsScreen is mounted
 * over the REAL stores. RED: the "New Conversation" continuation never appears under "Research" because the
 * New-chat handler calls createConversation(modelId) with NO projectId → the chat is unfiled. The original
 * filed chat IS shown first (load-proof that the screen rendered + the project filter works).
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { makeGenDeps } from '../../harness/genDeps';
import { createDownloadedModel, createProject } from '../../utils/factories';

let mockRouteProjectId = 'proj-1';
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
  useRoute: () => ({ params: { projectId: mockRouteProjectId } }),
  useFocusEffect: jest.fn(),
  useIsFocused: () => true,
}));

describe('Q11 (rendered) — context-full "New chat" drops the project', () => {
  it('shows the continuation chat under its project after a context-full New chat', async () => {
    mockRouteProjectId = 'proj-1';
    const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
     
    const React = require('react');
    const { render } = require('../../harness/nativeBoundary').requireRTL();
    const { llmService } = require('../../../src/services/llm');
    const { hardwareService } = require('../../../src/services/hardware');
    const { runPersistedChatTurnFn } = require('../../../src/screens/ChatScreen/useChatGenerationActions');
    const { useAppStore, useProjectStore, useChatStore } = require('../../../src/stores');
    const { ProjectChatsScreen } = require('../../../src/screens/ProjectChatsScreen');
     

    boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
    await hardwareService.refreshMemoryInfo();
    await llmService.loadModel('/models/small.gguf');
    useAppStore.setState({
      downloadedModels: [createDownloadedModel({ id: 'txt', engine: 'llama', filePath: '/models/small.gguf', fileName: 'small.gguf' })],
      activeModelId: 'txt',
    });
    await require('../../../src/services/modelServices').refreshMobileModelServices();

    useProjectStore.setState({ projects: [createProject({ id: 'proj-1', name: 'Research' })] });
    const convId = useChatStore.getState().createConversation('txt', 'In project', 'proj-1');
    useChatStore.getState().addMessage(convId, { role: 'user', content: 'continue please' });
    const { deps, captured } = makeGenDeps({ activeConversationId: convId });

    boundary.llama!.scriptCompletion({ throwMessage: 'the input prompt is too long for this context window' });
    boundary.llama!.scriptCompletion({ throwMessage: 'the input prompt is too long for this context window' });
    await runPersistedChatTurnFn(deps, { targetConversationId: convId, messageText: 'continue please', setDebugInfo: () => {} });

    // User taps "New chat" on the context-full alert → creates the continuation ("New Conversation").
    const alert = captured.alerts.find(a => a.buttons?.some(b => b.text === 'New chat'));
    expect(alert).toBeDefined();
    alert!.buttons!.find(b => b.text === 'New chat')!.onPress!();

    const view = render(React.createElement(ProjectChatsScreen, {}));
    // Load-proof: the original filed chat renders under the project (screen mounted + filter works).
    expect(view.getByText('In project')).toBeTruthy();
    // Correct: the continuation is filed under the same project and shows here. Today it's unfiled → RED.
    expect(view.queryByText('New Conversation')).not.toBeNull();
  });
});
