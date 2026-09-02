jest.mock('../../../src/stores', () => {
  const chat = {
    startStreaming: jest.fn(),
    appendToStreamingMessage: jest.fn(),
    appendToStreamingReasoningContent: jest.fn(),
    resetStreamingSegment: jest.fn(),
    finalizeStreamingMessage: jest.fn(),
    clearStreamingMessage: jest.fn(),
    updateMessageTurnKind: jest.fn(),
  };
  return {
    useChatStore: { getState: () => chat },
    useAppStore: { getState: () => ({ incrementTextGenerationCount: () => 1, hasEngagedSharePrompt: true }) },
  };
});
jest.mock('../../../src/utils/sharePrompt', () => ({ maybeScheduleSharePrompt: jest.fn() }));
jest.mock('../../../src/services/proPrompt', () => ({ checkProPromptForText: jest.fn() }));

import { mobileChatGenerationProjection } from '../../../src/services/chatGenerationProjection';
import { useChatStore } from '../../../src/stores';

const turn = { id: 't', conversationId: 'c', request: { operation: { type: 'text' } } } as any;
const publish = (event: any) => mobileChatGenerationProjection.publish(event);

describe('compaction is forward-looking on screen', () => {
  it('keeps the text already shown and streams the continuation after it', () => {
    jest.useFakeTimers();
    const store = useChatStore.getState() as any;
    const order: string[] = [];
    store.appendToStreamingMessage.mockImplementation((text: string) => order.push(`append:${text}`));
    store.resetStreamingSegment.mockImplementation(() => order.push('reset'));

    publish({ type: 'started', turn });
    publish({ type: 'partial', turn, partial: { content: 'Nearly done', reasoning: '' } });
    publish({ type: 'compacted', turn });
    publish({ type: 'partial', turn, partial: { content: 'continued', reasoning: '' } });
    jest.runAllTimers();

    expect(order).toEqual(['append:Nearly done', 'reset', 'append:continued']);
    expect(store.clearStreamingMessage).not.toHaveBeenCalled();
  });
});
