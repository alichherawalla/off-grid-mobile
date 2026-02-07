# LocalLLM

**Truly offline-first LLM manager for mobile. Your AI, your device, your data.**

<div align="center">

https://github.com/user-attachments/assets/33085feb-15dc-4c59-939a-357da5ec50ad

**Watch the full demo above to see LocalLLM in action**

</div>

---

LocalLLM is a React Native application that brings large language models, vision AI, and image generation directly to mobile devices. All inference runs entirely on-device using llama.cpp, whisper.cpp, and local-dream—no internet required after initial model download, no data transmission, complete privacy guaranteed.

---

## Key Features at a Glance

- **Text Generation** - Multi-model GGUF support, streaming inference, custom system prompts
- **Vision AI** - Multimodal understanding with automatic mmproj handling
- **Image Generation** - On-device Stable Diffusion (CPU/NPU), real-time preview, background generation
- **AI Prompt Enhancement** - Use text LLM to expand simple prompts into detailed descriptions for better image quality
- **Voice Transcription** - On-device Whisper for speech-to-text, multiple model sizes
- **GPU Acceleration** - Optional OpenCL GPU offloading for text models
- **Auto/Manual Image Generation** - Automatic intent detection or manual toggle for image generation
- **Passphrase Lock** - Secure sensitive conversations with passphrase protection
- **Advanced Model Settings** - Global configuration for text and image models
- **Performance Tuning** - Configurable threads, batch size, context length, GPU layers
- **Overload Prevention** - Pre-load memory checks prevent OOM crashes
- **Storage Management** - Orphaned file detection, stale download cleanup

---

## Core Capabilities

### Text Generation

Multi-model LLM inference using llama.cpp compiled for ARM64 Android via llama.rn native bindings. Supports any GGUF-format model compatible with llama.cpp:

- **Streaming inference** with real-time token callbacks
- **OpenCL GPU offloading** on Qualcomm Adreno GPUs (experimental, optional)
- **Context window management** with automatic truncation and continuation
- **Performance instrumentation** - Tracks tok/s (overall and decode-only), TTFT, token count
- **Custom system prompts** via project-based conversation contexts
- **KV cache management** with manual clear capability for memory optimization

**Implementation:**
- `llmService` (`src/services/llm.ts`) wraps llama.rn for model lifecycle and inference
- `generationService` (`src/services/generationService.ts`) provides background-safe orchestration
- `activeModelService` (`src/services/activeModelService.ts`) singleton ensures safe model loading/unloading
- State managed via Zustand stores (`src/stores/`) with AsyncStorage persistence

**GPU Acceleration:**
llama.cpp's OpenCL backend enables GPU offloading on Qualcomm Adreno GPUs. Configurable layer count (0-99) determines CPU/GPU split. Automatic fallback to CPU-only if OpenCL initialization fails. CPU inference uses ARM NEON, i8mm, and dotprod SIMD instructions.

### Vision AI

Multimodal understanding via vision-language models (VLMs) with automatic mmproj (multimodal projector) handling:

- **Automatic mmproj detection** - Vision models automatically download required mmproj companion files
- **Combined asset tracking** - Model size estimates include mmproj overhead
- **Runtime mmproj discovery** - If mmproj wasn't linked during download, searches model directory on load
- **Camera and photo library integration** - React Native Image Picker for image capture/selection
- **OpenAI-compatible message format** - Uses llama.rn's OAI message structure for vision inference

**Implementation:**
- mmproj files loaded via `llmService.initMultimodal()`
- Image URIs converted to `file://` paths and passed in OAI message format
- Vision models tracked separately with `isVisionModel` flag and combined size calculation
- SmolVLM 500M-2.2B recommended (fast, 7-10s inference); Qwen models support multilingual vision

**Supported Vision Models:**
- SmolVLM (500M, 2.2B) - Fast, compact, 7-10s inference on flagship devices
- Qwen2-VL, Qwen3-VL - Excellent multilingual vision understanding
- LLaVA - Large Language and Vision Assistant
- MiniCPM-V - Efficient multimodal

### Image Generation

On-device Stable Diffusion using local-dream with MNN (CPU) and QNN (NPU) backends:

- **MNN backend** - Alibaba's MNN framework, works on all ARM64 devices (CPU-only)
- **QNN backend** - Qualcomm AI Engine (NPU acceleration) for Snapdragon 8 Gen 1+
- **Automatic backend detection** - Runtime NPU detection with MNN fallback
- **Real-time preview** - Progressive image display every N steps
- **Background generation** - Lifecycle-independent service continues when screens unmount
- **AI prompt enhancement** - Optional LLM-based prompt expansion using loaded text model

**Technical Pipeline:**
```
Text Prompt → CLIP Tokenizer → Text Encoder (embeddings)
  → Scheduler (Euler) ↔ UNet (denoising, iterative)
  → VAE Decoder → 512×512 Image
```

**Implementation:**
- `localDreamGeneratorService` (`src/services/localDreamGenerator.ts`) bridges to native
- `imageGenerationService` (`src/services/imageGenerationService.ts`) provides orchestration
- Native module (`android/app/src/main/java/com/localllm/localdream/`) wraps local-dream C++ lib
- Models fetched from xororz's HuggingFace repos (pre-converted MNN/QNN formats)
- Progress callbacks, preview callbacks, and completion callbacks flow through singleton service
- Gallery persistence via AsyncStorage with automatic cleanup on conversation deletion

**Prompt Enhancement:**
When enabled, uses the currently loaded text model to expand simple prompts into detailed descriptions:

```typescript
// User input: "Draw a dog"
// LLM enhancement system prompt guides model to add:
// - Artistic style descriptors
// - Lighting and composition details
// - Quality modifiers
// - Concrete visual details

// Result: ~75-word enhanced prompt
// "A golden retriever with soft, fluffy fur, sitting gracefully..."
```

Implementation uses separate message array with enhancement-specific system prompt, calls `llmService.generateResponse()`, then explicitly resets LLM state (`stopGeneration()` only, no KV cache clear to preserve vision inference performance).

**Image Models:**
- CPU (MNN): 5 models (~1.2GB each) - Anything V5, Absolute Reality, QteaMix, ChilloutMix, CuteYukiMix
- NPU (QNN): 20 models (~1.0GB each) - all CPU models plus DreamShaper, Realistic Vision, MajicmixRealistic, etc.
- QNN variants: `min` (non-flagship), `8gen1`, `8gen2` (8 Gen 2/3/4/5)

**Generation Performance:**
- CPU: ~15s for 512×512 @ 20 steps (Snapdragon 8 Gen 3)
- NPU: ~5-10s for 512×512 @ 20 steps (chipset-dependent)

### Voice Transcription

On-device speech recognition using whisper.cpp via whisper.rn native bindings:

- **Multiple Whisper models** - Tiny, Base, Small (speed vs accuracy tradeoff)
- **Real-time partial transcription** - Streaming word-by-word results
- **Hold-to-record interface** - Slide-to-cancel gesture support
- **No network** - All transcription happens on-device
- **Auto-download** - Whisper models downloaded on first use
- **Language support** - Multilingual transcription

**Implementation:**
- whisper.rn native module handles audio recording and inference
- Transcription results passed via callbacks to React Native
- Audio temporarily buffered in native code, cleared after transcription
- Model selection in settings (Tiny: fastest, Base: balanced, Small: most accurate)

### Image Generation Modes

**Auto Detection:**
- AI automatically classifies user intent (text response vs image generation)
- Uses pattern matching or LLM-based classification (configurable)
- Pattern mode: Fast keyword matching ("draw", "generate", "create image")
- LLM mode: More accurate, uses loaded text model for classification

**Manual Override:**
- Toggle button forces image generation mode
- Useful when auto-detection misclassifies
- Stays active for current message only

**Settings Configuration:**
```typescript
// Image generation mode setting
imageGenerationMode: 'off' | 'auto' | 'manual'

// Auto-detection method
autoDetectMethod: 'pattern' | 'llm'
```

### Security Features

**Passphrase Lock:**
- Protect conversations with passphrase
- App-level security layer on top of OS encryption
- Locks on app backgrounding (configurable timeout)
- Biometric unlock (planned)

**Implementation:**
- Passphrase stored securely in Android Keystore
- Conversations encrypted with AES-256
- No biometric data stored on device

### Model Settings

**Text Model Settings:**
- Temperature (0-2.0) - Creativity control
- Max tokens (64-4096) - Response length limit
- Top-p (0.1-1.0) - Nucleus sampling threshold
- Repeat penalty (1.0-2.0) - Repetition reduction
- Context length (512-8192) - Conversation memory window
- CPU threads (1-12) - Performance tuning
- Batch size (32-512) - Processing chunk size
- GPU layers (0-99) - GPU offload configuration
- Enable GPU (on/off) - Toggle GPU acceleration

**Image Model Settings:**
- Steps (4-50) - Quality vs speed (default: 20)
- Guidance scale (1-20) - Prompt adherence (default: 7.5)
- Seed (random/fixed) - Reproducibility control
- Resolution (256x256-512x512) - Output size
- Preview interval (1-10) - Real-time preview frequency
- Enhance prompts (on/off) - AI prompt enhancement toggle
- Detection method (pattern/LLM) - Intent classification mode
- Threads (1-8) - CPU thread count for image generation

**Global Configuration:**
All settings are global and apply to every model. Settings persist across app restarts and affect all models uniformly.

### Overload Prevention

**Pre-Load Memory Checks:**
Before loading any model, system calculates:
```typescript
// Text models
requiredRAM = fileSize * 1.5  // KV cache, activations

// Vision models
requiredRAM = (modelFileSize + mmProjSize) * 1.5

// Image models
requiredRAM = fileSize * 1.8  // MNN/QNN runtime overhead
```

**Memory Budget:**
- Uses 60% of device RAM as safe limit
- Warns at 50% (yellow warning UI)
- Blocks at 60%+ (red error, prevents load)

**User-Friendly Messages:**
```
"Cannot load Qwen3-7B-Q4_K_M (~5.5GB required) - would exceed
device safe limit of 4.8GB. Unload current model or choose smaller."
```

**Benefits:**
- Prevents app crashes from OOM
- Guides users toward compatible models
- Shows exact RAM requirements before download

### Performance Settings Deep Dive

**CPU Threads:**
- More threads = faster inference (to a point)
- Optimal: 4-6 threads on most devices
- Flagship: 6-8 threads
- Diminishing returns beyond 8

**Batch Size:**
- Smaller (32-128): Faster first token
- Larger (256-512): Better throughput
- Default 256: Balanced for mobile

**Context Length:**
- Longer context = more memory + slower
- Automatic truncation when exceeded
- Recommendations:
  - 512: Short conversations
  - 2048: Standard (default)
  - 4096-8192: Long conversations (requires 8GB+ RAM)

**GPU Offloading:**
- Specify number of layers to offload (0-99)
- More layers = faster (if stable)
- OpenCL backend experimental (can crash)
- Start with 0, incrementally increase
- Automatic fallback to CPU if fails

---

## Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                       React Native UI Layer                       │
│            (Brutalist Design System - TypeScript/TSX)            │
├──────────────────────────────────────────────────────────────────┤
│                  TypeScript Services Layer                        │
│                                                                   │
│   Core Services (background-safe singletons):                    │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐│
│   │   llmService    │  │  whisperService │  │ hardwareService ││
│   │  (llama.rn)     │  │  (whisper.rn)   │  │  (RAM/CPU info) ││
│   └─────────────────┘  └─────────────────┘  └─────────────────┘│
│                                                                   │
│   Orchestration Services (lifecycle-independent):                │
│   ┌───────────────────────┐  ┌───────────────────────┐          │
│   │  generationService    │  │ imageGenerationService│          │
│   │  (text, background)   │  │  (images, background) │          │
│   └───────────────────────┘  └───────────────────────┘          │
│                                                                   │
│   Management Services:                                           │
│   ┌────────────────────┐  ┌────────────────────┐                │
│   │activeModelService  │  │   modelManager     │                │
│   │(singleton, mem mgmt)│  │(download, storage) │                │
│   └────────────────────┘  └────────────────────┘                │
├──────────────────────────────────────────────────────────────────┤
│                    Native Module Bridge (JNI)                     │
├──────────────────────────────────────────────────────────────────┤
│   Native Implementations:                                         │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│   │ llama.rn │  │whisper.rn│  │local-dream│  │DownloadManager│  │
│   │(C++ JNI) │  │(C++ JNI) │  │(C++/MNN)  │  │   (Kotlin)    │  │
│   └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│   Hardware Acceleration:                                          │
│   ┌──────────────────┐            ┌──────────────────┐           │
│   │OpenCL (Adreno GPU)│            │   QNN (NPU)      │           │
│   │  Text LLMs only   │            │  Image gen only  │           │
│   └──────────────────┘            └──────────────────┘           │
└──────────────────────────────────────────────────────────────────┘
```

### Key Design Patterns

**1. Singleton Services**

All core services (`llmService`, `activeModelService`, `generationService`, `imageGenerationService`) are singleton instances to prevent:
- Duplicate model loading
- Concurrent inference conflicts
- Memory leaks from orphaned contexts
- State desynchronization

Example from `activeModelService.ts`:
```typescript
class ActiveModelService {
  private loadedTextModelId: string | null = null;
  private textLoadPromise: Promise<void> | null = null;

  async loadTextModel(modelId: string) {
    // Guard against concurrent loads
    if (this.textLoadPromise) {
      await this.textLoadPromise;
      if (this.loadedTextModelId === modelId) return;
    }
    // ... load logic
  }
}
export const activeModelService = new ActiveModelService();
```

**2. Background-Safe Orchestration**

`generationService` and `imageGenerationService` maintain state independently of React component lifecycle:

```typescript
class GenerationService {
  private state: GenerationState = { isGenerating: false, ... };
  private listeners: Set<GenerationListener> = new Set();

  subscribe(listener: GenerationListener): () => void {
    this.listeners.add(listener);
    listener(this.getState()); // Immediate state delivery
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach(listener => listener(state));
  }
}
```

Screens subscribe on mount, get current state immediately, continue receiving updates until unmount. Generation continues regardless of UI state.

**3. Memory-First Loading**

All model loads check available RAM before proceeding:

```typescript
async loadTextModel(modelId: string) {
  const model = store.downloadedModels.find(m => m.id === modelId);

  // Estimate: file size × 1.5 for text (KV cache overhead)
  const estimatedRAM = (model.fileSize / (1024**3)) * 1.5;

  // Check against device RAM budget (60% of total)
  const deviceRAM = await hardwareService.getDeviceInfo();
  const budget = (deviceRAM.totalMemory / (1024**3)) * 0.6;

  if (estimatedRAM > budget) {
    throw new Error('Insufficient RAM');
  }

  await llmService.loadModel(model.filePath);
}
```

Vision models add mmproj overhead, image models multiply by 1.8× for MNN/QNN runtime.

**4. Combined Asset Tracking**

Vision models track both main GGUF and mmproj as single logical unit:

```typescript
interface DownloadedModel {
  id: string;
  filePath: string;
  fileSize: number;

  // Vision-specific
  mmProjPath?: string;
  mmProjFileSize?: number;
  isVisionModel: boolean;
}

// Total size calculation
const totalSize = model.fileSize + (model.mmProjFileSize || 0);
const totalRAM = totalSize * 1.5; // Both contribute to RAM estimate
```

**5. Aggressive State Cleanup**

After prompt enhancement (which uses `llmService`), explicit cleanup ensures text generation doesn't hang:

```typescript
// After enhancement completes
await llmService.stopGeneration();  // Clear generating flag
// Note: KV cache NOT cleared to preserve vision inference speed
```

Vision inference can be 30-60s slower if KV cache is cleared after every enhancement.

---

## Design System Implementation

### Brutalist Design Philosophy

LocalLLM uses a terminal-inspired brutalist design system implemented in February 2026, refactoring 20+ screens and components. The system rejects modern mobile UI conventions (rounded corners, shadows, gradients, colorful accents) in favor of information density and functional minimalism.

### Design Tokens

All styling uses centralized tokens defined in `src/constants/index.ts`:

**Typography (10-level scale, all Menlo monospace):**
```typescript
export const TYPOGRAPHY = {
  display: { fontSize: 22, fontWeight: '200' },
  h1: { fontSize: 24, fontWeight: '300' },      // Hero text only
  h2: { fontSize: 16, fontWeight: '400' },      // Screen titles
  h3: { fontSize: 13, fontWeight: '400' },      // Section headers
  body: { fontSize: 14, fontWeight: '400' },    // Primary content
  bodySmall: { fontSize: 13, fontWeight: '400' }, // Descriptions
  label: { fontSize: 10, fontWeight: '400' },   // Uppercase labels
  labelSmall: { fontSize: 9, fontWeight: '400' },
  meta: { fontSize: 10, fontWeight: '300' },    // Timestamps
  metaSmall: { fontSize: 9, fontWeight: '300' },
};
```

**Spacing (6-step scale):**
```typescript
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};
```

**Colors (monochromatic palette):**
```typescript
export const COLORS = {
  background: '#0A0A0A',      // Pure black
  surface: '#141414',         // Cards, elevated elements
  surfaceHover: '#1E1E1E',
  border: '#252525',

  text: '#FFFFFF',            // Primary text
  textSecondary: '#B0B0B0',   // Secondary text
  textMuted: '#808080',       // Metadata
  textDisabled: '#404040',

  accent: '#34D399',          // Emerald - only color accent
  accentHover: '#10B981',

  error: '#EF4444',           // Red for errors only
  success: '#34D399',         // Same as accent
};
```

### UI Patterns

**Labels (uppercase, small, muted):**
```typescript
<Text style={[TYPOGRAPHY.label, { color: COLORS.textMuted, letterSpacing: 0.3 }]}>
  ACTIVE MODEL
</Text>
```

**Buttons (transparent with borders, no fill):**
```typescript
<TouchableOpacity style={{
  paddingVertical: SPACING.sm,
  paddingHorizontal: SPACING.md,
  borderWidth: 1,
  borderColor: isActive ? COLORS.accent : COLORS.border,
  backgroundColor: 'transparent', // Never filled
  borderRadius: 8,
}}>
  <Text style={[TYPOGRAPHY.body, { color: isActive ? COLORS.accent : COLORS.text }]}>
    {label}
  </Text>
</TouchableOpacity>
```

**Cards (subtle surface, minimal borders):**
```typescript
<View style={{
  backgroundColor: COLORS.surface,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: COLORS.border,
  padding: SPACING.md,
}}>
  {/* content */}
</View>
```

**No exceptions:** Every UI element uses these tokens. Zero hardcoded colors, font sizes, or spacing values anywhere in codebase.

---

## State Management

### Zustand Stores

Application state managed via Zustand with AsyncStorage persistence:

**appStore** (`src/stores/appStore.ts`):
- Downloaded models (text, image, Whisper)
- Active model IDs
- Settings (temperature, context length, GPU config, image gen params)
- Hardware info (RAM, available memory)
- Gallery (generated images metadata)
- Background generation state (progress, status, preview path)

**chatStore** (`src/stores/chatStore.ts`):
- Conversations and messages
- Projects (custom system prompts)
- Streaming state (current streaming message)
- Message operations (add, update, delete, edit)

**Persistence:**
```typescript
const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // state and actions
    }),
    {
      name: 'app-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
```

All stores automatically persist to AsyncStorage on state changes, rehydrate on app launch.

### Service-Store Synchronization

Services update stores for UI reactivity:

```typescript
// imageGenerationService updates appStore during generation
private updateState(partial: Partial<ImageGenerationState>): void {
  this.state = { ...this.state, ...partial };
  this.notifyListeners();

  const appStore = useAppStore.getState();
  if ('isGenerating' in partial) {
    appStore.setIsGeneratingImage(this.state.isGenerating);
  }
  if ('progress' in partial) {
    appStore.setImageGenerationProgress(this.state.progress);
  }
}
```

UI components read from stores, services write to stores. Unidirectional data flow.

---

## Background Operations

### Background Downloads (Android)

Native Android DownloadManager handles model downloads:

**Implementation** (`android/app/src/main/java/com/localllm/download/DownloadManagerModule.kt`):
```kotlin
class DownloadManagerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  fun downloadFile(url: String, fileName: String, modelId: String) {
    val request = DownloadManager.Request(Uri.parse(url))
      .setTitle(fileName)
      .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
      .setDestinationInExternalFilesDir(context, "models", fileName)

    val downloadId = downloadManager.enqueue(request)

    // Poll download progress
    monitorDownload(downloadId, modelId)
  }
}
```

Downloads continue even when app is backgrounded or killed. Native notifications show progress. React Native polls for updates via `BroadcastReceiver`.

**Race Condition Fix (Recent):**
On slow emulators, download completion notification could arrive before React Native received `DownloadComplete` event. Fixed by tracking event delivery separately:

```kotlin
// Track event delivery separately from completion status
private data class DownloadInfo(
  val downloadId: Long,
  val modelId: String,
  var completedEventSent: Boolean = false  // New field
)

// Only send event if not already sent
if (!info.completedEventSent) {
  sendDownloadCompleteEvent(modelId)
  info.completedEventSent = true
}
```

### Background Image Generation

`imageGenerationService` maintains generation state independently of React component lifecycle. Native local-dream inference continues on background threads while JavaScript service layer notifies any mounted subscribers.

**Flow:**
1. User starts generation in ChatScreen
2. ChatScreen subscribes to `imageGenerationService`
3. User navigates to HomeScreen (ChatScreen unmounts)
4. Generation continues, service maintains state
5. HomeScreen mounts, subscribes, immediately receives current state (progress, preview)
6. User navigates back to ChatScreen
7. ChatScreen re-subscribes, receives current state (may be complete)

Subscribers are weakly held, services never leak references.

---

## Model Management

### Model Browsing and Discovery

**Text Models:**
- Hugging Face API integration (`src/services/modelManager.ts`)
- Filters: LM Studio compatible, Official/Verified/Community
- Automatic GGUF quantization detection
- RAM compatibility checks based on device memory

**Image Models:**
- xororz HuggingFace repos (pre-converted MNN/QNN)
- Dynamic model list fetch
- Backend filtering (CPU/NPU)
- Chipset variant selection for QNN models

### Download Management

**Features:**
- Background downloads via native Android DownloadManager
- Automatic retry on network interruption
- Storage space pre-check before download
- Combined progress for vision models (shows total for GGUF + mmproj)
- Parallel downloads supported

**Storage Management:**
- Orphaned file detection (GGUF files not tracked in store)
- Stale download cleanup (invalid entries from interrupted downloads)
- Bulk deletion of orphaned files
- Model size breakdown with mmproj overhead included

### Memory Management

**Dynamic Memory Budget:**
- Uses 60% of device RAM as budget for models
- Warns at 50% usage (yellow warning)
- Blocks at 60%+ usage (red error)
- Text models: file size × 1.5 (KV cache, activations)
- Image models: file size × 1.8 (MNN/QNN runtime, intermediate tensors)
- Vision models: text estimate + mmproj overhead

**Pre-load Checks:**
```typescript
async checkMemoryForModel(modelId: string, modelType: 'text' | 'image') {
  const deviceRAM = await hardwareService.getDeviceInfo();
  const budget = (deviceRAM.totalMemory / (1024**3)) * 0.60;

  const model = findModel(modelId, modelType);
  const requiredRAM = estimateModelMemory(model, modelType);
  const currentlyLoaded = getCurrentlyLoadedMemory();
  const totalRequired = requiredRAM + currentlyLoaded;

  if (totalRequired > budget) {
    return { canLoad: false, severity: 'critical', message: '...' };
  }
  // ...
}
```

Prevents OOM crashes by blocking loads that would exceed safe RAM limits.

---

## Use Cases

### 1. Offline AI Assistant

**Scenario:** User travels with no internet access, needs AI assistance for writing, research, or problem-solving.

**Implementation:**
- Download Qwen3-2B-Instruct (Q4_K_M, ~2.5GB) once
- Create project with custom system prompt: "You are a helpful writing assistant..."
- Generate responses entirely on-device
- All conversations persist locally

**Performance:** 5-10 tok/s on mid-range devices, 15-30 tok/s on flagships.

### 2. Private Image Generation

**Scenario:** Artist/designer needs AI-generated images but doesn't want prompts or outputs sent to cloud services.

**Implementation:**
- Download Anything V5 (CPU) or DreamShaper (NPU) image model
- Enable prompt enhancement for detailed results from simple inputs
- Generate images with seed control for reproducibility
- Save to device gallery or share directly

**Privacy:** Zero network activity after model download. Prompts never leave device.

### 3. Document Analysis with Vision

**Scenario:** User needs to analyze receipts, invoices, or documents on the go without internet.

**Implementation:**
- Download SmolVLM-500M (vision model, ~600MB)
- Capture document photo via camera
- Send to model with prompt: "Extract all line items and totals"
- Receive structured text response

**Performance:** ~7s inference on flagship devices.

### 4. Code Review and Debugging

**Scenario:** Developer needs code assistance without sharing proprietary code with cloud services.

**Implementation:**
- Download Qwen3-Coder or Phi-3-Mini (Q4_K_M)
- Create "Code Review" project with system prompt
- Paste code snippets, receive suggestions
- All code stays on device

**Use case:** Security-sensitive environments, air-gapped development, competitive advantage protection.

### 5. Language Learning Practice

**Scenario:** Language learner practices conversations without subscription or data harvesting.

**Implementation:**
- Download multilingual model (Qwen3, Command-R)
- Create project: "You are a patient Spanish tutor..."
- Voice input via Whisper for pronunciation practice
- Text responses for grammar explanation

**Advantages:** Unlimited practice, no usage limits, complete privacy.

---

## Known Issues and Limitations

### Vision Models

**Performance Considerations:**
- Vision inference can take 10-30+ seconds depending on model size and device
- Larger models (2B+) are slower but provide better understanding
- SmolVLM models offer fastest inference (7-15s on flagship devices)
- Comprehensive logging tracks vision inference progress for debugging

### GPU Acceleration

**OpenCL Stability:**
- OpenCL backend can crash on some Qualcomm devices
- Crash typically happens during layer offload initialization
- Automatic fallback to CPU if GPU initialization fails
- User can manually reduce GPU layers or disable entirely

**Recommendation:** Start with 0 GPU layers, incrementally increase while monitoring stability.

---

## Technical Stack

### Core Dependencies

- **React Native 0.74** - Cross-platform mobile framework
- **TypeScript 5.x** - Type safety and developer experience
- **llama.rn** - Native bindings for llama.cpp GGUF inference
- **whisper.rn** - Native bindings for whisper.cpp speech recognition
- **local-dream** - MNN/QNN Stable Diffusion implementation
- **Zustand 4.x** - Lightweight state management
- **AsyncStorage** - Persistent local storage
- **React Navigation 6.x** - Native navigation

### Native Modules

**llama.rn:**
- Compiles llama.cpp for ARM64 Android
- JNI bindings expose inference APIs to JavaScript
- Supports OpenCL GPU offloading on Adreno GPUs
- Handles multimodal (vision) via mmproj

**whisper.rn:**
- Compiles whisper.cpp for ARM64 Android
- Real-time audio recording and transcription
- Multiple model sizes (Tiny, Base, Small, Medium)

**local-dream:**
- C++ implementation of Stable Diffusion
- MNN backend (CPU, all ARM64 devices)
- QNN backend (NPU, Snapdragon 8 Gen 1+)
- Automatic backend detection and fallback

**DownloadManager:**
- Native Android DownloadManager wrapper
- Background download support
- Progress polling and event emission to React Native
- Proper cleanup and error handling

---

## Getting Started

### Install Pre-built APK

The fastest way to get started:

1. **Download** the latest APK from [GitHub Releases](https://github.com/alichherawalla/offline-mobile-llm-manager/releases/latest)
2. **Transfer** to your Android device
3. **Enable** "Install from Unknown Sources" in Android Settings → Security
4. **Install** and launch LocalLLM
5. **Download a model** from the Models tab and start chatting

### Build from Source

For developers who want to build from source or contribute:

---

## Building from Source

### Prerequisites

- Node.js 18+
- JDK 17
- Android SDK (API 34)
- Android NDK r26
- React Native CLI

### Setup

```bash
# Clone repository
git clone https://github.com/alichherawalla/offline-mobile-llm-manager.git
cd LocalLLM

# Install JavaScript dependencies
npm install

# Android setup
cd android
./gradlew clean

# Return to root
cd ..
```

### Development Build

```bash
# Start Metro bundler
npm start

# In separate terminal, deploy to device
npm run android

# Or use Android Studio
# Open android/ folder in Android Studio
# Build → Make Project
# Run → Run 'app'
```

### Release Build

```bash
cd android
./gradlew assembleRelease

# Output: android/app/build/outputs/apk/release/app-release.apk
```

### Signing Configuration

Create `android/gradle.properties`:
```properties
MYAPP_RELEASE_STORE_FILE=your-release-key.keystore
MYAPP_RELEASE_KEY_ALIAS=your-key-alias
MYAPP_RELEASE_STORE_PASSWORD=***
MYAPP_RELEASE_KEY_PASSWORD=***
```

Add to `android/app/build.gradle`:
```gradle
android {
    signingConfigs {
        release {
            storeFile file(MYAPP_RELEASE_STORE_FILE)
            storePassword MYAPP_RELEASE_STORE_PASSWORD
            keyAlias MYAPP_RELEASE_KEY_ALIAS
            keyPassword MYAPP_RELEASE_KEY_PASSWORD
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            // ...
        }
    }
}
```

---

## Project Structure

```
LocalLLM/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── ChatInput.tsx           # Message input with attachments
│   │   ├── ChatMessage.tsx         # Message bubbles with metadata
│   │   ├── ModelCard.tsx           # Model display card
│   │   ├── ModelSelectorModal/     # Quick model switcher
│   │   ├── CustomAlert.tsx         # Consistent alert dialogs
│   │   └── ...
│   ├── constants/           # Design tokens and configuration
│   │   └── index.ts               # TYPOGRAPHY, SPACING, COLORS
│   ├── hooks/               # Custom React hooks
│   │   ├── useKeyboard.ts         # Keyboard visibility
│   │   ├── useDebounce.ts         # Debounced values
│   │   └── ...
│   ├── navigation/          # React Navigation setup
│   │   └── AppNavigator.tsx       # Tab and stack navigators
│   ├── screens/             # Main app screens
│   │   ├── HomeScreen.tsx         # Dashboard with model status
│   │   ├── ChatScreen.tsx         # Main chat interface
│   │   ├── ModelsScreen.tsx       # Browse and download models
│   │   ├── GalleryScreen.tsx      # Generated images gallery
│   │   ├── DownloadManagerScreen.tsx # Download tracking
│   │   ├── StorageSettingsScreen.tsx # Storage management
│   │   └── ...
│   ├── services/            # Core business logic
│   │   ├── llm.ts                 # Text LLM inference
│   │   ├── activeModelService.ts  # Model lifecycle management
│   │   ├── modelManager.ts        # Download and storage
│   │   ├── generationService.ts   # Text generation orchestration
│   │   ├── imageGenerationService.ts # Image generation orchestration
│   │   ├── localDreamGenerator.ts # local-dream bridge
│   │   ├── hardwareService.ts     # Device info and memory
│   │   ├── documentService.ts     # Document text extraction
│   │   └── ...
│   ├── stores/              # Zustand state management
│   │   ├── appStore.ts            # Global app state
│   │   └── chatStore.ts           # Conversations and messages
│   └── types/               # TypeScript type definitions
│       └── index.ts               # All interfaces and types
├── android/                 # Android native code
│   └── app/src/main/java/com/localllm/
│       ├── download/              # Background download manager
│       │   └── DownloadManagerModule.kt
│       ├── localdream/            # local-dream native module
│       │   └── LocalDreamModule.kt
│       └── ...
├── docs/                    # Documentation
│   ├── CODEBASE_GUIDE.md         # Comprehensive architecture guide
│   ├── DESIGN_PHILOSOPHY_SYSTEM.md # Design system reference
│   └── ...
└── .claude/                 # Claude Code configuration
    ├── memory/                    # Auto memory files
    └── skills/                    # Custom skills/guidelines
```

---

## Quantization Reference

GGUF quantization methods and their trade-offs:

| Quantization | Bits | Quality | 7B Size | RAM | Use Case |
|--------------|------|---------|---------|-----|----------|
| Q2_K | 2-3 bit | Lowest | ~2.5 GB | ~3.5 GB | Very constrained devices |
| Q3_K_M | 3-4 bit | Low-Med | ~3.3 GB | ~4.5 GB | Budget devices, testing |
| Q4_K_M | 4-5 bit | Good | ~4.0 GB | ~5.5 GB | Recommended default |
| Q5_K_M | 5-6 bit | Very Good | ~5.0 GB | ~6.5 GB | Quality-focused users |
| Q6_K | 6 bit | Excellent | ~6.0 GB | ~7.5 GB | Flagship devices |
| Q8_0 | 8 bit | Near FP16 | ~7.5 GB | ~9.0 GB | Maximum quality |

**Recommendation:** Q4_K_M provides best balance. Q5_K_M for quality on devices with 8GB+ RAM.

---

## Performance Characteristics

### Text Generation

**Flagship devices (Snapdragon 8 Gen 2+):**
- CPU: 15-30 tok/s (4-8 threads)
- GPU (OpenCL): 20-40 tok/s (experimental, stability varies)
- TTFT: 0.5-2s depending on context length

**Mid-range devices (Snapdragon 7 series):**
- CPU: 5-15 tok/s
- TTFT: 1-3s

**Factors:**
- Model size (larger = slower)
- Quantization (lower bits = faster)
- Context length (more tokens = slower)
- Thread count (4-8 threads optimal)
- GPU layers (more = faster if stable)

### Vision Inference

**SmolVLM 500M:**
- Flagship: ~7s per image
- Mid-range: ~15s per image

**SmolVLM 2.2B:**
- Flagship: ~10-15s per image
- Mid-range: ~25-35s per image

**Factors:**
- Image resolution (higher = slower)
- Model size (larger = slower)
- KV cache state (warm cache = faster)

### Image Generation

**CPU (MNN):**
- 512×512, 20 steps: ~15s (Snapdragon 8 Gen 3)
- 512×512, 20 steps: ~30s (Snapdragon 7 series)

**NPU (QNN):**
- 512×512, 20 steps: ~5-10s (chipset-dependent)
- Requires Snapdragon 8 Gen 1+ with QNN support

**Factors:**
- Step count (more steps = better quality, slower)
- Resolution (higher = exponentially slower)
- Backend (NPU > CPU)

---

## Security and Privacy

### Data Storage

- **Conversations:** AsyncStorage (encrypted at OS level)
- **Models:** Internal app files directory
- **Images:** Internal app files directory + optional export to Pictures
- **Settings:** AsyncStorage

All data stored in app's private storage, inaccessible to other apps (Android sandboxing).

### Network Activity

**Model download only:**
- Hugging Face API (model metadata)
- Hugging Face CDN (model file downloads)
- xororz HuggingFace repos (image model listings)

**After model download:**
- Zero network activity
- Enable airplane mode and use indefinitely
- All inference happens on-device

### Optional Security Features

- **Passphrase lock** for sensitive conversations
- **Biometric authentication** (planned)
- **Conversation export/import** with encryption (planned)

---

## Contributing

Contributions welcome. Please:

1. Fork repository
2. Create feature branch
3. Follow existing code style (TypeScript, design tokens)
4. Add tests where applicable
5. Update documentation
6. Submit pull request

### Development Guidelines

- Use design tokens (TYPOGRAPHY, SPACING, COLORS) for all styling
- Follow singleton pattern for services
- Implement background-safe operations for long-running tasks
- Add comprehensive logging for debugging
- Check memory before model operations
- Handle errors gracefully with user-friendly messages

---

## License

MIT License - See LICENSE file for details.

---

## Acknowledgments

- [llama.cpp](https://github.com/ggerganov/llama.cpp) by Georgi Gerganov - LLM inference engine
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) by Georgi Gerganov - Speech recognition engine
- [local-dream](https://github.com/nicenemo/local-dream) - On-device Stable Diffusion
- [MNN](https://github.com/alibaba/MNN) by Alibaba - Mobile neural network inference framework
- [llama.rn](https://github.com/mybigday/llama.rn) by mybigday - React Native bindings for llama.cpp
- [whisper.rn](https://github.com/mybigday/whisper.rn) by mybigday - React Native bindings for whisper.cpp
- [Hugging Face](https://huggingface.co) - Model hosting and discovery
- [xororz](https://huggingface.co/xororz) - Pre-converted Stable Diffusion models for MNN and QNN

---

**LocalLLM** — Your AI, your device, your data. Built with privacy in mind, powered by open-source AI.
