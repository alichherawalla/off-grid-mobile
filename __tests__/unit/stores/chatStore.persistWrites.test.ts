/**
 * A streaming reply must not persist the conversation history once per token.
 *
 * The chat store is wrapped in zustand persist, which calls storage.setItem after every set. With
 * the stock JSON storage that serialised every conversation and queued an AsyncStorage write for
 * each streamed token - on a phone that starved the JS thread for the length of a long reply and
 * grew the write queue until the OS killed the process. The storage now writes only when a
 * persisted field changes; streaming fields are ephemeral and never trigger a write.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useChatStore } from '../../../src/stores/chatStore';
import { resetStores } from '../../utils/testHelpers';

const writes = (): number =>
  (AsyncStorage.setItem as jest.Mock).mock.calls.length;

describe('chat store persistence during a streaming reply', () => {
  beforeEach(() => {
    resetStores();
    (AsyncStorage.setItem as jest.Mock).mockClear();
  });

  it('writes nothing while tokens stream and once when the reply is committed', () => {
    const store = useChatStore.getState();
    const conversationId = store.createConversation('model-a', 'Persist test');
    const afterCreate = writes();
    expect(afterCreate).toBeGreaterThan(0);

    store.startStreaming(conversationId);
    for (let i = 0; i < 300; i += 1) {
      useChatStore.getState().appendToStreamingReasoningContent(`think${i} `);
      useChatStore.getState().appendToStreamingMessage(`word${i} `);
    }
    expect(useChatStore.getState().streamingMessage).toContain('word299');
    expect(writes()).toBe(afterCreate);

    useChatStore.getState().addMessage(conversationId, {
      role: 'assistant',
      content: useChatStore.getState().streamingMessage,
    });
    expect(writes()).toBe(afterCreate + 1);
    const persisted = JSON.parse(
      (AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)?.[1] as string,
    ) as {
      state: { conversations: Array<{ messages: Array<{ content: string }> }> };
    };
    expect(
      persisted.state.conversations[0]?.messages.at(-1)?.content,
    ).toContain('word299');
    expect(persisted.state).not.toHaveProperty('streamingMessage');
  });
});
