import { useWhisperStore } from '../stores/whisperStore';
import { WHISPER_MODELS } from '../services/whisperService';

export const NO_TRANSCRIPTION_MODEL_LABEL = 'No model selected. Tap to choose.';

/**
 * One projection of the selected STT model for every settings surface. The
 * Whisper store owns the selection. Views only decide how to present it and
 * when to open the shared picker.
 */
export function useTranscriptionModelSetting(): {
  modelId: string | null;
  modelName: string | null;
} {
  const modelId = useWhisperStore((state) => state.downloadedModelId);
  return {
    modelId,
    modelName: WHISPER_MODELS.find((model) => model.id === modelId)?.name ?? null,
  };
}
