import {
  LLMService,
  ModelSelectionApplicationService,
  type RuntimeModel,
} from '@offgrid/models';
import { useAppStore } from '../../src/stores/appStore';
import { useRemoteServerStore } from '../../src/stores/remoteServerStore';
import {
  mobileExecutionAdapterId,
  mobileRouteId,
} from '../../src/services/modelServices/mobileRoute';
import {
  mobileModelSelectionProjection,
  readMobileModelSelection,
} from '../../src/services/modelServices/modelSelectionProjection';
import { mobileModelSelectionService } from '../../src/services/modelServices/modelSelectionApplication';

const localRoute = mobileRouteId({
  source: 'local', hostId: 'llama', modality: 'text', modelId: 'local/text.gguf',
});
const remoteRoute = mobileRouteId({
  source: 'remote', hostId: 'server-1', modality: 'text', modelId: 'remote/gemini',
});

function runtime(
  id: string,
  source: 'local' | 'remote',
  hostId: string,
): RuntimeModel {
  return {
    id,
    name: id,
    kind: 'text',
    modality: 'text',
    source,
    adapterId: mobileExecutionAdapterId(source, hostId, 'text'),
    ...(source === 'local' ? { providerId: hostId } : { serverId: hostId }),
    capabilities: { textGeneration: true },
    installed: true,
    ready: true,
    loaded: false,
  };
}

describe('the Shared model selection authority and Mobile persistence projection', () => {
  beforeEach(() => {
    useAppStore.setState({
      downloadedModels: [],
      activeModelId: null,
      lastTextModelId: null,
    });
    useRemoteServerStore.setState({
      servers: [],
      activeServerId: null,
      activeRemoteTextModelId: null,
      activeRemoteImageModelId: null,
      activeRemoteMediaServerIds: {},
      discoveredModels: {},
      serverHealth: {},
    });
  });

  it('keeps local and remote text selection mutually exclusive with one canonical ID', async () => {
    useAppStore.setState({
      downloadedModels: [{
        id: 'local/text.gguf', name: 'Local', author: 'test', engine: 'llama',
        filePath: '/local/text.gguf', fileName: 'text.gguf', fileSize: 1,
        quantization: 'Q4', downloadedAt: new Date(0).toISOString(),
      }],
      activeModelId: 'local/text.gguf',
    });
    useRemoteServerStore.setState({
      servers: [{
        id: 'server-1', name: 'Remote', endpoint: 'https://remote.test',
        provider: 'openai-compatible', createdAt: new Date(0).toISOString(),
      }],
    });
    const service = new LLMService(
      new ModelSelectionApplicationService(mobileModelSelectionProjection),
    );
    service.registerAdapter({
      id: 'selection-authority-proof',
      async listModels() { return [
        runtime('local/text.gguf', 'local', 'llama'),
        runtime('remote/gemini', 'remote', 'server-1'),
      ]; },
    });
    await service.refresh();

    await service.select('text', remoteRoute);
    expect(useAppStore.getState().activeModelId).toBeNull();
    expect(useRemoteServerStore.getState()).toMatchObject({
      activeServerId: 'server-1', activeRemoteTextModelId: 'remote/gemini',
    });
    expect(service.active('text').selectedId).toBe(remoteRoute);

    await service.select('text', localRoute);
    expect(useAppStore.getState().activeModelId).toBe('local/text.gguf');
    expect(useRemoteServerStore.getState()).toMatchObject({
      activeServerId: null, activeRemoteTextModelId: null,
    });
    expect(service.active('text').selectedId).toBe(localRoute);
  });

  it('never projects a Holo computer-use specialist as selected text', () => {
    useAppStore.setState({
      downloadedModels: [{
        id: 'holo/local', name: 'Holo3.1-4B', author: 'Hcompany', engine: 'llama',
        filePath: '/local/holo.gguf', fileName: 'Holo-3.1-4B.Q4_K_M.gguf', fileSize: 1,
        quantization: 'Q4_K_M', downloadedAt: new Date(0).toISOString(),
      }],
      activeModelId: 'holo/local',
    });

    expect(readMobileModelSelection('text')).toBeNull();

    useRemoteServerStore.setState({
      servers: [{
        id: 'server-1', name: 'Remote', endpoint: 'https://remote.test',
        provider: 'openai-compatible', createdAt: new Date(0).toISOString(),
      }],
      activeServerId: 'server-1',
      activeRemoteTextModelId: 'Hcompany/Holo-3.1-4B',
    });
    expect(readMobileModelSelection('text')).toBeNull();
  });

  it('uses the eligible local text route as classifier fallback', () => {
    useAppStore.setState({
      downloadedModels: [{
        id: 'local/text.gguf', name: 'Local', author: 'test', engine: 'llama',
        filePath: '/local/text.gguf', fileName: 'text.gguf', fileSize: 1,
        quantization: 'Q4', downloadedAt: new Date(0).toISOString(),
      }],
      activeModelId: 'local/text.gguf',
      lastTextModelId: 'local/text.gguf',
      settings: { ...useAppStore.getState().settings, classifierModelId: null },
    });

    const route = readMobileModelSelection('classifier');
    expect(route).not.toBeNull();
    expect(route).not.toBe(localRoute);
  });

  it('restores the exact remembered local text route after its remote server is removed', async () => {
    useAppStore.setState({
      downloadedModels: [{
        id: 'local/text.gguf', name: 'Local', author: 'test', engine: 'llama',
        filePath: '/local/text.gguf', fileName: 'text.gguf', fileSize: 1,
        quantization: 'Q4', downloadedAt: new Date(0).toISOString(),
      }],
      activeModelId: null,
      lastTextModelId: 'local/text.gguf',
    });
    useRemoteServerStore.setState({
      servers: [{
        id: 'server-1', name: 'Remote', endpoint: 'https://remote.test',
        provider: 'openai-compatible', createdAt: new Date(0).toISOString(),
      }],
      activeServerId: 'server-1',
      activeRemoteTextModelId: 'remote/gemini',
      discoveredModels: {
        'server-1': [{
          id: 'remote/gemini', name: 'Gemini', serverId: 'server-1',
          capabilities: {
            supportsVision: false, supportsToolCalling: true, supportsThinking: false,
          },
          lastUpdated: new Date(0).toISOString(),
        }],
      },
    });

    expect(readMobileModelSelection('text')).toBe(remoteRoute);
    await mobileModelSelectionService.remove({ modality: 'text', serverId: 'server-1' });
    expect(useAppStore.getState().activeModelId).toBe('local/text.gguf');
    expect(useRemoteServerStore.getState().activeServerId).toBeNull();
    expect(readMobileModelSelection('text')).toBe(localRoute);
  });
});
