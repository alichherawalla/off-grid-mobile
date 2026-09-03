import {
  modelsFailureMessage,
  type GenerationResult,
} from '@offgrid/application';
import type { RealtimeTranscriptionResult } from './whisperService';
import { applicationFacade } from './applicationFacade';
import logger from '../utils/logger';

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
  const models = applicationFacade().models;
  await models.refresh();
  const controller = new AbortController();
  activeRequests.add(controller);
  let started = false;
  let resolveStarted: () => void = () => undefined;
  let rejectStarted: ((error?: unknown) => void) | null = null;
  const startup = new Promise<void>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const consume = async (): Promise<void> => {
    try {
      for await (const event of models.generate({
        request: {
      operation: {
        type: 'transcription',
        audio: { type: 'microphone' },
        language: options.language,
        maxLength: options.maxLength,
      },
      profile: 'transcription',
      signal: controller.signal,
        },
      })) {
        if (event.type === 'failed') {
          throw new Error(modelsFailureMessage(event.failure));
        }
        if (event.type === 'chunk') {
          const chunk = event.chunk;
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
        }
      }
      if (!started) {
        rejectStarted?.(new Error('Realtime transcription ended before it started.'));
      }
    } catch (error) {
      if (!started) rejectStarted?.(error);
      else options.onError?.(error);
    } finally {
      activeRequests.delete(controller);
    }
  };
  consume().catch(error => {
    logger.error('Realtime transcription error callback failed', error);
  });
  await startup;
}

/** Execute one recorded audio file through the exact transcription route selected in shared models. */
export async function executeMobileTranscription(
  fileUri: string,
  options: MobileTranscriptionOptions = {},
): Promise<string> {
  const models = applicationFacade().models;
  await models.refresh();
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  activeRequests.add(controller);
  try {
    let result: GenerationResult | null = null;
    for await (const event of models.generate({
      request: {
        operation: {
          type: 'transcription',
          audio: { type: 'audio', uri: fileUri, mimeType: 'audio/wav' },
          language: options.language,
        },
        profile: 'transcription',
        signal: controller.signal,
      },
    })) {
      if (event.type === 'chunk') {
        const progress = event.chunk.progress;
        if (progress?.total) options.onProgress?.(progress.completed / progress.total);
      } else if (event.type === 'failed') {
        throw new Error(modelsFailureMessage(event.failure));
      } else if (event.type === 'result') {
        result = event.result;
      }
    }
    if (!result || result.output.type !== 'transcription') {
      throw new TypeError('Transcription returned an invalid result');
    }
    return result.output.text;
  } finally {
    activeRequests.delete(controller);
    options.signal?.removeEventListener('abort', abort);
  }
}
