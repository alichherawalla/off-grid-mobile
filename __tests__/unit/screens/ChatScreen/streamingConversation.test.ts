import { isStreamingActiveConversation } from '../../../../src/screens/ChatScreen/useChatScreenLifecycle';

describe('isStreamingActiveConversation', () => {
  it('does not treat a new chat with no stream as a completed stream', () => {
    expect(isStreamingActiveConversation(null, null)).toBe(false);
  });

  it('matches only the active conversation stream', () => {
    expect(isStreamingActiveConversation('chat-1', 'chat-1')).toBe(true);
    expect(isStreamingActiveConversation('chat-2', 'chat-1')).toBe(false);
  });
});
