/**
 * A conversation can keep a project id after the project is deleted or before
 * sync restores it. The knowledge-base tool and project RAG must stay scoped to
 * an existing project. This test drives the real rendered ChatScreen and the
 * real Shared ChatSessionService. Only the llama native boundary is faked.
 */
import { routeHolder, setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('orphaned project chat knowledge scope', () => {
  it('does not offer the knowledge-base tool when the referenced project does not exist', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    const { useProjectStore } = require('../../../src/stores');

    useProjectStore.setState({ projects: [] });
    const conversationId = h.useChatStore
      .getState()
      .createConversation('m', 'Orphaned project', 'ghost-project');
    routeHolder.params = { conversationId };

    // Anti-false-green: the user has enabled the KB tool. Project admission,
    // not a disabled setting, must keep it out of this orphaned request.
    expect(h.useAppStore.getState().settings.enabledTools).toContain(
      'search_knowledge_base',
    );

    h.render();
    await h.send('What did we discuss?', { text: 'Here is a plain answer.' });

    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Here is a plain answer\./)).not.toBeNull();
    });
    const sentToModel = JSON.stringify(h.boundary.llama!.calls.completion);
    expect(sentToModel).not.toContain('search_knowledge_base');
  });
});
