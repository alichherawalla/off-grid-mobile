import type { TextStreamTransport } from '../../../src/services/adapters/providers/types';
import { remoteTextTransportRegistry } from '../../../src/services/adapters/providers';
import {
  activeMobileModel,
  clearMobileModel,
  mobileLLMService,
  refreshMobileModelServices,
  selectMobileModel,
} from '../../../src/services/modelServices';
import {
  activeTextCapabilities,
  getActiveEngineService,
  isRemoteTextModelActive,
} from '../../../src/services/engines';
import { useAppStore, useRemoteServerStore } from '../../../src/stores';
import { createDownloadedModel } from '../../utils/factories';
import { mobileChatSession } from '../../../src/screens/ChatScreen/mobileChatSession';
import { useChatStore } from '../../../src/stores/chatStore';
import { setupWithConversation } from '../../utils/testHelpers';
import { remoteServerManager } from '../../../src/services/remoteServerManager';

function remoteTransport(id: string): TextStreamTransport {
  return {
    id,
    type: 'openai-compatible',
    async generate(_modelId, _messages, _options, callbacks) {
      callbacks.onToken('remote reply');
      callbacks.onComplete({ content: 'remote reply' });
    },
    async stopGeneration() {},
    async isReady() { return true; },
  };
}

describe('canonical Mobile text route authority', () => {
  const local = createDownloadedModel({ id: 'local-model', name: 'Local model', engine: 'llama' });

  beforeEach(async () => {
    remoteTextTransportRegistry.clear();
    useRemoteServerStore.getState().clearAllServers();
    const app = useAppStore.getState();
    for (const model of app.downloadedModels) app.removeDownloadedModel(model.id);
    app.addDownloadedModel(local);
    await selectMobileModel({ source: 'local', hostId: 'llama', modality: 'text', modelId: local.id });
  });

  afterEach(async () => {
    await clearMobileModel('text');
    remoteTextTransportRegistry.clear();
    useRemoteServerStore.getState().clearAllServers();
  });

  it('uses the canonical local route for status, capability, and execution identity', () => {
    const active = activeMobileModel('text');
    expect(active.model).toMatchObject({ id: local.id, source: 'local', providerId: 'llama' });
    expect(remoteTextTransportRegistry.ids()).toEqual([]);
    expect(getActiveEngineService()).not.toBeNull();
    expect(isRemoteTextModelActive()).toBe(false);
    expect(activeTextCapabilities({ isRemote: false, model: local })).toEqual({
      vision: false, audio: false, tools: true, thinking: false,
    });
  });

  it('keeps remote UI capability and execution identity on the same canonical route', async () => {
    const remote = useRemoteServerStore.getState();
    const serverId = remote.addServer({ name: 'Remote server', endpoint: 'http://127.0.0.1:11434', provider: 'openai-compatible' });
    const modelId = 'remote-model';
    remote.setDiscoveredModels(serverId, [{
      id: modelId,
      name: 'Remote model',
      serverId,
      capabilities: { supportsVision: true, supportsToolCalling: true, supportsThinking: true },
      lastUpdated: new Date().toISOString(),
    }]);
    const transport = remoteTransport(serverId);
    remoteTextTransportRegistry.register(serverId, transport);

    await selectMobileModel({ source: 'remote', hostId: serverId, modality: 'text', modelId });

    expect(activeMobileModel('text').model).toMatchObject({ id: modelId, source: 'remote', serverId });
    expect(remoteTextTransportRegistry.get(serverId)).toBe(transport);
    expect(getActiveEngineService()).toBeNull();
    expect(isRemoteTextModelActive()).toBe(true);
    expect(activeTextCapabilities({ isRemote: false, model: local })).toEqual({
      vision: true, audio: false, tools: true, thinking: true,
    });
  });

  it('fails closed when the selected remote provider becomes unavailable', async () => {
    const remote = useRemoteServerStore.getState();
    const serverId = remote.addServer({ name: 'Unavailable server', endpoint: 'http://127.0.0.1:11434', provider: 'openai-compatible' });
    const modelId = 'unavailable-model';
    remote.setDiscoveredModels(serverId, [{
      id: modelId,
      name: 'Unavailable model',
      serverId,
      capabilities: { supportsVision: false, supportsToolCalling: false, supportsThinking: false },
      lastUpdated: new Date().toISOString(),
    }]);
    remoteTextTransportRegistry.register(serverId, remoteTransport(serverId));
    await selectMobileModel({ source: 'remote', hostId: serverId, modality: 'text', modelId });

    remoteTextTransportRegistry.unregister(serverId);
    await refreshMobileModelServices();

    const active = activeMobileModel('text');
    expect(active.selectedId).not.toBeNull();
    expect(active.model).toMatchObject({ id: modelId, source: 'remote', ready: false });
    expect(remoteTextTransportRegistry.get(serverId)).toBeUndefined();
    expect(isRemoteTextModelActive()).toBe(true);
    expect(mobileLLMService.resolveRoute({ modality: 'text', routeId: active.selectedId!, allowFallback: false }))
      .toMatchObject({ selected: null, candidates: [], requested: { ready: false } });
    const conversationId = setupWithConversation({ modelId });
    const user = useChatStore.getState().addMessage(conversationId, {
      role: 'user', content: 'Do not send this to a local model.', turnKind: 'text',
    });
    await expect(mobileChatSession.sendPersisted(conversationId, user.id))
      .rejects.toThrow('No compatible text model is ready');
  });

  it('returns to the persisted local route only after the remote server is removed', async () => {
    const remote = useRemoteServerStore.getState();
    const serverId = remote.addServer({ name: 'Removed server', endpoint: 'http://127.0.0.1:11434', provider: 'openai-compatible' });
    const modelId = 'removed-model';
    remote.setDiscoveredModels(serverId, [{
      id: modelId,
      name: 'Removed model',
      serverId,
      capabilities: { supportsVision: false, supportsToolCalling: false, supportsThinking: false },
      lastUpdated: new Date().toISOString(),
    }]);
    remoteTextTransportRegistry.register(serverId, remoteTransport(serverId));
    await selectMobileModel({ source: 'remote', hostId: serverId, modality: 'text', modelId });

    await remoteServerManager.removeServer(serverId);
    await refreshMobileModelServices();

    expect(activeMobileModel('text').model).toMatchObject({ id: local.id, source: 'local' });
    expect(remoteTextTransportRegistry.get(serverId)).toBeUndefined();
    expect(isRemoteTextModelActive()).toBe(false);
  });

  it('selects and clears a remote embedding route through the same server control plane', async () => {
    const remote = useRemoteServerStore.getState();
    const serverId = remote.addServer({
      name: 'Embedding server',
      endpoint: 'https://embeddings.example.test/v1',
      provider: 'openai-compatible',
      selections: { embedding: 'embed-small' },
      catalog: { embedding: [{ id: 'embed-small', name: 'Embed Small' }] },
    });
    await refreshMobileModelServices();

    await selectMobileModel({
      source: 'remote', hostId: serverId, modality: 'embedding', modelId: 'embed-small',
    });
    expect(activeMobileModel('embedding').model).toMatchObject({
      id: 'embed-small', source: 'remote', serverId,
    });

    await remoteServerManager.removeServer(serverId);
    await refreshMobileModelServices();
    expect(activeMobileModel('embedding').model).toBeNull();
  });
});
