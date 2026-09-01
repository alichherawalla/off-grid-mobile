import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  registerTranscriptionModelProjection,
  type MobileTranscriptionLoadResult,
} from '../services/modelServices/transcriptionRuntimePort';

export type WhisperLoadResult = MobileTranscriptionLoadResult;

export interface WhisperState {
  downloadedModelId: string | null;
  presentModelIds: string[];
  downloadProgressById: Record<string, number>;
  isModelLoading: boolean;
  isModelLoaded: boolean;
  error: string | null;
  transcriptionLanguage: string;
  clearError: () => void;
  setTranscriptionLanguage: (language: string) => void;
}

/** Persisted UI projection. Shared TranscriptionModelWorkflow owns every action. */
export const useWhisperStore = create<WhisperState>()(
  persist(
    set => ({
      downloadedModelId: null,
      presentModelIds: [],
      downloadProgressById: {},
      isModelLoading: false,
      isModelLoaded: false,
      error: null,
      transcriptionLanguage: 'en',
      clearError: () => set({ error: null }),
      setTranscriptionLanguage: transcriptionLanguage => set({ transcriptionLanguage }),
    }),
    {
      name: 'local-llm-whisper-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        downloadedModelId: state.downloadedModelId,
        transcriptionLanguage: state.transcriptionLanguage,
      }),
    },
  ),
);

registerTranscriptionModelProjection({
  state: () => {
    const state = useWhisperStore.getState();
    return {
      selectedModelId: state.downloadedModelId,
      presentModelIds: state.presentModelIds,
      downloadProgressById: state.downloadProgressById,
      isModelLoading: state.isModelLoading,
      isModelLoaded: state.isModelLoaded,
      error: state.error,
    };
  },
  project: patch => useWhisperStore.setState({
    ...(patch.presentModelIds !== undefined ? { presentModelIds: [...patch.presentModelIds] } : {}),
    ...(patch.downloadProgressById !== undefined
      ? { downloadProgressById: { ...patch.downloadProgressById } }
      : {}),
    ...(patch.isModelLoading !== undefined ? { isModelLoading: patch.isModelLoading } : {}),
    ...(patch.isModelLoaded !== undefined ? { isModelLoaded: patch.isModelLoaded } : {}),
    ...(patch.error !== undefined ? { error: patch.error } : {}),
  }),
});
