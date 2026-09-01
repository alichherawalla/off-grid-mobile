import type {
  GenerationAdapter,
  GenerationChunk,
  GenerationRequest,
  LLMService,
  RuntimeModel,
} from '@offgrid/models';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { remoteMediaRuntime } from '../remoteMediaRuntime';
import { cleanTranscription, whisperService } from '../whisperService';

function transcriptionInput(request: GenerationRequest): {
  fileUri: string;
  language?: string;
} {
  if (request.operation?.type !== 'transcription') {
    throw new TypeError('The transcription adapter requires a transcription operation');
  }
  const fileUri = request.operation.audio.uri;
  if (!fileUri) throw new TypeError('The transcription adapter requires an audio file URI');
  return {
    fileUri,
    language: request.operation.language,
  };
}

async function* transcriptionChunks(
  model: RuntimeModel,
  request: GenerationRequest,
): AsyncIterable<GenerationChunk> {
  const input = transcriptionInput(request);
  let text: string;
  if (model.source === 'local') {
    const selectedPath = whisperService.getModelPath(model.id);
    if (whisperService.getLoadedModelPath() !== selectedPath) {
      throw new Error(`The selected Whisper model is not loaded: ${model.id}`);
    }
    const pending: GenerationChunk[] = [];
    let wake: (() => void) | null = null;
    let completed = false;
    let failure: unknown;
    let transcript = '';
    const operation = whisperService.transcribeFileRaw(input.fileUri, {
      language: input.language,
      signal: request.signal,
      onProgress: progress => {
        pending.push({ progress: { completed: progress, total: 100 } });
        const listener = wake;
        wake = null;
        listener?.();
      },
    }).then(result => {
      transcript = result;
    }).catch(error => {
      failure = error;
    }).finally(() => {
      completed = true;
      const listener = wake;
      wake = null;
      listener?.();
    });
    while (!completed || pending.length) {
      if (!pending.length && !completed) {
        await new Promise<void>(resolve => { wake = resolve; });
      }
      const chunk = pending.shift();
      if (chunk) yield chunk;
    }
    await operation;
    if (failure) throw failure;
    text = transcript;
  } else {
    const server = useRemoteServerStore
      .getState()
      .servers.find(candidate => candidate.id === model.serverId);
    if (!server) throw new Error(`Remote transcription server is unavailable: ${model.serverId}`);
    text = cleanTranscription(await remoteMediaRuntime.transcribe(
      server,
      {
        fileUri: input.fileUri,
        model: model.id,
        language: input.language === 'auto' ? undefined : input.language,
      },
      { signal: request.signal },
    ));
  }
  yield {
    output: {
      type: 'transcription',
      text,
      language: input.language,
    },
    finishReason: 'stop',
  };
}

function adapter(id: string): GenerationAdapter {
  return {
    id,
    generate: transcriptionChunks,
    classifyError(error) {
      const message = error instanceof Error ? error.message : String(error);
      return /cancel|abort/i.test(message) ? 'fatal' : 'retryable';
    },
  };
}

/** Register only the concrete transcription routes currently published by Mobile inventory. */
export function reconcileMobileTranscriptionAdapters(
  service: { registerAdapter(adapter: GenerationAdapter): () => void },
  models: LLMService,
  registrations: Map<string, () => void>,
): void {
  const supported = new Set(
    models.list()
      .filter(model => model.modality === 'transcription')
      .map(model => model.adapterId),
  );
  for (const [id, unregister] of registrations) {
    if (supported.has(id)) continue;
    unregister();
    registrations.delete(id);
  }
  for (const id of supported) {
    if (registrations.has(id)) continue;
    registrations.set(id, service.registerAdapter(adapter(id)));
  }
}
