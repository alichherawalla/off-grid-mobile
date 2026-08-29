import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AutoSetupScreen } from '../../../src/screens/AutoSetupScreen';
import {
  loadAutoSetupCompatibleCatalog,
  type AutoSetupCatalogBoundaries,
} from '../../../src/services/autoSetupCatalog';
import {
  completeAutoSetupPlan,
  startAutoSetupPlan,
  type AutoSetupDownloadBoundaries,
} from '../../../src/services/autoSetupService';
import { modelDownloadService } from '../../../src/services/modelDownloadService';
import type {
  DownloadProvider,
  ModelDownload,
  ModelDownloadType,
} from '../../../src/services/modelDownloadService/types';
import { uniformDownloadId } from '../../../src/services/modelDownloadService/uniformId';
import { useAppStore } from '../../../src/stores';

const MB = 1024 * 1024;
const parameterCount = (modelId: string): number => {
  if (modelId.includes('9B')) return 9;
  if (modelId.includes('E4B')) return 4;
  if (modelId.includes('2.2B')) return 2.2;
  if (modelId.includes('2B') || modelId.includes('E2B')) return 2;
  if (modelId.includes('0.8B')) return 0.8;
  return 1;
};
const capabilities = {
  cancel: true,
  retry: true,
  remove: true,
  resumable: true,
  determinateProgress: true,
};

class NativeDownloadBoundary implements DownloadProvider {
  private downloads: ModelDownload[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(readonly modelType: ModelDownloadType) {}

  async list(): Promise<ModelDownload[]> {
    return this.downloads;
  }

  start(id: string, name: string, sizeBytes: number): Promise<void> {
    this.downloads = [{
      id: uniformDownloadId(this.modelType, id),
      modelType: this.modelType,
      name,
      sizeBytes,
      bytesDownloaded: sizeBytes,
      progress: 1,
      status: 'completed',
      capabilities,
    }];
    this.listeners.forEach(listener => listener());
    return Promise.resolve();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async cancel(): Promise<void> {}
  async retry(): Promise<void> {}
  async remove(): Promise<void> {
    this.downloads = [];
    this.listeners.forEach(listener => listener());
  }
}

const catalogBoundaries: AutoSetupCatalogBoundaries = {
  totalMemoryGB: () => 12,
  fetchTextFiles: async models => Object.fromEntries(models.map(model => {
    const params = parameterCount(model.id);
    return [model.id, [{
      name: `${params}b.gguf`,
      size: params * 100 * MB,
      quantization: 'Q4_K_M',
      downloadUrl: `https://models.test/${params}b.gguf`,
    }]];
  })),
  imageRecommendation: async () => ({
    compatibleBackends: ['coreml'],
    recommendedModels: ['balanced image'],
    recommendedBackend: 'coreml',
    bannerText: 'Core ML is ready.',
  }),
  imageModels: async () => [
    {
      id: 'image-lean',
      name: 'Lean image',
      description: 'Lean image',
      size: 100 * MB,
      downloadUrl: 'https://models.test/image-lean',
      style: 'general',
      backend: 'coreml',
    },
    {
      id: 'image-balanced',
      name: 'Balanced image',
      description: 'Balanced image',
      size: 200 * MB,
      downloadUrl: 'https://models.test/image-balanced',
      style: 'general',
      backend: 'coreml',
    },
    {
      id: 'image-extreme',
      name: 'Extreme image',
      description: 'Extreme image',
      size: 300 * MB,
      downloadUrl: 'https://models.test/image-extreme',
      style: 'general',
      backend: 'coreml',
    },
  ],
};

describe('Auto Setup release journey', () => {
  const navigation = { navigate: jest.fn(), replace: jest.fn() } as any;
  const textDownloads = new NativeDownloadBoundary('text');
  const imageDownloads = new NativeDownloadBoundary('image');
  const speechDownloads = new NativeDownloadBoundary('stt');
  let unregister: Array<() => void> = [];

  const downloadBoundaries: AutoSetupDownloadBoundaries = {
    startText: async (modelId, file) =>
      textDownloads.start(`${modelId}/${file.name}`, file.name, file.size),
    startImage: async model =>
      imageDownloads.start(model.id, model.name, model.size),
    startSpeech: async modelId =>
      speechDownloads.start(modelId, modelId, 1 * MB),
  };

  const runtime = {
    loadCatalog: () => loadAutoSetupCompatibleCatalog(catalogBoundaries),
    startPlan: (
      plan: Parameters<typeof startAutoSetupPlan>[0],
      completed: ReadonlySet<string> = new Set(),
    ) => startAutoSetupPlan(plan, completed, downloadBoundaries),
    completePlan: completeAutoSetupPlan,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({ activeModelId: null });
    unregister = [
      modelDownloadService.register(textDownloads),
      modelDownloadService.register(imageDownloads),
      modelDownloadService.register(speechDownloads),
    ];
  });

  afterEach(async () => {
    await Promise.all([
      textDownloads.remove(),
      imageDownloads.remove(),
      speechDownloads.remove(),
    ]);
    unregister.forEach(dispose => dispose());
  });

  it('selects a device-fit plan, starts all model downloads, and activates it', async () => {
    const ui = render(
      <AutoSetupScreen navigation={navigation} runtime={runtime} />,
    );
    await waitFor(() =>
      expect(ui.getByTestId('auto-setup-plan-balanced')).toBeTruthy(),
    );

    expect(ui.getAllByText('INCLUDES')).toHaveLength(1);
    expect(ui.getByText('Gemma 4 E4B')).toBeTruthy();
    fireEvent.press(ui.getByTestId('auto-setup-plan-extreme'));
    expect(ui.getByText('Qwen 3.5 9B')).toBeTruthy();
    expect(ui.queryByText('Gemma 4 E4B')).toBeNull();

    fireEvent.press(ui.getByTestId('auto-setup-download'));
    await waitFor(() =>
      expect(ui.getByTestId('auto-setup-continue')).toBeTruthy(),
    );
    expect((await modelDownloadService.list()).map(item => item.modelType))
      .toEqual(expect.arrayContaining(['text', 'image', 'stt']));

    fireEvent.press(ui.getByTestId('auto-setup-continue'));
    expect(useAppStore.getState().activeModelId).toContain(
      'unsloth/Qwen3.5-9B-GGUF',
    );
    expect(navigation.replace).toHaveBeenCalledWith('Main');
  });

  it('keeps manual model and remote server setup in Advanced Setup', async () => {
    const ui = render(
      <AutoSetupScreen navigation={navigation} runtime={runtime} />,
    );
    await waitFor(() =>
      expect(ui.getByTestId('auto-setup-advanced')).toBeTruthy(),
    );
    fireEvent.press(ui.getByTestId('auto-setup-advanced'));
    expect(navigation.navigate).toHaveBeenCalledWith('AdvancedSetup');
  });
});
