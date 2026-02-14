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

// Curated list of recommended models for mobile (updated Feb 2026)
// All IDs use official org repos where available, ggml-org (HuggingFace official) as fallback
export const RECOMMENDED_MODELS = [
  // --- Text: Ultra-light (3 GB+) ---
  {
    id: 'Qwen/Qwen3-0.6B-GGUF',
    name: 'Qwen 3 0.6B',
    params: 0.6,
    description: 'Latest Qwen with thinking mode, ultra-light',
    minRam: 3,
    type: 'text' as const,
    org: 'Qwen',
  },
  {
    id: 'ggml-org/gemma-3-1b-it-GGUF',
    name: 'Gemma 3 1B',
    params: 1,
    description: 'Google\'s tiny model, 128K context',
    minRam: 3,
    type: 'text' as const,
    org: 'google',
  },
  // --- Text: Small (4 GB+) ---
  {
    id: 'bartowski/Llama-3.2-1B-Instruct-GGUF',
    name: 'Llama 3.2 1B',
    params: 1,
    description: 'Meta\'s fastest mobile model, 128K context',
    minRam: 4,
    type: 'text' as const,
    org: 'meta-llama',
  },
  {
    id: 'ggml-org/gemma-3n-E2B-it-GGUF',
    name: 'Gemma 3n E2B',
    params: 2,
    description: 'Google\'s mobile-first with selective activation',
    minRam: 4,
    type: 'text' as const,
    org: 'google',
  },
  // --- Text: Medium (6 GB+) ---
  {
    id: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
    name: 'Llama 3.2 3B',
    params: 3,
    description: 'Best quality-to-size ratio for mobile',
    minRam: 6,
    type: 'text' as const,
    org: 'meta-llama',
  },
  {
    id: 'ggml-org/SmolLM3-3B-GGUF',
    name: 'SmolLM3 3B',
    params: 3,
    description: 'Strong reasoning & 128K context',
    minRam: 6,
    type: 'text' as const,
    org: 'HuggingFaceTB',
  },
  {
    id: 'bartowski/microsoft_Phi-4-mini-instruct-GGUF',
    name: 'Phi-4 Mini',
    params: 3.8,
    description: 'Math & reasoning specialist',
    minRam: 6,
    type: 'text' as const,
    org: 'microsoft',
  },
  // --- Text: Large (8 GB+) ---
  {
    id: 'Qwen/Qwen3-8B-GGUF',
    name: 'Qwen 3 8B',
    params: 8,
    description: 'Thinking + non-thinking modes, 100+ languages',
    minRam: 8,
    type: 'text' as const,
    org: 'Qwen',
  },
  // --- Vision ---
  {
    id: 'Qwen/Qwen3-VL-2B-Instruct-GGUF',
    name: 'Qwen 3 VL 2B',
    params: 2,
    description: 'Compact vision-language model with thinking mode',
    minRam: 4,
    type: 'vision' as const,
    org: 'Qwen',
  },
  {
    id: 'ggml-org/gemma-3n-E4B-it-GGUF',
    name: 'Gemma 3n E4B',
    params: 4,
    description: 'Vision + audio, built for mobile',
    minRam: 6,
    type: 'vision' as const,
    org: 'google',
  },
  {
    id: 'Qwen/Qwen3-VL-8B-Instruct-GGUF',
    name: 'Qwen 3 VL 8B',
    params: 8,
    description: 'Vision-language model with thinking mode',
    minRam: 8,
    type: 'vision' as const,
    org: 'Qwen',
  },
  // --- Code ---
  {
    id: 'Qwen/Qwen3-Coder-30B-A3B-Instruct-GGUF',
    name: 'Qwen 3 Coder A3B',
    params: 3,
    description: 'MoE coding model, only 3B active params',
    minRam: 6,
    type: 'code' as const,
    org: 'Qwen',
  },
];

// Model organization filter options
export const MODEL_ORGS = [
  { key: 'Qwen', label: 'Qwen' },
  { key: 'meta-llama', label: 'Llama' },
  { key: 'google', label: 'Google' },
  { key: 'microsoft', label: 'Microsoft' },
  { key: 'mistralai', label: 'Mistral' },
  { key: 'deepseek-ai', label: 'DeepSeek' },
  { key: 'HuggingFaceTB', label: 'HuggingFace' },
  { key: 'nvidia', label: 'NVIDIA' },
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
  'ggml-org': 'GGML (HuggingFace)',
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
    id: 'freedom',
    title: 'Your AI.\nNo Strings Attached.',
    description: 'No subscriptions, no sign-ups, no company reading your chats. An AI that lives on your device and answers to no one else.',
    icon: 'anchor',
  },
  {
    id: 'magic',
    title: 'Just Talk.\nIt Figures Out the Rest.',
    description: 'Describe an image \u2014 it creates one. Show it a photo \u2014 it understands. Attach a document \u2014 it reads it. One conversation, no modes, no friction.',
    icon: 'compass',
  },
  {
    id: 'create',
    title: 'Say It Simply.\nGet Something Stunning.',
    description: 'Type \u201Cimagine a cat on the moon\u201D and watch your words become a vivid image in seconds. AI enhances your ideas automatically \u2014 no prompt engineering needed.',
    icon: 'sunrise',
  },
  {
    id: 'hardware',
    title: 'Tuned for\nYour Hardware.',
    description: 'Accelerated for Metal, NPU, and Neural Engine. We\u2019ll recommend the perfect model for your phone \u2014 so it flies from the start.',
    icon: 'sliders',
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

