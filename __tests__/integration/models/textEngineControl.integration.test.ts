/**
 * Native file facts flow through Mobile inventory into the Shared text-engine control plane.
 * A llama vision label without a projector must fail closed before native generation.
 */
import {
  localLiteRTInventoryAdapter,
  localLlamaInventoryAdapter,
  mobileInventoryAdapters,
} from '../../../src/services/modelServices/inventoryAdapters';
import { useAppStore } from '../../../src/stores';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import type { DownloadedModel } from '../../../src/types';
import { createDownloadedModel } from '../../utils/factories';

describe('Mobile text-engine inventory boundary', () => {
  afterEach(() => {
    useAppStore.setState({ downloadedModels: [] });
    useRemoteServerStore.setState({
      servers: [],
      activeServerId: null,
      activeRemoteTextModelId: null,
      discoveredModels: {},
      serverHealth: {},
    });
  });

  it('publishes llama vision only when the projector is present', async () => {
    const missing = createDownloadedModel({
      id: 'missing-projector',
      engine: 'llama',
      isVisionModel: true,
      mmProjPath: undefined,
    });
    const complete = {
      ...createDownloadedModel({ id: 'complete-vision', engine: 'llama', isVisionModel: true }),
      mmProjPath: '/models/mmproj.gguf',
    } as DownloadedModel;
    useAppStore.setState({ downloadedModels: [missing, complete] });

    const models = await localLlamaInventoryAdapter.listModels();
    expect(models.find(model => model.id === missing.id)?.capabilities.vision).toBe(false);
    expect(models.find(model => model.id === complete.id)?.capabilities.vision).toBe(true);
  });

  it('publishes bundled LiteRT vision and thinking capability facts', async () => {
    const model = createDownloadedModel({
      id: 'litert-gemma',
      engine: 'litert',
      liteRTVision: true,
      liteRTAudio: true,
    });
    useAppStore.setState({ downloadedModels: [model] });

    const [runtime] = await localLiteRTInventoryAdapter.listModels();
    expect(runtime.capabilities).toMatchObject({
      vision: true,
      audioInput: true,
      thinking: true,
    });
  });

  it('keeps undiscovered remote capabilities unknown', async () => {
    useRemoteServerStore.setState({
      servers: [{
        id: 'desktop',
        name: 'Desktop',
        endpoint: 'https://desktop.example.test/v1',
        provider: 'openai-compatible',
        createdAt: '2026-09-01',
        selections: { text: 'remote-text' },
      }],
      activeServerId: 'desktop',
      activeRemoteTextModelId: 'remote-text',
      discoveredModels: { desktop: [] },
    });
    const remote = mobileInventoryAdapters.find(
      adapter => adapter.id === 'mobile-remote-model-inventory',
    );

    const models = await remote!.listModels();
    const selected = models.find(model => model.id === 'remote-text');

    expect(selected?.capabilities).toEqual({
      textGeneration: true,
      streaming: true,
    });
    expect(selected?.capabilities).not.toHaveProperty('vision');
    expect(selected?.capabilities).not.toHaveProperty('tools');
    expect(selected?.capabilities).not.toHaveProperty('thinking');
  });
});
