import { useRemoteServerStore } from '../stores';
import type { GeneratedImage, RemoteModel, RemoteServer } from '../types';
import logger from '../utils/logger';
import {
  completedImageGenerationState,
  saveImageGenerationResult,
} from './imageGenerationResult';
import type { GenerateImageParams, ImageGenerationState } from './imageGenerationTypes';
import { remoteImageGeneratorService } from './remoteImageGenerator';

/**
 * The remote half of image generation, kept out of imageGenerationService so the
 * service stays within its structural budget: resolving whether a remote engine
 * is selected, and running a generation against it through the same phase
 * machine, save path and chat attach as the local engine.
 */

export interface RemoteImageEngine {
  model: RemoteModel;
  server: RemoteServer;
}

/** The store's selection is the single owner of which engine runs a request.
 *  null = no remote image model selected (or its server record is gone). */
export function resolveRemoteImageEngine(): RemoteImageEngine | null {
  const store = useRemoteServerStore.getState();
  const model = store.getActiveRemoteImageModel();
  if (!model) return null;
  const server = store.getServerById(model.serverId);
  return server ? { model, server } : null;
}

export interface RemoteRunHost {
  updateState: (partial: Partial<ImageGenerationState>) => void;
  resetState: () => void;
  fail: (message: string) => void;
  isCancelRequested: () => boolean;
}

export interface RemoteRunOptions {
  params: GenerateImageParams;
  enhancedPrompt: string;
  remote: RemoteImageEngine;
  messageId: string | null;
  steps: number;
  guidanceScale: number;
  imageWidth: number;
  imageHeight: number;
}

/** Same contract as the local runner: resolves the saved GeneratedImage, or null
 *  after cancel/failure (the host's state already reflects which). The server may
 *  run its own prompt-enhancement pass per its settings. */
export async function runRemoteGenerationAndSave(
  host: RemoteRunHost,
  opts: RemoteRunOptions,
): Promise<GeneratedImage | null> {
  const { params, enhancedPrompt, remote, steps, guidanceScale, imageWidth, imageHeight } = opts;
  host.updateState({
    phase: 'generating',
    status: `Generating on ${remote.server.name}...`,
  });
  const startTime = Date.now();
  try {
    const result = await remoteImageGeneratorService.generateImage(
      {
        endpoint: remote.server.endpoint,
        apiKey: remote.server.apiKey,
        model: remote.model.id,
        prompt: enhancedPrompt,
        negativePrompt: params.negativePrompt,
        steps,
        guidanceScale,
        seed: params.seed,
        width: imageWidth,
        height: imageHeight,
      },
      progress => {
        if (host.isCancelRequested()) return;
        if (typeof progress.step === 'number' && typeof progress.total === 'number') {
          const displayStep = Math.min(progress.step, progress.total);
          host.updateState({
            progress: { step: displayStep, totalSteps: progress.total },
            status: `Generating on ${remote.server.name} (${displayStep}/${progress.total})...`,
          });
        }
      },
    );
    if (host.isCancelRequested() || !result?.imagePath) {
      host.resetState();
      return null;
    }
    host.updateState(completedImageGenerationState(result));
    return saveImageGenerationResult(result, {
      params,
      activeImageModel: {
        id: remote.model.id,
        name: remote.model.name,
        modelPath: '',
      },
      messageId: opts.messageId,
      steps,
      guidanceScale,
      useOpenCL: false,
      startTime,
    });
  } catch (error: any) {
    const message = error?.message || 'Image generation failed';
    if (message.includes('cancelled')) {
      host.resetState();
    } else {
      logger.error('[ImageGeneration] Remote generation error:', error);
      host.fail(message);
    }
    return null;
  }
}
