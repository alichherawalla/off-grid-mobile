import type { GenerationChunk } from '@offgrid/models';
import type { RealtimeTranscriptionResult } from './whisperService';
import {
  mobileGenerationService,
  refreshMobileModelServices,
} from './modelServices';

export interface MobileTranscriptionOptions {
  language?: string;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

const activeRequests = new Set<AbortController>();

export function cancelMobileTranscription(): void {
  for (const controller of activeRequests) controller.abort();
  activeRequests.clear();
}

export async function startMobileRealtimeTranscription(
  onResult: (result: RealtimeTranscriptionResult) => void,
  options: { language?: string; maxLength?: number; onError?: (error: unknown) => void } = {},
): Promise<void> {
  await refreshMobileModelServices();
  const controller = new AbortController();
  activeRequests.add(controller);
  let started = false;
  let resolveStarted: () => void = () => undefined;
  let rejectStarted: ((error?: unknown) => void) | null = null;
  const startup = new Promise<void>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  mobileGenerationService.generate(
    {
      operation: {
        type: 'transcription',
        audio: { type: 'microphone' },
        language: options.language,
        maxLength: options.maxLength,
      },
      allowFallback: false,
      signal: controller.signal,
      timeoutMs: 60 * 60_000,
    },
    {
      chunk: chunk => {
        if (chunk.progress?.completed === chunk.progress?.total) {
          started = true;
          resolveStarted();
        }
        if (chunk.output?.type === 'transcription') {
          onResult({
            text: chunk.output.text,
            isCapturing: !!chunk.output.partial,
            processTime: chunk.output.processTime ?? 0,
            recordingTime: chunk.output.recordingTime ?? 0,
          });
        }
      },
    },
  ).catch(error => {
    if (!started) rejectStarted?.(error);
    else options.onError?.(error);
  }).finally(() => {
    activeRequests.delete(controller);
  });
  await startup;
}

/** Execute one recorded audio file through the exact transcription route selected in shared models. */
export async function executeMobileTranscription(
  fileUri: string,
  options: MobileTranscriptionOptions = {},
): Promise<string> {
  await refreshMobileModelServices();
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  activeRequests.add(controller);
  try {
    const result = await mobileGenerationService.generate(
      {
        operation: {
          type: 'transcription',
          audio: { type: 'audio', uri: fileUri, mimeType: 'audio/wav' },
          language: options.language,
        },
        allowFallback: false,
        signal: controller.signal,
      },
      {
        chunk: (chunk: GenerationChunk) => {
          const progress = chunk.progress;
          if (progress?.total) options.onProgress?.(progress.completed / progress.total);
        },
      },
    );
    if (result.output.type !== 'transcription') {
      throw new TypeError('Transcription returned an invalid result');
    }
    return result.output.text;
  } finally {
    activeRequests.delete(controller);
    options.signal?.removeEventListener('abort', abort);
  }
}
