import { useAppStore, useChatStore } from '../stores';
import type { GeneratedImage } from '../types';
import { buildImageGenMeta, scheduleImageSharePrompt } from './imageGenerationHelpers';
import type {
  ActiveImageModel,
  GenerateImageParams,
  ImageGenerationState,
} from './imageGenerationTypes';

export function completedImageGenerationState(
  result: GeneratedImage,
): Partial<ImageGenerationState> {
  return {
    phase: 'done',
    progress: null,
    status: null,
    previewPath: null,
    result,
    error: null,
  };
}

export function saveImageGenerationResult(
  result: GeneratedImage,
  input: {
    params: GenerateImageParams;
    activeImageModel: ActiveImageModel;
    messageId: string | null;
    steps: number;
    guidanceScale: number;
    useOpenCL: boolean;
    startTime: number;
    isRemote?: boolean;
  },
): GeneratedImage {
  const { params, activeImageModel } = input;
  result.modelId = activeImageModel.id;
  if (params.conversationId) result.conversationId = params.conversationId;
  const appStore = useAppStore.getState();
  appStore.addGeneratedImage(result);
  if (!input.isRemote) appStore.markImageModelWarmed(activeImageModel.id);
  appStore.completeChecklistStep('triedImageGen');
  scheduleImageSharePrompt();

  if (params.conversationId) {
    useChatStore.getState().addMessage(params.conversationId, {
      role: 'assistant',
      content: `Generated image for: "${params.prompt}"`,
      ...(input.messageId ? { uuid: input.messageId } : {}),
      attachments: [
        {
          id: result.id,
          type: 'image',
          uri: `file://${result.imagePath}`,
          width: result.width,
          height: result.height,
        },
      ],
      generationTimeMs: Date.now() - input.startTime,
      generationMeta: buildImageGenMeta(activeImageModel, {
        steps: input.steps,
        guidanceScale: input.guidanceScale,
        result,
        useOpenCL: input.useOpenCL,
      }),
    });
  }
  return result;
}
