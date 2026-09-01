import { Platform } from 'react-native';
import type { GeneratedImage } from '../types';
import { useAppStore } from '../stores';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { generateId } from '../utils/generateId';
import {
  DEFAULT_IMAGE_GUIDANCE,
  SWEET_SPOT_SIZE,
  defaultImageSteps,
} from '../utils/imageGenAdvice';
import type { GenerateImageParams, ImageGenerationState } from './imageGenerationTypes';
import {
  completedImageGenerationState,
  saveImageGenerationResult,
} from './imageGenerationResult';
import { executeMobileImageGeneration } from './sharedImageGeneration';

interface RemoteImageGenerationDeps {
  updateState: (state: Partial<ImageGenerationState>) => void;
  fail: (message: string) => null;
  isCancelled: () => boolean;
  setRequest: (controller: AbortController | null) => void;
}

/** Preserve Mobile's remote image lifecycle while shared owns route and execution. */
export async function runRemoteImageGeneration(
  params: GenerateImageParams,
  deps: RemoteImageGenerationDeps,
): Promise<GeneratedImage | null> {
  const server = useRemoteServerStore.getState().getActiveRemoteMediaServer('image');
  const modelId = server?.selections?.image;
  if (!server || !modelId) return deps.fail('No remote image model is configured');
  const settings = useAppStore.getState().settings;
  const width = Math.max(SWEET_SPOT_SIZE, settings.imageWidth || SWEET_SPOT_SIZE);
  const height = Math.max(SWEET_SPOT_SIZE, settings.imageHeight || SWEET_SPOT_SIZE);
  const steps = params.steps || settings.imageSteps || defaultImageSteps(Platform.OS);
  const guidanceScale = params.guidanceScale
    || settings.imageGuidanceScale
    || DEFAULT_IMAGE_GUIDANCE;
  const messageId = params.conversationId ? generateId() : null;
  const startTime = Date.now();
  deps.updateState({
    phase: 'generating',
    prompt: params.prompt,
    conversationId: params.conversationId || null,
    messageId,
    status: `Creating image on ${server.name}...`,
    previewPath: null,
    progress: { step: 0, totalSteps: 1 },
    error: null,
    result: null,
  });
  try {
    const result = await executeMobileImageGeneration(
      {
        prompt: params.prompt,
        negativePrompt: params.negativePrompt,
        width,
        height,
        steps,
        guidanceScale,
        seed: params.seed,
        previewInterval: params.previewInterval ?? 2,
      },
      { setRequest: deps.setRequest },
    );
    if (deps.isCancelled()) return null;
    deps.updateState(completedImageGenerationState(result));
    return saveImageGenerationResult(result, {
      params,
      activeImageModel: {
        id: modelId,
        name: `${server.name} / ${modelId}`,
        modelPath: server.endpoint,
        backend: 'remote',
      },
      messageId,
      steps,
      guidanceScale,
      useOpenCL: false,
      startTime,
      isRemote: true,
    });
  } catch (error) {
    if (deps.isCancelled()) return null;
    return deps.fail(error instanceof Error ? error.message : 'Remote image generation failed');
  }
}
