import {
  ImageGenerationApplicationService,
  isImageApplicationInFlight,
  type ImageApplicationSnapshot,
} from '@offgrid/models';
import { useAppStore } from '../stores/appStore';
import type { GeneratedImage } from '../types';
import logger from '../utils/logger';
import { imagePhaseTransitionLog } from './imageGenerationHelpers';
import {
  type GenerateImageParams,
  type ImageGenerationListener,
  type ImageGenerationState,
} from './imageGenerationTypes';
import { mobileImageGenerationApplicationPorts } from './modelServices/imageGenerationApplication';
import { mobileLLMService } from './modelServices/mobileLLMService';

export { isInFlight } from './imageGenerationTypes';
export type { ImageGenPhase, ImageGenerationState } from './imageGenerationTypes';

function project(snapshot: ImageApplicationSnapshot<GeneratedImage>): ImageGenerationState {
  return {
    phase: snapshot.phase,
    isGenerating: isImageApplicationInFlight(snapshot.phase),
    progress: snapshot.progress && {
      step: snapshot.progress.step,
      totalSteps: snapshot.progress.totalSteps,
    },
    status: snapshot.status,
    previewPath: snapshot.previewUri,
    prompt: snapshot.prompt,
    conversationId: snapshot.conversationId,
    messageId: snapshot.messageId,
    error: snapshot.error,
    result: snapshot.result,
  };
}

class ImageGenerationService {
  private readonly application = new ImageGenerationApplicationService(
    mobileLLMService,
    mobileImageGenerationApplicationPorts(),
  );
  private readonly listeners = new Set<ImageGenerationListener>();
  private previousPhase: ImageGenerationState['phase'] = 'idle';

  constructor() {
    this.application.onChange(snapshot => {
      const state = project(snapshot);
      if (state.phase !== this.previousPhase) {
        logger.log(imagePhaseTransitionLog(this.previousPhase, state));
        this.previousPhase = state.phase;
      }
      const appStore = useAppStore.getState();
      appStore.setIsGeneratingImage(state.isGenerating);
      appStore.setImageGenerationProgress(state.progress);
      appStore.setImageGenerationStatus(state.status);
      appStore.setImagePreviewPath(state.previewPath);
      for (const listener of this.listeners) listener(state);
    });
  }

  getState(): ImageGenerationState {
    return project(this.application.status());
  }

  isGeneratingFor(conversationId: string): boolean {
    const state = this.getState();
    return state.isGenerating && state.conversationId === conversationId;
  }

  subscribe(listener: ImageGenerationListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  generateImage(
    params: GenerateImageParams,
    opts?: { override?: boolean },
  ): Promise<GeneratedImage | null> {
    return this.application.start(params, { force: opts?.override });
  }

  async cancelGeneration(): Promise<void> {
    await this.application.cancel();
  }
}

export const imageGenerationService = new ImageGenerationService();
