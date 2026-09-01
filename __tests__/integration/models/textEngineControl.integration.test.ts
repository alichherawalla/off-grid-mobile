/**
 * Native file facts flow through Mobile inventory into the Shared text-engine control plane.
 * A llama vision label without a projector must fail closed before native generation.
 */
import {
  localLiteRTInventoryAdapter,
  localLlamaInventoryAdapter,
} from '../../../src/services/modelServices/inventoryAdapters';
import { useAppStore } from '../../../src/stores';
import type { DownloadedModel } from '../../../src/types';
import { createDownloadedModel } from '../../utils/factories';

describe('Mobile text-engine inventory boundary', () => {
  afterEach(() => {
    useAppStore.setState({ downloadedModels: [] });
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
});
