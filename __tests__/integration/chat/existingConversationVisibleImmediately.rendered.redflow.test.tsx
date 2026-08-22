import { setupChatScreen } from '../../harness/chatHarness';

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

describe('opening an existing Mobile chat', () => {
  it('shows stored messages before the list completes its first measurement', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'ios' });
    h.render();
    await h.send('Show this chat again', { text: 'The stored reply is ready.' });
    await h.rtl.waitFor(() => {
      expect(h.view!.getByText('The stored reply is ready.')).toBeVisible();
    });

    const conversationId = h.conversationId;
    expect(conversationId).not.toBeNull();
    h.view!.unmount();

    require('../../harness/chatHarness').routeHolder.params = {
      conversationId,
    };
    const reopened = h.render();

    await h.rtl.waitFor(() => {
      expect(reopened.getByText('The stored reply is ready.')).toBeVisible();
    });
    expect(reopened.getByTestId('chat-message-list')).toBeVisible();
  });
});
