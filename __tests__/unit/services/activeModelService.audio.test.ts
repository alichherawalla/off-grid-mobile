import {
  activeModelService,
  modelApplication,
  resetModelApplication,
} from '../../harness/activeModelLifecycle';
import { useAppStore } from '../../../src/stores/appStore';
import { createDownloadedModel } from '../../utils/factories';

async function select(model: ReturnType<typeof createDownloadedModel> | null): Promise<void> {
  useAppStore.setState({downloadedModels: model ? [model] : []});
  await modelApplication().models.refresh();
  const outcome = await modelApplication().models.select({
    modality: 'text',
    modelId: model?.id ?? null,
  });
  expect(outcome.ok).toBe(true);
}

describe('Models facade audio-input capability', () => {
  beforeEach(async () => resetModelApplication());

  it('returns false when there is no active model', async () => {
    await select(null);
    expect(activeModelService.supportsAudioInput()).toBe(false);
  });

  it('projects audio input for a LiteRT audio model', async () => {
    await select(createDownloadedModel({
      id: 'audio-model',
      engine: 'litert',
      liteRTAudio: true,
    }));
    expect(activeModelService.supportsAudioInput()).toBe(true);
  });

  it('does not invent audio input for a LiteRT text-only model', async () => {
    await select(createDownloadedModel({
      id: 'text-model',
      engine: 'litert',
      liteRTAudio: false,
    }));
    expect(activeModelService.supportsAudioInput()).toBe(false);
  });

  it('does not infer audio input from a GGUF projector', async () => {
    await select(createDownloadedModel({
      id: 'vision-model',
      engine: 'llama',
      mmProjPath: '/models/mmproj.gguf',
    }));
    expect(activeModelService.supportsAudioInput()).toBe(false);
  });
});
