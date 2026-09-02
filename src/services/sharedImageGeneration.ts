import RNFS from 'react-native-fs';
import type { GeneratedBinaryArtifact } from '@offgrid/models';
import type { GeneratedImage } from '../types';
import { generateId } from '../utils/generateId';
import {
  mobileGenerationService,
  refreshMobileModelServices,
} from './modelServices';

export interface SharedImageGenerationInput {
  prompt: string;
  routeId?: string;
  negativePrompt?: string;
  steps: number;
  guidanceScale: number;
  seed?: number;
  width: number;
  height: number;
  previewInterval: number;
}

interface SharedImageGenerationOptions {
  onProgress?: (
    completed: number,
    total: number,
    preview?: GeneratedBinaryArtifact,
  ) => void;
  signal: AbortSignal;
}

/** Adapt one shared typed image result to Mobile's persisted GeneratedImage record. */
export async function executeMobileImageGeneration(
  input: SharedImageGenerationInput,
  options: SharedImageGenerationOptions,
): Promise<GeneratedImage> {
  await refreshMobileModelServices();
  const { routeId, ...operation } = input;
  const result = await mobileGenerationService.generate(
      {
        operation: { type: 'image', ...operation },
        routeId,
        allowFallback: false,
        signal: options.signal,
      },
      {
        chunk: chunk => {
          if (chunk.progress) {
            options.onProgress?.(
              chunk.progress.completed,
              chunk.progress.total,
              chunk.progress.preview,
            );
          }
        },
      },
    );
    if (result.output.type !== 'image' || !result.output.images.length) {
      throw new Error('Image generation returned no image');
    }
    const artifact = result.output.images[0];
    const imageId = artifact.id ?? generateId();
    let imagePath: string;
    let fileName: string | undefined;
    if (artifact.data) {
      fileName = `${imageId}.png`;
      const directory = `${RNFS.DocumentDirectoryPath}/generated_images`;
      imagePath = `${directory}/${fileName}`;
      await RNFS.mkdir(directory);
      await RNFS.writeFile(imagePath, artifact.data, 'base64');
    } else if (artifact.uri?.startsWith('file://')) {
      imagePath = artifact.uri.slice('file://'.length);
    } else {
      throw new Error('Image generation returned no local image data');
    }
  return {
      id: imageId,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      imagePath,
      fileName,
      width: artifact.width ?? input.width,
      height: artifact.height ?? input.height,
      steps: input.steps,
      seed: artifact.seed ?? input.seed ?? 0,
      modelId: result.model.id,
      createdAt: new Date().toISOString(),
  };
}
