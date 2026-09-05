import type { TextStreamTransport } from '../../../src/services/adapters/providers/types';
import { modelsFailureMessage } from '@offgrid/application';
import { remoteTextTransportRegistry } from '../../../src/services/adapters/providers';
import { getMobileApplication } from '../../../src/services/composition/application';
import { mobileTextEngineControl } from '../../../src/services/modelServices/textEngineControl';
import { useAppStore } from '../../../src/stores';
import { createDownloadedModel } from '../../utils/factories';
import { mobileChatSession } from '../../../src/screens/ChatScreen/mobileChatSession';
import { useChatStore } from '../../../src/stores/chatStore';
import { setupWithConversation } from '../../utils/testHelpers';
import { remoteServerManager } from '../../../src/services/remoteServerManager';
import {
  startMobileApplicationFixture,
  type MobileApplicationFixture,
} from '../../harness/mobileApplicationFixture';

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
  let applicationFixture: MobileApplicationFixture;

  beforeAll(async () => {
    applicationFixture = await startMobileApplicationFixture();
  });

  afterAll(async () => {
    await applicationFixture.dispose();
  });

  beforeEach(async () => {
    remoteTextTransportRegistry.clear();
    await remoteServerManager.clearAllServers();
    const app = useAppStore.getState();
    for (const model of app.downloadedModels) app.removeDownloadedModel(model.id);
    app.addDownloadedModel(local);
    await selectMobileModel({ source: 'local', hostId: 'llama', modality: 'text', modelId: local.id });
  });

  afterEach(async () => {
    await clearMobileModel('text');
    remoteTextTransportRegistry.clear();
    await remoteServerManager.clearAllServers();
  });

  it('uses the canonical local route for status, capability, and execution identity', () => {
    const active = activeMobileModel('text');
    expect(active.model).toMatchObject({ id: local.id, source: 'local', providerId: 'llama' });
    expect(remoteTextTransportRegistry.ids()).toEqual([]);
    expect(mobileTextEngineControl.activeLocalProviderId()).toBe('llama');
    expect(mobileTextEngineControl.isRemoteActive()).toBe(false);
    expect(mobileTextEngineControl.capabilities(local.id)).toEqual({
      vision: false, audio: false, tools: true, thinking: false,
    });
  });

  it('keeps remote UI capability and execution identity on the same canonical route', async () => {
    const modelId = 'remote-model';
    const serverId = (await remoteServerManager.addServer({
      name: 'Remote server', endpoint: 'http://127.0.0.1:11434', provider: 'openai-compatible',
      selections: { text: modelId },
      catalog: { text: [{
        id: modelId, name: 'Remote model',
        capabilities: { supportsVision: true, supportsToolCalling: true, supportsThinking: true },
      }] },
    })).id;
    await selectMobileModel({ source: 'remote', hostId: serverId, modality: 'text', modelId });

    expect(activeMobileModel('text').model).toMatchObject({ id: modelId, source: 'remote', serverId });
    expect(remoteTextTransportRegistry.get(serverId)).toMatchObject({
      id: serverId,
      type: 'openai-compatible',
      config: { endpoint: 'http://127.0.0.1:11434/v1' },
    });
    expect(mobileTextEngineControl.activeLocalProviderId()).toBeNull();
    expect(mobileTextEngineControl.isRemoteActive()).toBe(true);
    expect(mobileTextEngineControl.capabilities(modelId)).toEqual({
      vision: true, audio: false, tools: true, thinking: true,
    });
  });

  it('fails closed when the selected remote provider becomes unavailable', async () => {
    const modelId = 'unavailable-model';
    const serverId = (await remoteServerManager.addServer({
      name: 'Unavailable server', endpoint: 'http://127.0.0.1:11434', provider: 'openai-compatible',
      selections: { text: modelId },
      catalog: { text: [{
        id: modelId, name: 'Unavailable model',
        capabilities: { supportsVision: false, supportsToolCalling: false, supportsThinking: false },
      }] },
    })).id;
    remoteTextTransportRegistry.register(serverId, remoteTransport(serverId));
    await selectMobileModel({ source: 'remote', hostId: serverId, modality: 'text', modelId });

    remoteTextTransportRegistry.unregister(serverId);
    await refreshMobileModelServices();

    const active = activeMobileModel('text');
    expect(active.selectedId).not.toBeNull();
    expect(active.model).toMatchObject({ id: modelId, source: 'remote', ready: false });
    expect(remoteTextTransportRegistry.get(serverId)).toBeUndefined();
    expect(mobileTextEngineControl.isRemoteActive()).toBe(true);
    expect(models().resolve({ modality: 'text', routeId: active.selectedId!, allowFallback: false }))
      .toMatchObject({ selected: null, candidates: [], requested: { ready: false } });
    const conversationId = setupWithConversation({ modelId });
    const user = useChatStore.getState().addMessage(conversationId, {
      role: 'user', content: 'Do not send this to a local model.', turnKind: 'text',
    });
    await expect(mobileChatSession.sendPersisted(conversationId, user.id))
      .rejects.toThrow('No compatible text model is ready');
  });

  it('returns to the persisted local route only after the remote server is removed', async () => {
    const modelId = 'removed-model';
    const serverId = (await remoteServerManager.addServer({
      name: 'Removed server', endpoint: 'http://127.0.0.1:11434', provider: 'openai-compatible',
      selections: { text: modelId },
      catalog: { text: [{
        id: modelId, name: 'Removed model',
        capabilities: { supportsVision: false, supportsToolCalling: false, supportsThinking: false },
      }] },
    })).id;
    remoteTextTransportRegistry.register(serverId, remoteTransport(serverId));
    await selectMobileModel({ source: 'remote', hostId: serverId, modality: 'text', modelId });

    await remoteServerManager.removeServer(serverId);
    await refreshMobileModelServices();

    expect(activeMobileModel('text').model).toMatchObject({ id: local.id, source: 'local' });
    expect(remoteTextTransportRegistry.get(serverId)).toBeUndefined();
    expect(mobileTextEngineControl.isRemoteActive()).toBe(false);
  });

  it('selects and clears a remote embedding route through the same server control plane', async () => {
    const serverId = (await remoteServerManager.addServer({
      name: 'Embedding server',
      endpoint: 'https://embeddings.example.test/v1',
      provider: 'openai-compatible',
      selections: { embedding: 'embed-small' },
      catalog: { embedding: [{ id: 'embed-small', name: 'Embed Small' }] },
    })).id;
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
  const models = () => getMobileApplication().models;
  const activeMobileModel = (modality: 'text' | 'embedding') => {
    const active = models().snapshot().active[modality];
    if (!active) throw new Error(`Missing ${modality} projection.`);
    return active;
  };
  const refreshMobileModelServices = () => models().refresh();
  const clearMobileModel = async (modality: 'text' | 'embedding') => {
    const outcome = await models().select({modality, modelId: null});
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
  };
  const selectMobileModel = async (selection: {
    source: 'local' | 'remote';
    hostId: string;
    modality: 'text' | 'embedding';
    modelId: string;
  }) => {
    await models().refresh();
    const route = selection.source === 'remote'
      ? models().remoteModelRoute(selection.hostId, selection.modelId, selection.modality)
      : models().resolveRoute(selection.modality, selection.modelId);
    const outcome = await models().select({modality: selection.modality, modelId: route ?? selection.modelId});
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
  };
