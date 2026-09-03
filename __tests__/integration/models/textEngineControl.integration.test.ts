/**
 * Native file facts flow through Mobile inventory into the Shared text-engine control plane.
 * A llama vision label without a projector must fail closed before native generation.
 */
import { mobileWorkspace } from '../../../src/services/modelServices/workspace';
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
    });
    // Remote routes come from the workspace's own inventory adapter: one per selected model.
    const models = await mobileWorkspace.refresh().then(() => mobileWorkspace.inventory('text'));
    const selected = models.find(model => model.id === 'remote-text');

    // Shared projects a remote route's capabilities; what a server never declared stays unknown
    // (absent), it is not guessed.
    expect(selected?.capabilities).toMatchObject({
      textGeneration: true,
      streaming: true,
    });
    expect(selected?.capabilities).not.toHaveProperty('tools');
    expect(selected?.capabilities).not.toHaveProperty('thinking');
  });
});
