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
    // Hold layout work until after the assertion. This proves that stored content
    // is visible on the first render and does not depend on a deferred frame.
    const deferredFrames: Array<(time: number) => void> = [];
    const originalRequestAnimationFrame = (globalThis as any).requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (callback: (time: number) => void) => {
      deferredFrames.push(callback);
      return deferredFrames.length;
    };

    try {
      const reopened = h.render();
      await h.rtl.waitFor(() => {
        expect(reopened.getByText('The stored reply is ready.')).toBeVisible();
      });
      expect(reopened.getByTestId('chat-message-list')).toBeVisible();
    } finally {
      (globalThis as any).requestAnimationFrame = originalRequestAnimationFrame;
      await h.rtl.act(async () => {
        deferredFrames.forEach(callback => callback(Date.now()));
      });
    }
  });
});
