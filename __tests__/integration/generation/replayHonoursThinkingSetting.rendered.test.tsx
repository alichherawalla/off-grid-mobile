/**
 * Resend and edit are NEW runs of the same message, so they honour the thinking setting in force
 * NOW - exactly like send. On device: thinking switched off, "hi" answered without thinking, then
 * Retry answered WITH thinking, because the shared replay reused the request recorded on the first
 * send. Only llama.rn is faked (scripted completion); the REAL ChatScreen gestures, chat session,
 * shared ChatSessionService, and llmService run. The assertion is the enable_thinking flag that
 * reaches the native engine on each of the three runs.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

type CompletionParams = {
  enable_thinking?: boolean;
  messages?: Array<{ role: string; content?: string }>;
};

const lastUserText = (params: CompletionParams): string | undefined =>
  [...(params.messages ?? [])].reverse().find(m => m.role === 'user')?.content;

describe('replays honour the thinking setting in force now', () => {
  it('send thinks, then a resend and an edit after thinking is switched off do not', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    h.useAppStore.getState().updateSettings({ thinkingEnabled: true });
    h.render();

    await h.send('hi', { text: '<think>greeting</think>Hello!' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hello!/)).not.toBeNull(); });

    h.useAppStore.getState().updateSettings({ thinkingEnabled: false });

    await h.regenerateLast({ text: 'Hello again!' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hello again!/)).not.toBeNull(); });

    await h.editLastUserMessage('hi there', { text: 'Hi there!' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi there!/)).not.toBeNull(); });

    const chatRuns = h.boundary.llama!.calls.completion
      .map(call => call[0] as CompletionParams)
      .filter(params => /^hi( there)?$/.test(lastUserText(params) ?? ''));
    expect(chatRuns.map(params => params.enable_thinking)).toEqual([true, false, false]);
  });
});
