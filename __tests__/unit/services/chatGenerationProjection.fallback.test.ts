/**
 * A fallback changes who answers. The reader must see it in the chat (a row names the model that
 * failed and the one that took over) and in the finished turn's meta line (the model that answered,
 * not the route that was selected).
 */
jest.mock('../../../src/stores', () => {
  const chat = {
    startStreaming: jest.fn(),
    appendToStreamingMessage: jest.fn(),
    appendToStreamingReasoningContent: jest.fn(),
    resetStreamingSegment: jest.fn(),
    finalizeStreamingMessage: jest.fn(),
    clearStreamingMessage: jest.fn(),
    updateMessageTurnKind: jest.fn(),
    addMessage: jest.fn(),
    streamingForConversationId: 'c',
    streamingMessage: '',
  };
  return {
    useChatStore: { getState: () => chat },
    useAppStore: {
      getState: () => ({ incrementTextGenerationCount: () => 1, hasEngagedSharePrompt: true, settings: {} }),
    },
  };
});
jest.mock('../../../src/utils/sharePrompt', () => ({ maybeScheduleSharePrompt: jest.fn() }));
jest.mock('../../../src/services/proPrompt', () => ({ checkProPromptForText: jest.fn() }));
// Engine boundaries behind the meta line. The selected route is the remote Qwen for every case.
jest.mock('../../../src/services/modelServices/mobileLLMService', () => ({
  activeMobileRoute: () => ({ model: { id: 'qwen', name: 'Qwen 3.5 2B', source: 'remote' } }),
}));
jest.mock('../../../src/services/modelServices/textEngineControl', () => ({
  mobileTextEngineControl: { activeLocalProviderId: () => 'llama' },
}));
jest.mock('../../../src/services/llm', () => ({
  llmService: {
    getGpuInfo: () => ({ gpu: true, gpuBackend: 'Metal', gpuLayers: 99 }),
    getPerformanceStats: () => ({ lastTokensPerSecond: 42 }),
  },
}));
jest.mock('../../../src/services/litert', () => ({
  liteRTService: { getActiveBackend: () => 'cpu', getLastBenchmarkStats: () => undefined },
}));

import { fallbackNoticeText } from '@offgrid/models';
import {
  MODEL_FALLBACK_TOOL_NAME,
  mobileChatGenerationProjection,
} from '../../../src/services/chatGenerationProjection';
import { useChatStore } from '../../../src/stores';

const qwen = { id: 'qwen', name: 'Qwen 3.5 2B', source: 'remote' } as any;
const smol = { id: 'smol', name: 'SmolLM2 135M', source: 'local' } as any;
const turn = { id: 't', conversationId: 'c', request: { operation: { type: 'text' } } } as any;
const publish = (event: any) => mobileChatGenerationProjection.publish(event);
const store = () => useChatStore.getState() as any;

beforeEach(() => {
  jest.useFakeTimers();
  for (const fn of Object.values(store())) if (jest.isMockFunction(fn)) fn.mockClear();
});

describe('a fallback is announced in the chat', () => {
  it('adds a row that names the model that failed, why, and the model that took over', () => {
    publish({ type: 'started', turn });
    publish({ type: 'fallback', turn, failed: qwen, next: smol, error: new Error('HTTP 502') });

    expect(store().addMessage).toHaveBeenCalledWith('c', {
      role: 'tool',
      toolName: MODEL_FALLBACK_TOOL_NAME,
      content: fallbackNoticeText(qwen, smol, new Error('HTTP 502')),
      isSystemInfo: true,
    });
    expect(store().addMessage.mock.calls[0][1].content).toBe(
      'Qwen 3.5 2B could not answer (HTTP 502). SmolLM2 135M answered instead.',
    );
  });

  it('starts a fresh visible segment so the next model streams from its first token', () => {
    const order: string[] = [];
    store().appendToStreamingMessage.mockImplementation((text: string) => order.push(`append:${text}`));
    store().resetStreamingSegment.mockImplementation(() => order.push('reset'));

    publish({ type: 'started', turn });
    publish({ type: 'partial', turn, partial: { content: 'Qwen st', reasoning: '' } });
    publish({ type: 'fallback', turn, failed: qwen, next: smol, error: new Error('HTTP 502') });
    publish({ type: 'partial', turn, partial: { content: 'Hello', reasoning: '' } });
    jest.runAllTimers();

    expect(order).toEqual(['append:Qwen st', 'reset', 'append:Hello']);
    expect(mobileChatGenerationProjection.getState().isThinking).toBe(false);
  });

  it('ignores a fallback for a turn that is not the one on screen', () => {
    publish({ type: 'started', turn });
    publish({ type: 'fallback', turn: { ...turn, conversationId: 'other' }, failed: qwen, next: smol, error: 'x' });
    expect(store().addMessage).not.toHaveBeenCalled();
  });
});

describe('the finished turn names the model that answered', () => {
  it('uses the turn result, not the selected route, when a fallback answered', () => {
    publish({ type: 'started', turn });
    publish({ type: 'completed', turn: { ...turn, result: { content: 'Hi', model: smol } } });

    const meta = store().finalizeStreamingMessage.mock.calls[0][2];
    expect(meta.modelName).toBe('SmolLM2 135M');
    // The answering model is local, so the meta line reads the local engine, not "Remote".
    expect(meta.gpuBackend).toBe('Metal');
    expect(meta.tokensPerSecond).toBe(42);
  });

  it('falls back to the selected route when the turn carries no result', () => {
    publish({ type: 'started', turn });
    publish({ type: 'stopped', turn: { ...turn, partial: { content: 'part', reasoning: '' } } });

    const meta = store().finalizeStreamingMessage.mock.calls[0][2];
    expect(meta.modelName).toBe('Qwen 3.5 2B');
    expect(meta.gpuBackend).toBe('Remote');
  });
});
