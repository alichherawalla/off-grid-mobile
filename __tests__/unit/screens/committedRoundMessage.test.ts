jest.mock('../../../src/stores', () => ({ useChatStore: { getState: () => ({ conversations: [] }) } }));
jest.mock('../../../src/services/modelMedia', () => ({ modelInputAudioUris: () => [] }));

import {
  committedRoundMessage,
  generationMessageText,
} from '../../../src/screens/ChatScreen/mobileChatTurnRepository';

describe('committedRoundMessage', () => {
  it('shapes a committed tool round for the compaction planner', () => {
    const call = { id: 'c1', name: 'read_wiki_contents', arguments: '{"repoName":"x"}' };
    const assistant = committedRoundMessage('conv', { role: 'assistant', content: '', toolCalls: [call] }, 0);
    const tool = committedRoundMessage(
      'conv',
      { role: 'tool', name: 'read_wiki_contents', toolCallId: 'c1', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
      1,
    );
    expect(assistant).toMatchObject({ id: 'conv-round-0', role: 'assistant', content: '', toolCalls: [call] });
    expect(tool).toMatchObject({ id: 'conv-round-1', role: 'tool', content: 'a\nb', toolCallId: 'c1', toolName: 'read_wiki_contents' });
    expect(tool.toolCalls).toBeUndefined();
    expect(typeof tool.timestamp).toBe('number');
  });

  it('reads text from a string or from text parts only', () => {
    expect(generationMessageText({ role: 'user', content: 'plain' })).toBe('plain');
    expect(
      generationMessageText({ role: 'user', content: [{ type: 'text', text: 'x' }, { type: 'image', mimeType: 'image/png', uri: 'u' } as any] }),
    ).toBe('x');
  });
});
