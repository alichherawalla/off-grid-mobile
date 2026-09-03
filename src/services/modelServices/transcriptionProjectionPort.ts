import type { TranscriptionModelWorkflowState } from '@offgrid/models';

export type MobileTranscriptionLoadResult = 'loaded' | 'blocked' | 'error';

export interface MobileTranscriptionProjection {
  state(): TranscriptionModelWorkflowState;
  project(patch: Partial<TranscriptionModelWorkflowState>): void;
}

let projection: MobileTranscriptionProjection | null = null;

/** Register the persisted Mobile projection without importing the model-services aggregate. */
export function registerTranscriptionModelProjection(
  port: MobileTranscriptionProjection,
): void {
  projection = port;
}

export function requireTranscriptionModelProjection(): MobileTranscriptionProjection {
  if (!projection) {
    throw new Error('Transcription model projection is not registered');
  }
  return projection;
}
