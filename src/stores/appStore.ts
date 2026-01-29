import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceInfo, DownloadedModel, ModelRecommendation } from '../types';

interface AppState {
  // Onboarding
  hasCompletedOnboarding: boolean;
  setOnboardingComplete: (complete: boolean) => void;

  // Device info
  deviceInfo: DeviceInfo | null;
  modelRecommendation: ModelRecommendation | null;
  setDeviceInfo: (info: DeviceInfo) => void;
  setModelRecommendation: (rec: ModelRecommendation) => void;

  // Downloaded models
  downloadedModels: DownloadedModel[];
  setDownloadedModels: (models: DownloadedModel[]) => void;
  addDownloadedModel: (model: DownloadedModel) => void;
  removeDownloadedModel: (modelId: string) => void;

  // Active model
  activeModelId: string | null;
  setActiveModelId: (modelId: string | null) => void;

  // Loading states
  isLoadingModel: boolean;
  setIsLoadingModel: (loading: boolean) => void;

  // Download progress
  downloadProgress: Record<string, {
    progress: number;
    bytesDownloaded: number;
    totalBytes: number;
  }>;
  setDownloadProgress: (modelId: string, progress: {
    progress: number;
    bytesDownloaded: number;
    totalBytes: number;
  } | null) => void;

  // Settings
  settings: {
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
    topP: number;
    repeatPenalty: number;
    contextLength: number;
  };
  updateSettings: (settings: Partial<AppState['settings']>) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Onboarding
      hasCompletedOnboarding: false,
      setOnboardingComplete: (complete) =>
        set({ hasCompletedOnboarding: complete }),

      // Device info
      deviceInfo: null,
      modelRecommendation: null,
      setDeviceInfo: (info) => set({ deviceInfo: info }),
      setModelRecommendation: (rec) => set({ modelRecommendation: rec }),

      // Downloaded models
      downloadedModels: [],
      setDownloadedModels: (models) => set({ downloadedModels: models }),
      addDownloadedModel: (model) =>
        set((state) => ({
          downloadedModels: [...state.downloadedModels.filter(m => m.id !== model.id), model],
        })),
      removeDownloadedModel: (modelId) =>
        set((state) => ({
          downloadedModels: state.downloadedModels.filter((m) => m.id !== modelId),
          activeModelId: state.activeModelId === modelId ? null : state.activeModelId,
        })),

      // Active model
      activeModelId: null,
      setActiveModelId: (modelId) => set({ activeModelId: modelId }),

      // Loading states
      isLoadingModel: false,
      setIsLoadingModel: (loading) => set({ isLoadingModel: loading }),

      // Download progress
      downloadProgress: {},
      setDownloadProgress: (modelId, progress) =>
        set((state) => {
          if (progress === null) {
            const { [modelId]: _, ...rest } = state.downloadProgress;
            return { downloadProgress: rest };
          }
          return {
            downloadProgress: {
              ...state.downloadProgress,
              [modelId]: progress,
            },
          };
        }),

      // Settings
      settings: {
        systemPrompt: 'You are a helpful AI assistant running locally on the user\'s device. Be concise and helpful.',
        temperature: 0.7,
        maxTokens: 512,
        topP: 0.9,
        repeatPenalty: 1.1,
        contextLength: 2048,
      },
      updateSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        })),
    }),
    {
      name: 'local-llm-app-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        activeModelId: state.activeModelId,
        settings: state.settings,
      }),
    }
  )
);
