// Model size recommendations based on device RAM
export const MODEL_RECOMMENDATIONS = {
  // RAM in GB -> max model parameters in billions
  memoryToParams: [
    { minRam: 3, maxRam: 4, maxParams: 1.5, quantization: 'Q4_K_M' },
    { minRam: 4, maxRam: 6, maxParams: 3, quantization: 'Q4_K_M' },
    { minRam: 6, maxRam: 8, maxParams: 4, quantization: 'Q4_K_M' },
    { minRam: 8, maxRam: 12, maxParams: 8, quantization: 'Q4_K_M' },
    { minRam: 12, maxRam: 16, maxParams: 13, quantization: 'Q4_K_M' },
    { minRam: 16, maxRam: Infinity, maxParams: 30, quantization: 'Q4_K_M' },
  ],
};

// Curated list of recommended models for mobile
export const RECOMMENDED_MODELS = [
  {
    id: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
    name: 'Qwen 2.5 0.5B',
    params: 0.5,
    description: 'Tiny but capable model, great for basic tasks',
    minRam: 3,
  },
  {
    id: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
    name: 'Qwen 2.5 1.5B',
    params: 1.5,
    description: 'Excellent balance of size and capability',
    minRam: 4,
  },
  {
    id: 'Qwen/Qwen2.5-3B-Instruct-GGUF',
    name: 'Qwen 2.5 3B',
    params: 3,
    description: 'Great quality for most mobile devices',
    minRam: 6,
  },
  {
    id: 'HuggingFaceTB/SmolLM2-135M-Instruct-GGUF',
    name: 'SmolLM2 135M',
    params: 0.135,
    description: 'Ultra-tiny model, runs on any device',
    minRam: 2,
  },
  {
    id: 'HuggingFaceTB/SmolLM2-360M-Instruct-GGUF',
    name: 'SmolLM2 360M',
    params: 0.36,
    description: 'Very small but surprisingly capable',
    minRam: 3,
  },
  {
    id: 'HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF',
    name: 'SmolLM2 1.7B',
    params: 1.7,
    description: 'Best tiny model for general use',
    minRam: 4,
  },
  {
    id: 'microsoft/Phi-3-mini-4k-instruct-gguf',
    name: 'Phi-3 Mini 4K',
    params: 3.8,
    description: 'Microsoft\'s efficient small model',
    minRam: 6,
  },
  {
    id: 'TheBloke/Llama-2-7B-Chat-GGUF',
    name: 'Llama 2 7B Chat',
    params: 7,
    description: 'Meta\'s popular chat model',
    minRam: 8,
  },
];

// Quantization levels and their properties
export const QUANTIZATION_INFO: Record<string, {
  bitsPerWeight: number;
  quality: string;
  description: string;
  recommended: boolean;
}> = {
  'Q2_K': {
    bitsPerWeight: 2.625,
    quality: 'Low',
    description: 'Extreme compression, noticeable quality loss',
    recommended: false,
  },
  'Q3_K_S': {
    bitsPerWeight: 3.4375,
    quality: 'Low-Medium',
    description: 'High compression, some quality loss',
    recommended: false,
  },
  'Q3_K_M': {
    bitsPerWeight: 3.4375,
    quality: 'Medium',
    description: 'Good compression with acceptable quality',
    recommended: false,
  },
  'Q4_0': {
    bitsPerWeight: 4,
    quality: 'Medium',
    description: 'Basic 4-bit quantization',
    recommended: false,
  },
  'Q4_K_S': {
    bitsPerWeight: 4.5,
    quality: 'Medium-Good',
    description: 'Good balance of size and quality',
    recommended: true,
  },
  'Q4_K_M': {
    bitsPerWeight: 4.5,
    quality: 'Good',
    description: 'Optimal for mobile - best balance',
    recommended: true,
  },
  'Q5_K_S': {
    bitsPerWeight: 5.5,
    quality: 'Good-High',
    description: 'Higher quality, larger size',
    recommended: false,
  },
  'Q5_K_M': {
    bitsPerWeight: 5.5,
    quality: 'High',
    description: 'Near original quality',
    recommended: false,
  },
  'Q6_K': {
    bitsPerWeight: 6.5,
    quality: 'Very High',
    description: 'Minimal quality loss',
    recommended: false,
  },
  'Q8_0': {
    bitsPerWeight: 8,
    quality: 'Excellent',
    description: 'Best quality, largest size',
    recommended: false,
  },
};

// Hugging Face API configuration
export const HF_API = {
  baseUrl: 'https://huggingface.co',
  apiUrl: 'https://huggingface.co/api',
  modelsEndpoint: '/models',
  searchParams: {
    filter: 'gguf',
    sort: 'downloads',
    direction: '-1',
    limit: 30,
  },
};

// Model credibility configuration
// LM Studio community - highest credibility for GGUF models
export const LMSTUDIO_AUTHORS = [
  'lmstudio-community',
  'lmstudio-ai',
];

// Official model creators - these are the original model authors
export const OFFICIAL_MODEL_AUTHORS: Record<string, string> = {
  'meta-llama': 'Meta',
  'microsoft': 'Microsoft',
  'google': 'Google',
  'Qwen': 'Alibaba',
  'mistralai': 'Mistral AI',
  'HuggingFaceTB': 'Hugging Face',
  'HuggingFaceH4': 'Hugging Face',
  'bigscience': 'BigScience',
  'EleutherAI': 'EleutherAI',
  'tiiuae': 'TII UAE',
  'stabilityai': 'Stability AI',
  'databricks': 'Databricks',
  'THUDM': 'Tsinghua University',
  'baichuan-inc': 'Baichuan',
  'internlm': 'InternLM',
  '01-ai': '01.AI',
  'deepseek-ai': 'DeepSeek',
  'CohereForAI': 'Cohere',
  'allenai': 'Allen AI',
  'nvidia': 'NVIDIA',
  'apple': 'Apple',
};

// Verified quantizers - trusted community members who quantize models
export const VERIFIED_QUANTIZERS: Record<string, string> = {
  'TheBloke': 'TheBloke',
  'bartowski': 'bartowski',
  'QuantFactory': 'QuantFactory',
  'mradermacher': 'mradermacher',
  'second-state': 'Second State',
  'MaziyarPanahi': 'Maziyar Panahi',
  'Triangle104': 'Triangle104',
  'unsloth': 'Unsloth',
};

// Credibility level labels
export const CREDIBILITY_LABELS = {
  lmstudio: {
    label: 'LM Studio',
    description: 'Official LM Studio quantization - highest quality GGUF',
    color: '#22D3EE', // cyan
  },
  official: {
    label: 'Official',
    description: 'From the original model creator',
    color: '#22C55E', // green
  },
  'verified-quantizer': {
    label: 'Verified',
    description: 'From a trusted quantization provider',
    color: '#A78BFA', // purple
  },
  community: {
    label: 'Community',
    description: 'Community contributed model',
    color: '#64748B', // gray
  },
};

// App configuration
export const APP_CONFIG = {
  modelStorageDir: 'models',
  maxConcurrentDownloads: 1,
  defaultSystemPrompt: `You are a helpful AI assistant running locally on the user's device. Your responses should be:
- Accurate and factual - never make up information
- Concise but complete - answer the question fully without unnecessary elaboration
- Helpful and friendly - focus on solving the user's actual need
- Honest about limitations - if you don't know something, say so

If asked about yourself, you can mention you're a local AI assistant that prioritizes user privacy.`,
  streamingEnabled: true,
  maxContextLength: 2048, // Balanced for speed and context (increase to 4096 if you need more history)
};

// Onboarding slides
export const ONBOARDING_SLIDES = [
  {
    id: 'welcome',
    title: 'Welcome to Local LLM',
    description: 'Run AI models directly on your device. No internet required, complete privacy.',
    icon: 'cpu',
  },
  {
    id: 'privacy',
    title: 'Your Privacy Matters',
    description: 'All conversations stay on your device. No data is sent to any server. Your thoughts remain yours.',
    icon: 'lock',
  },
  {
    id: 'offline',
    title: 'Works Offline',
    description: 'Once you download a model, it works without internet. Perfect for travel, remote areas, or privacy-sensitive tasks.',
    icon: 'wifi-off',
  },
  {
    id: 'models',
    title: 'Choose Your Model',
    description: 'Select from various AI models. Smaller models are faster, larger models are smarter. We\'ll help you pick the right one for your device.',
    icon: 'layers',
  },
];

// Fonts
export const FONTS = {
  mono: 'Menlo',
};

// Typography Scale - Centralized font sizes and styles
export const TYPOGRAPHY = {
  // Display / Hero numbers
  display: {
    fontSize: 22,
    fontFamily: FONTS.mono,
    fontWeight: '200' as const,
    letterSpacing: -0.5,
  },

  // Headings
  h1: {
    fontSize: 24,
    fontFamily: FONTS.mono,
    fontWeight: '300' as const,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 16,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
    letterSpacing: -0.2,
  },
  h3: {
    fontSize: 13,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
    letterSpacing: -0.2,
  },

  // Body text
  body: {
    fontSize: 14,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
  },
  bodySmall: {
    fontSize: 13,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
  },

  // Labels (whispers)
  label: {
    fontSize: 10,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
    letterSpacing: 0.3,
  },
  labelSmall: {
    fontSize: 9,
    fontFamily: FONTS.mono,
    fontWeight: '400' as const,
    letterSpacing: 0.3,
  },

  // Metadata / Details
  meta: {
    fontSize: 10,
    fontFamily: FONTS.mono,
    fontWeight: '300' as const,
  },
  metaSmall: {
    fontSize: 9,
    fontFamily: FONTS.mono,
    fontWeight: '300' as const,
  },
};

// Spacing Scale - Consistent whitespace
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

