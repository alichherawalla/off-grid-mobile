import { modelCommands } from '../composition/model-commands';

export const mobileModelCommands = modelCommands();

/** Record a local text route without acquiring native residency. Chat generation owns first load. */
export function selectLocalTextModelOnDemand(model: {
  id: string;
  engine: string;
}): Promise<void> {
  return mobileModelCommands.select(
    {
      source: 'local',
      hostId: model.engine,
      modality: 'text',
      modelId: model.id,
    },
    { load: false },
  );
}

/** Record the Whisper route through the canonical selection application without eager loading. */
export function selectLocalTranscriptionModelOnDemand(
  modelId: string | null,
): Promise<void> {
  if (!modelId) return mobileModelCommands.unload('transcription');
  return mobileModelCommands.select(
    {
      source: 'local',
      hostId: 'whisper.rn',
      modality: 'transcription',
      modelId,
    },
    { load: false },
  );
}
