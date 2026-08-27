import { activeModelService } from './activeModelService';
import { localDreamGeneratorService as onnxImageGeneratorService } from './localDreamGenerator';
import type { ActiveImageModel, ImageGenerationState } from './imageGenerationTypes';

/** The local engine's load step, extracted whole from imageGenerationService (the
 *  service is at its structural line budget). Behavior unchanged. */
export interface LocalLoadHost {
  updateState: (partial: Partial<ImageGenerationState>) => void;
  fail: (message: string, opts?: { cause?: unknown }) => void;
}

export interface LocalLoadRequest {
  activeImageModelId: string | null;
  activeImageModel: ActiveImageModel;
  desiredThreads: number;
  override?: boolean;
}

export async function ensureImageModelLoaded(
  host: LocalLoadHost,
  request: LocalLoadRequest,
): Promise<boolean> {
  const { activeImageModelId, activeImageModel } = request;
  const opts = { desiredThreads: request.desiredThreads, override: request.override };
  const isImageModelLoaded = await onnxImageGeneratorService.isModelLoaded();
  const loadedPath = await onnxImageGeneratorService.getLoadedModelPath();
  const loadedThreads = onnxImageGeneratorService.getLoadedThreads();
  const needsThreadReload =
    loadedThreads == null || loadedThreads !== opts.desiredThreads;
  if (
    isImageModelLoaded &&
    loadedPath === activeImageModel.modelPath &&
    !needsThreadReload
  )
    return true;
  if (!activeImageModelId) {
    host.fail('No image model selected');
    return false;
  }
  try {
    host.updateState({
      phase: 'loading',
      status: `Loading ${activeImageModel.name}...`,
    });
    await activeModelService.loadImageModel(
      activeImageModelId,
      undefined,
      opts.override ? { override: true } : undefined,
    );
    return true;
  } catch (error: any) {
    // Pass the TYPED error as `cause` — an OverridableMemoryError here is what lets
    // the failure card offer "Load Anyway". Stringifying it (as before) hid it.
    host.fail(`Failed to load image model: ${error?.message || 'Unknown error'}`, {
      cause: error,
    });
    return false;
  }
}
