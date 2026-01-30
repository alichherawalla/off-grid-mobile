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
  type: 'image';
  uri: string;
  mimeType?: string;
  width?: number;
  height?: number;
  fileName?: string;
}

// Chat-related types
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  isThinking?: boolean;
  attachments?: MediaAttachment[];
}

export interface Conversation {
  id: string;
  title: string;
  modelId: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  personaId?: string;
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

// App state types
export type AppScreen =
  | 'onboarding'
  | 'home'
  | 'models'
  | 'chat'
  | 'settings'
  | 'generate'
  | 'model-download';
