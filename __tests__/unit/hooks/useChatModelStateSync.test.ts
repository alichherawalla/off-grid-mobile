/**
 * useChatModelStateSync projects capabilities from the canonical text-engine control
 * port. Native engines and remote metadata are inputs to that owner, not parallel
 * capability sources in this hook.
 */
import { renderHook } from '@testing-library/react-native';
import { useChatModelStateSync } from '../../../src/screens/ChatScreen/useChatModelActions';

const mockEnsureReady = jest.fn();
const mockReadinessFactory = jest.fn(() => ({ ensureReady: mockEnsureReady }));
const mockCapabilities = jest.fn(() => ({
  vision: false,
  tools: false,
  thinking: false,
}));

jest.mock('../../../src/services/modelServices/chatModelReadinessPort', () => ({
  mobileChatModelReadiness: mockReadinessFactory,
}));

jest.mock('../../../src/services/modelServices/textEngineControl', () => ({
  mobileTextEngineControl: {
    capabilities: () => mockCapabilities(),
  },
}));

function run(deps: Partial<Parameters<typeof useChatModelStateSync>[0]>) {
  const setSupportsVision = jest.fn();
  const setSupportsToolCalling = jest.fn();
  const setSupportsThinking = jest.fn();
  renderHook(() =>
    useChatModelStateSync({
      activeModelInfo: { isRemote: false },
      activeModelId: 'm1',
      activeModel: undefined,
      activeRemoteModel: null,
      isModelLoading: false,
      setSupportsVision,
      setSupportsToolCalling,
      setSupportsThinking,
      ...(deps as any),
    }),
  );
  const last = (fn: jest.Mock) => fn.mock.calls.at(-1)?.[0];
  return {
    vision: last(setSupportsVision),
    tools: last(setSupportsToolCalling),
    thinking: last(setSupportsThinking),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCapabilities.mockReturnValue({ vision: false, tools: false, thinking: false });
});

describe('useChatModelStateSync — canonical capability projection', () => {
  it.each(['new', 'existing'])('%s Chat entry reads metadata without preparing a runtime', () => {
    run({ activeModel: { id: 'm1', engine: 'llama', filePath: '/m1.gguf' } as any });
    expect(mockReadinessFactory).not.toHaveBeenCalled();
    expect(mockEnsureReady).not.toHaveBeenCalled();
  });

  it('remote model: caps come from the declared remote capabilities', () => {
    mockCapabilities.mockReturnValue({ vision: true, tools: true, thinking: false });
    const r = run({
      activeModelInfo: { isRemote: true },
      activeRemoteModel: { capabilities: { supportsVision: true, supportsToolCalling: true, supportsThinking: false } },
    });
    expect(r).toEqual({ vision: true, tools: true, thinking: false });
  });

  it('LiteRT model LOADED: vision from the flag, tools+thinking true', () => {
    mockCapabilities.mockReturnValue({ vision: true, tools: true, thinking: true });
    const r = run({ activeModel: { engine: 'litert', liteRTVision: true } as any });
    expect(r).toEqual({ vision: true, tools: true, thinking: true });
  });

  it('LiteRT model NOT loaded: vision STILL from the flag, tools/thinking false', () => {
    mockCapabilities.mockReturnValue({ vision: true, tools: false, thinking: false });
    const r = run({ activeModel: { engine: 'litert', liteRTVision: true } as any });
    expect(r).toEqual({ vision: true, tools: false, thinking: false });
  });

  it('llama model LOADED with vision mmproj: caps from the live engine', () => {
    mockCapabilities.mockReturnValue({ vision: true, tools: true, thinking: true });
    const r = run({ activeModel: { engine: 'llama', mmProjPath: '/mmproj.gguf' } as any });
    expect(r).toEqual({ vision: true, tools: true, thinking: true });
  });

  it('nothing loaded (local, no engine ready): all false', () => {
    const r = run({ activeModel: { engine: 'llama' } as any });
    expect(r).toEqual({ vision: false, tools: false, thinking: false });
  });
});
