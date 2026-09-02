import {
  resolveImageGenerationSettings,
  type ImageApplicationFailure,
  type ImageGenerationApplicationPorts,
  type RuntimeModel,
} from '@offgrid/models';
import { Platform } from 'react-native';
import { useAppStore } from '../../stores/appStore';
import type { GeneratedImage } from '../../types';
import { generateId } from '../../utils/generateId';
import {
  isImageModelIncompleteError,
  isOverridableMemoryError,
} from '../../utils/modelLoadErrors';
import { mobileTextEngineControl } from './textEngineControl';
import { enhanceImagePrompt } from '../imagePromptEnhancement';
import { saveImageGenerationResult } from '../imageGenerationResult';
import type { ActiveImageModel } from '../imageGenerationTypes';
import { localDreamGeneratorService } from '../localDreamGenerator';
import { reportModelFailure } from '../modelFailureHandler';
import { executeMobileImageGeneration } from '../sharedImageGeneration';
import { refreshMobileModelServices } from './index';
import { mobileResidencyIntents } from './residencyIntents';
import {
  cancelActiveImageGenerationAtBoundary,
  ImageGenerationCancelError,
} from './imageGenerationAdapter';

function localModel(model: RuntimeModel): ActiveImageModel {
  const record = useAppStore.getState().downloadedImageModels.find(candidate => candidate.id === model.id);
  if (!record) throw new Error(`The selected image model is unavailable: ${model.name}`);
  return record;
}

function presentationModel(model: RuntimeModel): ActiveImageModel {
  return model.source === 'local'
    ? localModel(model)
    : {
        id: model.id,
        name: model.name,
        modelPath: model.serverId ?? model.adapterId,
        backend: 'remote',
      };
}

let executing = false;

/** Mobile platform boundary for the Shared image-generation application service. */
export function mobileImageGenerationApplicationPorts(): ImageGenerationApplicationPorts<
  GeneratedImage,
  GeneratedImage
> {
  return {
    async refreshInventory() {
      await refreshMobileModelServices();
    },
    createId: generateId,
    resolveSettings(request) {
      const settings = useAppStore.getState().settings;
      return {
        ...resolveImageGenerationSettings({
          platform: Platform.OS,
          request,
          settings: {
            steps: settings.imageSteps,
            guidanceScale: settings.imageGuidanceScale,
            width: settings.imageWidth,
            height: settings.imageHeight,
            threads: settings.imageThreads,
            useOpenCL: settings.imageUseOpenCL,
          },
        }),
        enhancePrompt: settings.enhanceImagePrompts,
      };
    },
    enhancePrompt(request, _signal, onStatus) {
      return enhanceImagePrompt(request, onStatus);
    },
    async inspectRuntime(model, settings) {
      const active = localModel(model);
      const loaded = await localDreamGeneratorService.isModelLoaded();
      const loadedIdentity = await localDreamGeneratorService.getLoadedModelPath();
      const loadedThreads = localDreamGeneratorService.getLoadedThreads();
      const wasWarmed = useAppStore.getState().warmedImageModels.includes(active.id);
      let hasKernelCache: boolean | undefined;
      if (settings.useOpenCL) {
        try {
          hasKernelCache = await localDreamGeneratorService.hasKernelCache(active.modelPath);
        } catch {
          // A probe failure is unknown, not a false first-run signal.
        }
      }
      return {
        loaded,
        loadedIdentity,
        desiredIdentity: active.modelPath,
        loadedThreads,
        wasWarmed,
        hasKernelCache,
      };
    },
    async ensureLoaded(model, input) {
      try {
        await mobileResidencyIntents.ensureImage(
          model.id,
          undefined,
          input.force ? { override: true } : undefined,
        );
      } catch (error) {
        // Preserve typed recovery errors so the application can offer the correct
        // memory override or re-download action. Give unknown native failures the
        // model-load context that the user needs instead of exposing a bare bridge error.
        if (isOverridableMemoryError(error) || isImageModelIncompleteError(error)) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load image model: ${detail}`);
      }
    },
    async execute(input, onProgress) {
      executing = true;
      try {
        return await executeMobileImageGeneration(
          {
            prompt: input.prompt,
            routeId: input.model.routeId,
            negativePrompt: input.request.negativePrompt ?? '',
            steps: input.settings.steps,
            guidanceScale: input.settings.guidanceScale,
            seed: input.request.seed,
            width: input.settings.width,
            height: input.settings.height,
            previewInterval: input.settings.previewInterval,
          },
          {
            signal: input.signal,
            onProgress: (completed, total, preview) => onProgress({
              step: completed,
              totalSteps: total,
              previewUri: preview?.uri ? `${preview.uri}?t=${Date.now()}` : undefined,
            }),
          },
        );
      } finally {
        executing = false;
      }
    },
    persist(input) {
      return saveImageGenerationResult(input.output, {
        params: input.request,
        activeImageModel: presentationModel(input.model),
        messageId: input.messageId,
        steps: input.settings.steps,
        guidanceScale: input.settings.guidanceScale,
        useOpenCL: input.settings.useOpenCL,
        startTime: input.startedAt,
        isRemote: input.model.source === 'remote',
      });
    },
    async cancelBoundary() {
      try {
        if (executing) await cancelActiveImageGenerationAtBoundary();
        else await mobileTextEngineControl.stopActive();
      } catch (error) {
        const failure = error instanceof ImageGenerationCancelError
          ? error
          : new ImageGenerationCancelError(error);
        reportModelFailure('image', failure, {
          id: 'image-generation-cancel',
          title: 'Image generation could not stop',
          message: failure.message,
        });
        throw failure;
      }
    },
    async ejectForRetry() {
      await mobileResidencyIntents.ejectAll();
    },
    isForceLoadError: isOverridableMemoryError,
    onFailure(failure: ImageApplicationFailure, actions) {
      reportModelFailure('image', failure.cause, {
        message: failure.message,
        onRetry: actions.retry,
        onLoadAnyway: failure.forceLoadAllowed ? actions.forceLoad : undefined,
      });
    },
  };
}
