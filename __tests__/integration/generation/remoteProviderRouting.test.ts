import type { LLMProvider } from '../../../src/services/adapters/providers/types';
import { providerRegistry } from '../../../src/services/adapters/providers';
import {
  activeMobileModel,
  clearMobileModel,
  mobileLLMService,
  refreshMobileModelServices,
  selectMobileModel,
} from '../../../src/services/modelServices';
import { activeMobileTextProvider } from '../../../src/services/modelServices/mobileLLMService';
import {
  activeTextCapabilities,
  getActiveEngineService,
  isRemoteTextModelActive,
} from '../../../src/services/engines';
import { useAppStore, useRemoteServerStore } from '../../../src/stores';
import { createDownloadedModel } from '../../utils/factories';
import { generationService } from '../../../src/services/generationService';

function remoteProvider(id: string, modelId: string): LLMProvider {
  let loaded: string | null = null;
  return {
    id,
    type: 'openai-compatible',
    capabilities: { supportsVision: true, supportsToolCalling: true, supportsThinking: true },
    async loadModel(next) { loaded = next; },
    async unloadModel() { loaded = null; },
    isModelLoaded: () => loaded !== null,
    getLoadedModelId: () => loaded,
    async generate(_messages, _options, callbacks) {
      callbacks.onToken('remote reply');
      callbacks.onComplete({ content: 'remote reply' });
    },
    async stopGeneration() {},
    async getTokenCount(text) { return text.length; },
    async isReady() { return loaded === modelId; },
  };
}

describe('canonical Mobile text route authority', () => {
  const local = createDownloadedModel({ id: 'local-model', name: 'Local model', engine: 'llama' });

  beforeEach(async () => {
    providerRegistry.clear();
    useRemoteServerStore.getState().clearAllServers();
    const app = useAppStore.getState();
    for (const model of app.downloadedModels) app.removeDownloadedModel(model.id);
    app.addDownloadedModel(local);
    await selectMobileModel({ source: 'local', hostId: 'llama', modality: 'text', modelId: local.id });
  });

  afterEach(async () => {
    await clearMobileModel('text');
    providerRegistry.clear();
    useRemoteServerStore.getState().clearAllServers();
  });

  it('uses the canonical local route for status, capability, and execution identity', () => {
    const active = activeMobileModel('text');
    expect(active.model).toMatchObject({ id: local.id, source: 'local', providerId: 'llama' });
    expect(activeMobileTextProvider()?.id).toBe('local');
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
    const provider = remoteProvider(serverId, modelId);
    providerRegistry.registerProvider(serverId, provider);

    await selectMobileModel({ source: 'remote', hostId: serverId, modality: 'text', modelId });

    expect(activeMobileModel('text').model).toMatchObject({ id: modelId, source: 'remote', serverId });
    expect(activeMobileTextProvider()).toBe(provider);
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
    providerRegistry.registerProvider(serverId, remoteProvider(serverId, modelId));
    await selectMobileModel({ source: 'remote', hostId: serverId, modality: 'text', modelId });

    providerRegistry.unregisterProvider(serverId);
    await refreshMobileModelServices();

    const active = activeMobileModel('text');
    expect(active.selectedId).not.toBeNull();
    expect(active.model).toMatchObject({ id: modelId, source: 'remote', ready: false });
    expect(activeMobileTextProvider()).toBeNull();
    expect(isRemoteTextModelActive()).toBe(true);
    expect(mobileLLMService.resolveRoute({ modality: 'text', routeId: active.selectedId!, allowFallback: false }))
      .toEqual({ selected: null, candidates: [] });
    await expect(generationService.generateResponse('fail-closed-conversation', [{
      id: 'user-turn',
      role: 'user',
      content: 'Do not send this to a local model.',
      timestamp: Date.now(),
    }])).rejects.toThrow('No compatible text model is ready');
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
    providerRegistry.registerProvider(serverId, remoteProvider(serverId, modelId));
    await selectMobileModel({ source: 'remote', hostId: serverId, modality: 'text', modelId });

    remote.removeServer(serverId);
    providerRegistry.unregisterProvider(serverId);
    await refreshMobileModelServices();

    expect(activeMobileModel('text').model).toMatchObject({ id: local.id, source: 'local' });
    expect(activeMobileTextProvider()?.id).toBe('local');
    expect(isRemoteTextModelActive()).toBe(false);
  });
});
