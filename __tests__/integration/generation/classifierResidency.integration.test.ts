import {
  GenerationService,
  LLMService,
  ModelResidencyManager,
  type ModelInventoryAdapter,
  type ModelSelectionStore,
} from '@offgrid/models';
import { reconcileMobileSidecarAdapters } from '../../../src/services/modelServices/sidecarGenerationAdapter';
import { nativeModelLifecycle } from '../../../src/services/adapters/native/modelLifecycle';

const mockLifecycleEvents: string[] = [];

jest.mock('../../../src/services/adapters/native/modelLifecycle', () => ({
  nativeModelLifecycle: {
    loadTextModel: jest.fn(async (modelId: string) => {
      mockLifecycleEvents.push(`load:${modelId}`);
    }),
    unloadTextModel: jest.fn(async () => {
      mockLifecycleEvents.push('unload:classifier');
    }),
  },
}));

jest.mock('../../../src/services/llm', () => ({
  llmService: {
    generateResponse: jest.fn(async (_messages, options) => {
      options.onStream({ content: 'YES' });
    }),
    stopGeneration: jest.fn(async () => undefined),
  },
}));

jest.mock('../../../src/services/adapters/native/embeddingRuntimeAdapter', () => ({
  embeddingService: {
    load: jest.fn(async () => undefined),
    unload: jest.fn(async () => undefined),
    embedBatch: jest.fn(async () => []),
  },
}));

describe('Mobile classifier residency integration', () => {
  test('shared generation evicts the text runtime and owns classifier cleanup', async () => {
    mockLifecycleEvents.length = 0;
    let selectedRoute: string | null = null;
    const selections: ModelSelectionStore = {
      read: modality => modality === 'classifier' ? selectedRoute : null,
      write: async (_modality, routeId) => {
        selectedRoute = routeId;
      },
    };
    const models = new LLMService(selections);
    const inventory: ModelInventoryAdapter = {
      id: 'classifier-inventory',
      async listModels() {
        return [{
          id: 'classifier.gguf',
          name: 'Classifier',
          kind: 'classifier',
          modality: 'classifier',
          source: 'local',
          adapterId: 'mobile-classifier-sidecar',
          capabilities: { classification: true },
          installed: true,
          ready: true,
          loaded: false,
          residentSizeMB: 128,
          residencyKey: 'mobile:text-engine',
          residencyMode: 'operation',
        }];
      },
    };
    models.registerAdapter(inventory);
    const routes = await models.refresh();
    const routeId = routes[0]?.routeId;
    if (!routeId) throw new Error('The classifier fixture needs a canonical route.');
    await models.select('classifier', routeId);

    const residency = new ModelResidencyManager({
      current: () => ({ totalMB: 8_192, availableMB: 6_000, platform: 'mobile' }),
    });
    residency.register({
      key: 'text:active-route',
      modelId: 'active-text.gguf',
      type: 'text',
      sizeMB: 512,
      residencyKey: 'mobile:text-engine',
    }, async () => {
      mockLifecycleEvents.push('unload:text');
    });

    const generation = new GenerationService(models, residency);
    const registrations = new Map<string, () => void>();
    reconcileMobileSidecarAdapters(generation, models, registrations);

    const result = await generation.generate({
      operation: { type: 'classifier', input: 'A watercolor fox', labels: ['image', 'text'] },
      routeId,
      allowFallback: false,
    });

    expect(result.output).toEqual({
      type: 'classification',
      labels: [
        { label: 'image', score: 1 },
        { label: 'text', score: 0 },
      ],
    });
    expect(mockLifecycleEvents).toEqual([
      'unload:text',
      'load:classifier.gguf',
      'unload:classifier',
    ]);
    expect(nativeModelLifecycle.loadTextModel).toHaveBeenCalledWith(
      'classifier.gguf',
      120_000,
      false,
      true,
    );
    expect(residency.getResidents()).toEqual([]);
  });
});
