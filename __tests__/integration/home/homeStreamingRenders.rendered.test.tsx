/**
 * Home must not re-render while a reply streams.
 *
 * The chat screen sits on top of Home in the navigation stack, so Home stays mounted for the whole
 * reply. A reply writes the chat store once per token. Home used to subscribe to the WHOLE chat
 * store, so every token re-rendered Home and every sheet under it (models manager, project selector,
 * recent conversations with its sort). On a phone that was most of the JavaScript time during a
 * reply, and taps stopped landing until the reply finished. Home reads the conversations and two
 * actions; only those may wake it.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

describe('Home while a reply streams', () => {
  it('does not re-render per token, and re-renders once when the reply is committed', async () => {
    installNativeBoundary();
    const React = require('react');
    const rtl = requireRTL();
    const { HomeScreen } = require('../../../src/screens/HomeScreen');
    const { useChatStore } = require('../../../src/stores/chatStore');

    const conversationId = useChatStore.getState().createConversation('model-a', 'Streaming');
    const nav = { navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} };
    let commits = 0;
    const home = rtl.render(
      React.createElement(
        React.Profiler,
        { id: 'home', onRender: () => { commits += 1; } },
        React.createElement(HomeScreen, { navigation: nav }),
      ),
    );
    await rtl.waitFor(() => { expect(home.getByTestId('browse-models-button')).toBeTruthy(); }, { timeout: 4000 });
    // Let mount-time effects (device info, memory) settle, then take the baseline.
    await rtl.act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    const afterMount = commits;

    await rtl.act(async () => {
      useChatStore.getState().startStreaming(conversationId);
      for (let token = 0; token < 100; token += 1) {
        useChatStore.getState().appendToStreamingReasoningContent(`think${token} `);
        useChatStore.getState().appendToStreamingMessage(`word${token} `);
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(useChatStore.getState().streamingMessage).toContain('word99');
    expect(commits).toBe(afterMount);

    await rtl.act(async () => {
      useChatStore.getState().addMessage(conversationId, {
        role: 'assistant',
        content: useChatStore.getState().streamingMessage,
      });
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(commits).toBeGreaterThan(afterMount);
    home.unmount();
  });
});
