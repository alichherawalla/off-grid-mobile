import type {
  GeneratedBinaryArtifact,
  GenerationAdapter,
  GenerationChunk,
  GenerationRequest,
} from '@offgrid/models';
import { useAppStore } from '../../stores/appStore';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { localDreamGeneratorService } from '../localDreamGenerator';
import { remoteMediaRuntime } from '../adapters/remote/mediaRuntime';

type PendingChunk = { value?: GenerationChunk; error?: unknown; done?: boolean };

function imageOperation(request: GenerationRequest) {
  if (request.operation?.type !== 'image') {
    throw new Error(`Image adapter cannot run ${request.operation?.type ?? 'text'} generation`);
  }
  return request.operation;
}

function localArtifact(result: {
  id: string;
  imagePath: string;
  width: number;
  height: number;
  seed: number;
}): GeneratedBinaryArtifact {
  return {
    id: result.id,
    mimeType: 'image/png',
    uri: `file://${result.imagePath}`,
    width: result.width,
    height: result.height,
    seed: result.seed,
  };
}

/** Convert native progress callbacks into the shared typed image stream. */
async function* localImageChunks(request: GenerationRequest): AsyncIterable<GenerationChunk> {
  const operation = imageOperation(request);
  const pending: PendingChunk[] = [];
  let wake: (() => void) | null = null;
  const push = (item: PendingChunk) => {
    pending.push(item);
    const listener = wake;
    wake = null;
    listener?.();
  };
  const abort = () => localDreamGeneratorService.cancelGeneration().catch(() => undefined);
  request.signal?.addEventListener('abort', abort, { once: true });
  const generation = localDreamGeneratorService.generateImage(
    {
      prompt: operation.prompt,
      negativePrompt: operation.negativePrompt,
      width: operation.width,
      height: operation.height,
      steps: operation.steps,
      guidanceScale: operation.guidanceScale,
      seed: operation.seed,
      previewInterval: operation.previewInterval,
      useOpenCL: useAppStore.getState().settings.imageUseOpenCL ?? true,
    },
    progress => push({
      value: { progress: { completed: progress.step, total: progress.totalSteps } },
    }),
    preview => push({
      value: {
        progress: {
          completed: preview.step,
          total: preview.totalSteps,
          preview: { mimeType: 'image/png', uri: `file://${preview.previewPath}` },
        },
      },
    }),
  ).then(result => {
    push({
      value: {
        output: { type: 'image', images: [localArtifact(result)] },
        finishReason: 'stop',
      },
    });
    push({ done: true });
  }).catch(error => push({ error }));

  try {
    for (;;) {
      if (!pending.length) await new Promise<void>(resolve => { wake = resolve; });
      const item = pending.shift();
      if (!item) continue;
      if (item.error) throw item.error;
      if (item.done) break;
      if (item.value) yield item.value;
    }
    await generation;
  } finally {
    request.signal?.removeEventListener('abort', abort);
  }
}

/** Execute the exact image route selected by the shared GenerationService. */
export function mobileImageGenerationAdapter(id: string): GenerationAdapter {
  return {
    id,
    async *generate(model, request): AsyncIterable<GenerationChunk> {
      const operation = imageOperation(request);
      if (model.source === 'local') {
        yield* localImageChunks(request);
        return;
      }
      const server = useRemoteServerStore.getState().servers.find(
        candidate => candidate.id === model.serverId,
      );
      if (!server) throw new Error('The selected remote image server is unavailable');
      const result = await remoteMediaRuntime.generateImage(
        server,
        {
          prompt: operation.prompt,
          size: `${operation.width ?? 512}x${operation.height ?? 512}`,
          model: model.id,
        },
        { signal: request.signal },
      );
      yield {
        output: {
          type: 'image',
          images: [{ mimeType: 'image/png', data: result.base64, uri: result.url }],
        },
        finishReason: 'stop',
      };
    },
    classifyError(error) {
      const message = error instanceof Error ? error.message : String(error);
      return /memory|unavailable|not ready|timeout|network/i.test(message)
        ? 'retryable'
        : 'fatal';
    },
  };
}
