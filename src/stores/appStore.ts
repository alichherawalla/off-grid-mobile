import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceInfo, DownloadedModel, ModelRecommendation, BackgroundDownloadInfo, ONNXImageModel, ImageGenerationMode, AutoDetectMethod, ModelLoadingStrategy, GeneratedImage } from '../types';

interface AppState {
  // Theme
  themeMode: 'light' | 'dark';
  setThemeMode: (mode: 'light' | 'dark') => void;

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

  // Background downloads (Android)
  activeBackgroundDownloads: Record<number, {
    modelId: string;
    fileName: string;
    quantization: string;
    author: string;
    totalBytes: number;
  }>;
  setBackgroundDownload: (downloadId: number, info: {
    modelId: string;
    fileName: string;
    quantization: string;
    author: string;
    totalBytes: number;
  } | null) => void;
  clearBackgroundDownloads: () => void;

  // Settings
  settings: {
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
    topP: number;
    repeatPenalty: number;
    contextLength: number;
    // Performance settings
    nThreads: number;
    nBatch: number;
    // Image generation settings
    imageGenerationMode: ImageGenerationMode;
    autoDetectMethod: AutoDetectMethod;
    classifierModelId: string | null;
    imageSteps: number;
    imageGuidanceScale: number;
    imageThreads: number;
    imageWidth: number;
    imageHeight: number;
    // Use text LLM to enhance/refine image prompts before generation
    enhanceImagePrompts: boolean;
    // Model loading strategy: 'performance' keeps models loaded, 'memory' loads on demand
    modelLoadingStrategy: ModelLoadingStrategy;
    // GPU acceleration for text model inference (requires model reload)
    enableGpu: boolean;
    // Number of model layers offloaded to GPU (higher = more GPU usage, 0 = CPU only)
    gpuLayers: number;
    // Show generation details (GPU, model, tok/s, steps, etc.) in chat messages
    showGenerationDetails: boolean;
  };
  updateSettings: (settings: Partial<AppState['settings']>) => void;

  // Image models (ONNX-based)
  downloadedImageModels: ONNXImageModel[];
  activeImageModelId: string | null;
  setDownloadedImageModels: (models: ONNXImageModel[]) => void;
  addDownloadedImageModel: (model: ONNXImageModel) => void;
  removeDownloadedImageModel: (modelId: string) => void;
  setActiveImageModelId: (modelId: string | null) => void;

  // Image model download tracking (global so cancel works across screens)
  imageModelDownloading: string[];
  imageModelDownloadIds: Record<string, number>;
  addImageModelDownloading: (modelId: string) => void;
  removeImageModelDownloading: (modelId: string) => void;
  clearImageModelDownloading: () => void;
  setImageModelDownloadId: (modelId: string, downloadId: number | null) => void;

  // Image generation state
  isGeneratingImage: boolean;
  imageGenerationProgress: { step: number; totalSteps: number } | null;
  imageGenerationStatus: string | null;
  imagePreviewPath: string | null;
  setIsGeneratingImage: (generating: boolean) => void;
  setImageGenerationProgress: (progress: { step: number; totalSteps: number } | null) => void;
  setImageGenerationStatus: (status: string | null) => void;
  setImagePreviewPath: (path: string | null) => void;

  // Gallery - persisted metadata of all generated images
  generatedImages: GeneratedImage[];
  addGeneratedImage: (image: GeneratedImage) => void;
  removeGeneratedImage: (imageId: string) => void;
  removeImagesByConversationId: (conversationId: string) => string[];
  clearGeneratedImages: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Theme
      themeMode: 'dark' as 'light' | 'dark',
      setThemeMode: (mode) => set({ themeMode: mode }),

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

      // Background downloads (Android)
      activeBackgroundDownloads: {},
      setBackgroundDownload: (downloadId, info) =>
        set((state) => {
          if (info === null) {
            const { [downloadId]: _, ...rest } = state.activeBackgroundDownloads;
            return { activeBackgroundDownloads: rest };
          }
          return {
            activeBackgroundDownloads: {
              ...state.activeBackgroundDownloads,
              [downloadId]: info,
            },
          };
        }),
      clearBackgroundDownloads: () =>
        set({ activeBackgroundDownloads: {} }),

      // Settings
      settings: {
        systemPrompt: 'You are a helpful AI assistant running locally on the user\'s device. Be concise and helpful.',
        temperature: 0.7,
        maxTokens: 1024,
        topP: 0.9,
        repeatPenalty: 1.1,
        contextLength: 2048,
        // Performance - higher threads = faster on multi-core devices
        nThreads: 6,
        nBatch: 256,
        // Image generation - 'auto' uses LLM to classify intent
        imageGenerationMode: 'auto',
        // Auto-detection method: 'pattern' (fast regex only) or 'llm' (use model for uncertain cases)
        autoDetectMethod: 'pattern',
        // Model to use for LLM-based classification (null = use current model)
        classifierModelId: null as string | null,
        // Image generation steps (more = better quality but slower)
        // For SD1.5 models: 20 steps is a good default with DPM scheduler
        imageSteps: 20,
        // Guidance scale for image generation
        // For SD1.5 models: 7.5 is the standard default
        imageGuidanceScale: 7.5,
        // CPU threads for image generation (applies on next image model load)
        imageThreads: 4,
        // Image generation resolution (width and height in pixels, must be divisible by 8)
        // SD1.5 models are trained at 512x512
        imageWidth: 512,
        imageHeight: 512,
        // Use text LLM to enhance image prompts (disabled by default for speed)
        enhanceImagePrompts: false,
        // Model loading strategy: 'performance' = keep loaded, 'memory' = load on demand
        modelLoadingStrategy: 'memory' as ModelLoadingStrategy,
        // GPU acceleration for text inference (try GPU offloading when available)
        enableGpu: false,
        // Number of model layers to offload to GPU (iOS Metal can handle more; Android OpenCL needs conservative values)
        gpuLayers: 6,
        // Show generation details in chat messages (GPU, model, tok/s, etc.)
        showGenerationDetails: false,
      },
      updateSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        })),

      // Image models (ONNX-based)
      downloadedImageModels: [],
      activeImageModelId: null,
      setDownloadedImageModels: (models) => set({ downloadedImageModels: models }),
      addDownloadedImageModel: (model) =>
        set((state) => ({
          downloadedImageModels: [...state.downloadedImageModels.filter(m => m.id !== model.id), model],
        })),
      removeDownloadedImageModel: (modelId) =>
        set((state) => ({
          downloadedImageModels: state.downloadedImageModels.filter((m) => m.id !== modelId),
          activeImageModelId: state.activeImageModelId === modelId ? null : state.activeImageModelId,
        })),
      setActiveImageModelId: (modelId) => set({ activeImageModelId: modelId }),

      // Image model download tracking
      imageModelDownloading: [],
      imageModelDownloadIds: {},
      addImageModelDownloading: (modelId) =>
        set((state) => ({
          imageModelDownloading: [...state.imageModelDownloading.filter(id => id !== modelId), modelId],
        })),
      removeImageModelDownloading: (modelId) =>
        set((state) => {
          const { [modelId]: _, ...restIds } = state.imageModelDownloadIds;
          return {
            imageModelDownloading: state.imageModelDownloading.filter(id => id !== modelId),
            imageModelDownloadIds: restIds,
          };
        }),
      clearImageModelDownloading: () =>
        set({ imageModelDownloading: [], imageModelDownloadIds: {} }),
      setImageModelDownloadId: (modelId, downloadId) =>
        set((state) => {
          if (downloadId === null) {
            const { [modelId]: _, ...rest } = state.imageModelDownloadIds;
            return { imageModelDownloadIds: rest };
          }
          return {
            imageModelDownloadIds: { ...state.imageModelDownloadIds, [modelId]: downloadId },
          };
        }),

      // Image generation state
      isGeneratingImage: false,
      imageGenerationProgress: null,
      imageGenerationStatus: null,
      imagePreviewPath: null,
      setIsGeneratingImage: (generating) => set({ isGeneratingImage: generating }),
      setImageGenerationProgress: (progress) => set({ imageGenerationProgress: progress }),
      setImageGenerationStatus: (status) => set({ imageGenerationStatus: status }),
      setImagePreviewPath: (path) => set({ imagePreviewPath: path }),

      // Gallery
      generatedImages: [],
      addGeneratedImage: (image) =>
        set((state) => ({
          generatedImages: [image, ...state.generatedImages],
        })),
      removeGeneratedImage: (imageId) =>
        set((state) => ({
          generatedImages: state.generatedImages.filter((img) => img.id !== imageId),
        })),
      removeImagesByConversationId: (conversationId) => {
        const state = get();
        const imagesToRemove = state.generatedImages.filter(
          (img) => img.conversationId === conversationId
        );
        const imageIds = imagesToRemove.map((img) => img.id);
        set({
          generatedImages: state.generatedImages.filter(
            (img) => img.conversationId !== conversationId
          ),
        });
        return imageIds;
      },
      clearGeneratedImages: () =>
        set({ generatedImages: [] }),
    }),
    {
      name: 'local-llm-app-storage',
      storage: createJSONStorage(() => AsyncStorage),
      merge: (persistedState: any, currentState) => {
        const merged = { ...currentState, ...persistedState };
        // Migrate old string|null → string[]
        if (typeof merged.imageModelDownloading === 'string') {
          merged.imageModelDownloading = [merged.imageModelDownloading];
        } else if (!Array.isArray(merged.imageModelDownloading)) {
          merged.imageModelDownloading = [];
        }
        // Migrate old number|null → Record
        if (typeof merged.imageModelDownloadId === 'number') {
          const ids: Record<string, number> = {};
          if (Array.isArray(merged.imageModelDownloading) && merged.imageModelDownloading.length > 0) {
            ids[merged.imageModelDownloading[0]] = merged.imageModelDownloadId;
          }
          merged.imageModelDownloadIds = ids;
          delete merged.imageModelDownloadId;
        } else if (!merged.imageModelDownloadIds || typeof merged.imageModelDownloadIds !== 'object') {
          merged.imageModelDownloadIds = {};
        }
        return merged as AppState;
      },
      partialize: (state) => ({
        themeMode: state.themeMode,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        activeModelId: state.activeModelId,
        settings: state.settings,
        activeBackgroundDownloads: state.activeBackgroundDownloads,
        // Persist image model state
        activeImageModelId: state.activeImageModelId,
        // Persist image model download tracking (survives app restart)
        imageModelDownloading: state.imageModelDownloading,
        imageModelDownloadIds: state.imageModelDownloadIds,
        // Persist gallery
        generatedImages: state.generatedImages,
      }),
    }
  )
);
