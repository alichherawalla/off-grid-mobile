import type { GenerationChunk } from '@offgrid/models';
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

export function isMobileTranscribing(): boolean {
  return activeRequests.size > 0;
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
