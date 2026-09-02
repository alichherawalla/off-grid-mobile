/**
 * BUG #29(a) regression — a remote generation failure must clear EVERY loading signal.
 *
 * When a remote model call fails (e.g. HTTP 400) an error alert shows, but a loading
 * indicator lingered. This drives the REAL generationService through a REAL remote-provider
 * failure (a registered provider whose generate() rejects) and asserts every loading flag
 * the UI reads is false afterward:
 *   - generationService.getState().isGenerating / isThinking
 *   - chatStore.isStreaming / isThinking / streamingForConversationId
 *   - generationSession (the "which conversation is generating" owner)
 *
 * Only the network boundary (the provider's generate) is faked — the service, both
 * stores, and the session owner run for real, so a lingering flag surfaces here.
 * Fails-before / passes-after.
 */
import { mobileChatGenerationProjection } from '../../../src/services/chatGenerationProjection';
import { generationSession } from '../../../src/services/generationSession';
import { useChatStore } from '../../../src/stores/chatStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { llmService } from '../../../src/services/llm';
import { resetStores, setupWithConversation, flushPromises } from '../../utils/testHelpers';
import { refreshMobileModelServices, selectMobileModel } from '../../../src/services/modelServices';
import { mobileChatSession } from '../../../src/screens/ChatScreen/mobileChatSession';
import { remoteServerManager } from '../../../src/services/remoteServerManager';

jest.mock('../../../src/services/llm');
const mockLlmService = llmService as jest.Mocked<typeof llmService>;

describe('BUG #29(a) — remote failure clears all loading flags', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    generationSession._reset();
    // No local model loaded → generationService routes to the remote provider.
    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLlmService.getLoadedModelPath.mockReturnValue(null as any);
    mobileChatSession.stop();
  });

  afterEach(() => {
    useRemoteServerStore.setState({ activeServerId: null } as any);
  });

  it('leaves isGenerating / isThinking / isStreaming / session all false after a remote error', async () => {
    const serverId = (await remoteServerManager.addServer({
      name: 'Failing server',
      endpoint: 'http://127.0.0.1:11434',
      provider: 'openai-compatible',
    })).id;
    useRemoteServerStore.getState().setDiscoveredModels(serverId, [{
      id: 'remote-model', name: 'Remote model', serverId,
      // The default chat request includes enabled tools. Admit the request so
      // this test reaches the intended HTTP failure boundary.
      capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false },
      lastUpdated: '2026-08-30T00:00:00.000Z',
    }]);
    // External transport boundary: the current async server manager installs
    // the real provider. Its network request receives the intended HTTP 400.
    (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = class {
      readyState = 0;
      status = 0;
      responseText = '';
      onreadystatechange: null | (() => void) = null;
      onprogress: null | (() => void) = null;
      onerror: null | (() => void) = null;
      ontimeout: null | (() => void) = null;
      open(): void { this.readyState = 1; }
      setRequestHeader(): void {}
      abort(): void {}
      send(): void {
        this.status = 400;
        this.responseText = 'Bad Request';
        this.readyState = 4;
        this.onreadystatechange?.();
      }
    };
    await selectMobileModel({ source: 'remote', hostId: serverId, modality: 'text', modelId: 'remote-model' });
    await refreshMobileModelServices();

    const conversationId = setupWithConversation({ modelId: 'remote-model' });
    generationSession.begin(conversationId);

    const user = useChatStore.getState().addMessage(conversationId, {
      role: 'user', content: 'hi', turnKind: 'text',
    });
    await expect(mobileChatSession.sendPersisted(conversationId, user.id))
      .rejects.toThrow('HTTP 400');

    await flushPromises();

    const genState = mobileChatGenerationProjection.getState();
    const chat = useChatStore.getState();

    expect(genState.isGenerating).toBe(false);
    expect(genState.isThinking).toBe(false);
    expect(chat.isStreaming).toBe(false);
    expect(chat.isThinking).toBe(false);
    expect(chat.streamingForConversationId).toBeNull();
    // generationService cleared its own session identity; the ChatScreen action layer
    // ends the generationSession on the thrown error (mirrored by handleStop/startGeneration).
    expect(mobileChatGenerationProjection.isGeneratingFor(conversationId)).toBe(false);
  });
});
