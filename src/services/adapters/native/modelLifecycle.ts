import { useModelResidencyStore } from '../../../stores/modelResidencyStore';
import { hardwareService } from '../../hardware';
import { llmService } from '../../llm';
import { liteRTService } from '../../litert';
import { localDreamGeneratorService as imageEngine } from '../../localDreamGenerator';
import { ImageModelIncompleteError } from '../../modelLoadErrors';
import { useAppStore } from '../../../stores/appStore';
import { activeLocalModelId } from '../../modelServices/activeRoute';
import { validateImageModelDir } from '../../../utils/imageModelIntegrity';
import {
  checkImageHardwareSupport,
  doLoadImageModel,
  doLoadTextModel,
} from './modelLoaders';

type NativeLifecycleListener = () => void;

/** Raw native engine lifecycle. Shared residency must admit a model before calling load. */
/**
 * How long one native load may take before it is abandoned. The ONE copy on the phone; the rule
 * has no shared owner yet (a `modelLoadTimeoutMs(modality)` in @offgrid/models/runtime would replace it).
 */
export function mobileModelLoadTimeoutMs(modality: 'text' | 'image'): number {
  return modality === 'text' ? 120_000 : 180_000;
}

class NativeModelLifecycle {
  private readonly listeners = new Set<NativeLifecycleListener>();
  private readonly loading = { text: false, image: false };
  private loadedTextModelId: string | null = null;
  private loadedImageModelId: string | null = null;
  private loadedImageModelThreads: number | null = null;
  private textLoadPromise: Promise<void> | null = null;
  private imageLoadPromise: Promise<void> | null = null;

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: NativeLifecycleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): {
    loadedTextModelId: string | null;
    loadedImageModelId: string | null;
    textIsLoaded: boolean;
    imageIsLoaded: boolean;
    loading: { text: boolean; image: boolean };
  } {
    return {
      loadedTextModelId: this.loadedTextModelId,
      loadedImageModelId: this.loadedImageModelId,
      textIsLoaded: llmService.isModelLoaded() || liteRTService.isModelLoaded(),
      imageIsLoaded: this.loadedImageModelId != null,
      loading: { ...this.loading },
    };
  }

  supportsAudioInput(): boolean {
    const store = useAppStore.getState();
    const activeTextId = activeLocalModelId('text');
    const model = store.downloadedModels.find(candidate => candidate.id === activeTextId);
    if (!model) return false;
    return model.engine === 'litert'
      ? liteRTService.supportsAudio()
      : llmService.isModelLoaded() && !!llmService.getMultimodalSupport()?.audio;
  }

  private textIsCurrent(modelId: string): boolean {
    if (this.loadedTextModelId !== modelId) return false;
    const model = useAppStore.getState().downloadedModels.find(candidate => candidate.id === modelId);
    return model?.engine === 'litert'
      ? liteRTService.isModelLoaded()
      : llmService.isModelLoaded();
  }

  async loadTextModel(
    modelId: string,
    timeoutMs = mobileModelLoadTimeoutMs('text'),
    override = false,
  ): Promise<void> {
    const store = useAppStore.getState();
    if (this.textIsCurrent(modelId)) {
      return;
    }
    const model = store.downloadedModels.find(candidate => candidate.id === modelId);
    if (!model) throw new Error('Model not found');
    this.loading.text = true;
    this.changed();
    this.textLoadPromise = doLoadTextModel({
      model,
      modelId,
      store,
      timeoutMs,
      override,
      loadedTextModelId: this.loadedTextModelId,
      onLoaded: id => {
        this.loadedTextModelId = id;
        useModelResidencyStore.getState().setLoadedTextModelId(id);
        useModelResidencyStore.getState().setTextModelEvicted(false);
      },
      onError: () => {
        this.loadedTextModelId = null;
        useModelResidencyStore.getState().setLoadedTextModelId(null);
      },
      onFinally: () => {
        this.loading.text = false;
        this.textLoadPromise = null;
        this.changed();
      },
    });
    await this.textLoadPromise;
  }

  async unloadTextModel(keepSelection = false): Promise<void> {
    if (this.textLoadPromise) await this.textLoadPromise;
    const loadedEngines = [llmService, liteRTService].filter(
      engine => engine.isModelLoaded(),
    );
    const isLoaded = loadedEngines.length > 0;
    if (!activeLocalModelId('text') && !this.loadedTextModelId && !isLoaded) return;
    this.loading.text = true;
    this.changed();
    try {
      for (const engine of loadedEngines) await engine.unloadModel();
      this.loadedTextModelId = null;
      const residency = useModelResidencyStore.getState();
      residency.setLoadedTextModelId(null);
      residency.setTextModelEvicted(keepSelection && isLoaded);
    } finally {
      this.loading.text = false;
      this.changed();
    }
  }

  async loadImageModel(modelId: string, timeoutMs = mobileModelLoadTimeoutMs('image')): Promise<void> {
    await hardwareService.getDeviceInfo();
    const store = useAppStore.getState();
    const model = store.downloadedImageModels.find(candidate => candidate.id === modelId);
    if (!model) throw new Error('Model not found');
    const imageThreads = store.settings?.imageThreads ?? 4;
    const needsThreadReload = this.loadedImageModelId === modelId &&
      this.loadedImageModelThreads !== imageThreads;
    if (this.loadedImageModelId === modelId &&
      await imageEngine.isModelLoaded() && !needsThreadReload) {
      return;
    }
    if (model.backend === 'mnn' || model.backend === 'qnn') {
      const integrity = await validateImageModelDir(model.modelPath, model.backend);
      if (!integrity.complete) throw new ImageModelIncompleteError(integrity.missing);
    }
    const support = await checkImageHardwareSupport(modelId, model);
    if (!support.canLoad) throw new Error(support.error);
    this.loading.image = true;
    this.changed();
    this.imageLoadPromise = doLoadImageModel({
      model,
      modelId,
      imageThreads,
      needsThreadReload,
      cpuOnly: false,
      preferGpu: hardwareService.preferGpuForImageGen(),
      store,
      timeoutMs,
      loadedImageModelId: this.loadedImageModelId,
      onLoaded: (id, threads) => {
        this.loadedImageModelId = id;
        this.loadedImageModelThreads = threads;
      },
      onError: () => {
        this.loadedImageModelId = null;
        this.loadedImageModelThreads = null;
      },
      onFinally: () => {
        this.loading.image = false;
        this.imageLoadPromise = null;
        this.changed();
      },
    });
    await this.imageLoadPromise;
  }

  imageNeedsReload(modelId: string): boolean {
    return this.loadedImageModelId === modelId &&
      this.loadedImageModelThreads !== (useAppStore.getState().settings?.imageThreads ?? 4);
  }

  async unloadImageModel(_keepSelection = false): Promise<void> {
    if (this.imageLoadPromise) await this.imageLoadPromise;
    const isLoaded = await imageEngine.isModelLoaded();
    if (!activeLocalModelId('image') && !this.loadedImageModelId && !isLoaded) return;
    this.loading.image = true;
    this.changed();
    try {
      if (isLoaded) await imageEngine.unloadModel();
      this.loadedImageModelId = null;
      this.loadedImageModelThreads = null;
    } finally {
      this.loading.image = false;
      this.changed();
    }
  }

  async syncWithNativeState(): Promise<void> {
    const textLoaded = llmService.isModelLoaded() || liteRTService.isModelLoaded();
    if (!textLoaded) {
      this.loadedTextModelId = null;
      useModelResidencyStore.getState().setLoadedTextModelId(null);
    } else if (!this.loadedTextModelId && activeLocalModelId('text')) {
      this.loadedTextModelId = activeLocalModelId('text');
      useModelResidencyStore.getState().setLoadedTextModelId(this.loadedTextModelId);
    }
    const imageLoaded = await imageEngine.isModelLoaded();
    if (!imageLoaded) {
      this.loadedImageModelId = null;
      this.loadedImageModelThreads = null;
    } else if (!this.loadedImageModelId && activeLocalModelId('image')) {
      this.loadedImageModelId = activeLocalModelId('image');
    }
    this.changed();
  }
}

export const nativeModelLifecycle = new NativeModelLifecycle();
