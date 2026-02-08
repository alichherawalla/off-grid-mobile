// Model category types
export type ModelCategory = 'text-generation' | 'image-generation' | 'vision' | 'code';

// Model source and credibility types
export type ModelSource = 'lmstudio' | 'official' | 'verified-quantizer' | 'community';

export interface ModelCredibility {
  source: ModelSource;
  isOfficial: boolean;        // From the original model creator (Meta, Microsoft, etc.)
  isVerifiedQuantizer: boolean; // From trusted quantization providers (LM Studio, TheBloke, etc.)
  verifiedBy?: string;        // Who verified this (e.g., "LM Studio", "Original Author")
}

// Model-related types
export interface ModelInfo {
  id: string;
  name: string;
  author: string;
  description: string;
  downloads: number;
  likes: number;
  tags: string[];
  lastModified: string;
  files: ModelFile[];
  credibility?: ModelCredibility;
}

export interface ModelFile {
  name: string;
  size: number;
  quantization: string;
  downloadUrl: string;
  // Companion mmproj for vision models
  mmProjFile?: {
    name: string;
    size: number;
    downloadUrl: string;
  };
}

export interface DownloadedModel {
  id: string;
  name: string;
  author: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  quantization: string;
  downloadedAt: string;
  credibility?: ModelCredibility;
  // Vision model support
  isVisionModel?: boolean;
  mmProjPath?: string;
  mmProjFileName?: string;
  mmProjFileSize?: number;
}

export interface DownloadProgress {
  modelId: string;
  fileName: string;
  bytesDownloaded: number;
  totalBytes: number;
  progress: number;
}

// Hardware-related types
export interface DeviceInfo {
  totalMemory: number;
  usedMemory: number;
  availableMemory: number;
  deviceModel: string;
  systemName: string;
  systemVersion: string;
  isEmulator: boolean;
}

export interface ModelRecommendation {
  maxParameters: number;
  recommendedQuantization: string;
  recommendedModels: string[];
  warning?: string;
}

// Media attachment types
export interface MediaAttachment {
  id: string;
  type: 'image' | 'document';
  uri: string;
  mimeType?: string;
  width?: number;
  height?: number;
  fileName?: string;
  /** For documents: the extracted text content */
  textContent?: string;
  /** For documents: file size in bytes */
  fileSize?: number;
}

// Generation metadata - details about how a message was generated
export interface GenerationMeta {
  /** Whether GPU was used for inference */
  gpu: boolean;
  /** GPU backend name (e.g., 'Metal', 'CPU') */
  gpuBackend?: string;
  /** Number of GPU layers offloaded */
  gpuLayers?: number;
  /** Model name used for generation */
  modelName?: string;
  /** Tokens per second — overall including prefill (text generation only) */
  tokensPerSecond?: number;
  /** Tokens per second — decode only, excluding prefill (text generation only) */
  decodeTokensPerSecond?: number;
  /** Time to first token in seconds (text generation only) */
  timeToFirstToken?: number;
  /** Token count (text generation only) */
  tokenCount?: number;
  /** Image generation steps */
  steps?: number;
  /** Image guidance scale */
  guidanceScale?: number;
  /** Image resolution */
  resolution?: string;
}

// Chat-related types
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  isThinking?: boolean;
  /** Indicates this is a system info message (model loaded/unloaded, etc.) */
  isSystemInfo?: boolean;
  attachments?: MediaAttachment[];
  /** Generation duration in milliseconds */
  generationTimeMs?: number;
  /** Metadata about how the message was generated */
  generationMeta?: GenerationMeta;
}

export interface Conversation {
  id: string;
  title: string;
  modelId: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  projectId?: string;
}

// Onboarding-related types
export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  image?: string;
}

// Hugging Face API types
export interface HFModelSearchResult {
  _id: string;
  id: string;
  modelId: string;
  author: string;
  sha: string;
  lastModified: string;
  private: boolean;
  disabled: boolean;
  gated: boolean | string;
  downloads: number;
  likes: number;
  tags: string[];
  cardData?: {
    license?: string;
    language?: string[];
    pipeline_tag?: string;
  };
  siblings?: HFModelFile[];
}

export interface HFModelFile {
  rfilename: string;
  size?: number;
  blobId?: string;
  lfs?: {
    size: number;
    sha256: string;
    pointerSize: number;
  };
}

// Image generation types
export interface ImageGenerationModel {
  id: string;
  name: string;
  author: string;
  description: string;
  downloads: number;
  likes: number;
  modelPath: string;
  downloadedAt: string;
  size: number;
  variant?: string; // e.g., 'gpu', 'npu', 'cpu'
}

// ONNX Image Model types (for Stable Diffusion via ONNX Runtime)
export interface ONNXImageModel {
  id: string;
  name: string;
  description: string;
  modelPath: string;
  downloadedAt: string;
  size: number; // Total size of all model files in bytes
  style?: string; // e.g., 'creative', 'photorealistic', 'anime'
  backend?: 'mnn' | 'qnn' | 'coreml'; // 'mnn' for CPU, 'qnn' for Qualcomm NPU, 'coreml' for Apple Core ML
}

// Image generation state for UI
export interface ImageGenerationState {
  isGenerating: boolean;
  currentStep: number;
  totalSteps: number;
  progress: number;
  prompt?: string;
}

// Image generation mode
export type ImageGenerationMode = 'auto' | 'manual';

// Auto-detection method for image requests
export type AutoDetectMethod = 'pattern' | 'llm';

// Model loading strategy
export type ModelLoadingStrategy = 'performance' | 'memory';

// Image mode state for chat input
export type ImageModeState = 'auto' | 'force';

export interface GeneratedImage {
  id: string;
  prompt: string;
  negativePrompt?: string;
  imagePath: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  modelId: string;
  createdAt: string;
  conversationId?: string;
}

export interface ImageGenerationParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  guidanceScale?: number;
  seed?: number;
}

export interface ImageGenerationProgress {
  step: number;
  totalSteps: number;
  progress: number;
}

// Project types - context presets for grouping related chats
export interface Project {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
}

// Background download types
export type BackgroundDownloadStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'unknown';

export interface BackgroundDownloadInfo {
  downloadId: number;
  fileName: string;
  title?: string;
  modelId: string;
  status: BackgroundDownloadStatus;
  bytesDownloaded: number;
  totalBytes: number;
  localUri?: string;
  startedAt: number;
  completedAt?: number;
  failureReason?: string;
}

// App state types
export type AppScreen =
  | 'onboarding'
  | 'home'
  | 'models'
  | 'chat'
  | 'settings'
  | 'generate'
  | 'model-download';
