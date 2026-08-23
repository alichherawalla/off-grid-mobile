import { chatStreamToolsFromMessages } from '../../../src/services/sync/chatStreamTools';
import type { Message } from '../../../src/types';

const message = (value: Partial<Message> & Pick<Message, 'role'>): Message =>
  ({
    id: `${value.role}-message`,
    content: '',
    timestamp: 1,
    ...value,
  } as Message);

describe('chatStreamToolsFromMessages', () => {
  it('publishes a tool as running before its result exists', () => {
    expect(
      chatStreamToolsFromMessages([
        message({ role: 'user', content: 'Draw a cat' }),
        message({
          role: 'assistant',
          toolCalls: [
            { id: 'call-1', name: 'generate_image', arguments: '{}' },
          ],
        }),
      ]),
    ).toEqual([{ name: 'generate_image', status: 'running' }]);
  });

  it('completes the same tool row when its result arrives', () => {
    expect(
      chatStreamToolsFromMessages([
        message({ role: 'user', content: 'Draw a cat' }),
        message({
          role: 'assistant',
          toolCalls: [
            { id: 'call-1', name: 'generate_image', arguments: '{}' },
          ],
        }),
        message({
          role: 'tool',
          toolCallId: 'call-1',
          toolName: 'generate_image',
          content: 'Image generation started',
        }),
      ]),
    ).toEqual([
      {
        name: 'generate_image',
        status: 'completed',
        result: 'Image generation started',
      },
    ]);
  });
});
