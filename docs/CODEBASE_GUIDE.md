# LocalLLM — Comprehensive Codebase & Product Flows Guide

This document provides an in-depth reference for the LocalLLM application: its architecture, every major subsystem, data models, native integrations, and detailed product flows.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Architecture & Technology Stack](#2-architecture--technology-stack)
3. [Directory Structure](#3-directory-structure)
4. [Navigation & Screen Map](#4-navigation--screen-map)
5. [State Management (Zustand Stores)](#5-state-management-zustand-stores)
6. [Data Models & Types](#6-data-models--types)
7. [Core Services](#7-core-services)
8. [Native Integration Layer](#8-native-integration-layer)
9. [Product Flows — Detailed](#9-product-flows--detailed)
10. [Testing Infrastructure](#10-testing-infrastructure)
11. [Constants & Configuration](#11-constants--configuration)
12. [File System Layout (On-Device)](#12-file-system-layout-on-device)
13. [Appendix: Default System Prompt](#appendix-default-system-prompt)
14. [Appendix: Default Projects](#appendix-default-projects)
15. [Appendix: Claude Code Memory System](#appendix-claude-code-memory-system)

---

## 1. Product Overview

LocalLLM is a **privacy-first, on-device AI assistant** built with React Native. It runs large language models (LLMs), Stable Diffusion image generators, and Whisper speech-to-text models entirely on the user's phone — no server, no internet required after initial model download.

**Core capabilities:**
- Text chat with streaming LLM inference (llama.cpp via `llama.rn`)
- Image generation with Stable Diffusion (MNN/QNN backends via LocalDream)
- Voice input via Whisper speech-to-text (whisper.cpp via `whisper.rn`)
- Vision model support (multimodal LLMs with image understanding)
- Document attachment and analysis
- Project-based system prompt presets
- Generated image gallery with metadata
- Passphrase lock with lockout protection
- Model browsing and download from Hugging Face

**Platform support:**
- iOS: Text generation (Metal GPU), Whisper. No image generation (LocalDream is Android-only).
- Android: Full feature set including image generation (MNN CPU, QNN NPU on Qualcomm), background downloads via system DownloadManager.

---

## 2. Architecture & Technology Stack

### Runtime
| Layer | Technology |
|-------|-----------|
| Framework | React Native (TypeScript) |
| Navigation | React Navigation 6 (native stack + bottom tabs) |
| State | Zustand with `persist` middleware → AsyncStorage |
| Styling | React Native StyleSheet (dark theme, custom palette) |

### On-Device AI
| Capability | Library | Native Backend |
|------------|---------|----------------|
| Text LLM | `llama.rn` ^0.11 | llama.cpp (C++) — Metal (iOS), CPU (Android) |
| Image Gen | Custom `LocalDreamModule` | `libstable_diffusion_core.so` subprocess on localhost:18081 |
| Speech-to-Text | `whisper.rn` ^0.5 | whisper.cpp (C++) |

### Platform Services
| Service | Library |
|---------|---------|
| File I/O | `react-native-fs` |
| Persistence | `@react-native-async-storage/async-storage` |
| Secure Storage | `react-native-keychain` |
| Device Info | `react-native-device-info` |
| Image Picker | `react-native-image-picker` |
| Zip Extraction | `react-native-zip-archive` |
| Icons | `react-native-vector-icons` (Feather) |

### Key Design Patterns
- **Lifecycle-independent services** — Text and image generation continue running even when the user navigates away from the chat screen. Services use a subscriber/observer pattern so any screen can re-attach.
- **Selective persistence** — Only durable state is persisted (conversations, settings, downloaded model metadata). Transient UI state (streaming position, loading flags) is kept in memory only.
- **Two model loading strategies** — "Performance" keeps the model in RAM across generations; "Memory" unloads after each generation to free RAM.
- **Hybrid intent classification** — Fast regex pattern matching with optional LLM fallback for ambiguous prompts.

---

## 3. Directory Structure

```
LocalLLM/
├── App.tsx                              # Root component: init, auth gate, navigation
├── app.json                             # RN app config (name: "LocalLLM", bundle: com.localllm)
├── package.json                         # Dependencies & scripts
├── tsconfig.json                        # TypeScript config
│
├── src/
│   ├── components/                      # Reusable UI components
│   │   ├── Button.tsx                   # Styled button
│   │   ├── Card.tsx                     # Card layout
│   │   ├── ChatInput.tsx                # Message input bar (text, voice, attachments, image mode)
│   │   ├── ChatMessage.tsx              # Single message bubble (streaming, images, metadata)
│   │   ├── CustomAlert.tsx              # Alert dialog
│   │   ├── GenerationSettingsModal.tsx  # All generation settings in a modal
│   │   ├── ModelCard.tsx                # Model browser card with download state
│   │   ├── ModelSelectorModal.tsx       # Model picker modal (text + image models)
│   │   └── VoiceRecordButton.tsx        # Long-press voice recording with waveform
│   │
│   ├── screens/                         # Screen components (19 screens)
│   │   ├── OnboardingScreen.tsx         # Welcome slides
│   │   ├── ModelDownloadScreen.tsx      # First model download during onboarding
│   │   ├── HomeScreen.tsx               # Dashboard: active models, memory, recent chats
│   │   ├── ChatScreen.tsx               # Main chat (67KB — largest screen)
│   │   ├── ChatsListScreen.tsx          # Conversation list
│   │   ├── ModelsScreen.tsx             # Model browser (text + image tabs)
│   │   ├── ProjectsScreen.tsx           # Projects list
│   │   ├── ProjectDetailScreen.tsx      # View project + linked chats
│   │   ├── ProjectEditScreen.tsx        # Create/edit project
│   │   ├── GalleryScreen.tsx            # Generated image grid
│   │   ├── SettingsScreen.tsx           # Settings hub
│   │   ├── ModelSettingsScreen.tsx      # LLM + image gen parameters
│   │   ├── VoiceSettingsScreen.tsx      # Whisper model management
│   │   ├── DeviceInfoScreen.tsx         # Hardware specs
│   │   ├── StorageSettingsScreen.tsx    # Per-model storage usage
│   │   ├── SecuritySettingsScreen.tsx   # Passphrase toggle + change
│   │   ├── LockScreen.tsx              # Passphrase entry with lockout
│   │   ├── PassphraseSetupScreen.tsx    # Initial passphrase creation
│   │   └── DownloadManagerScreen.tsx    # Active downloads (modal)
│   │
│   ├── navigation/
│   │   ├── AppNavigator.tsx             # Root stack + tab navigator definitions
│   │   ├── types.ts                     # Navigation param types
│   │   └── index.ts
│   │
│   ├── stores/                          # Zustand state stores
│   │   ├── appStore.ts                  # App-wide state (models, settings, device, gallery)
│   │   ├── chatStore.ts                 # Conversations + messages + streaming
│   │   ├── authStore.ts                 # Auth state + lockout
│   │   ├── projectStore.ts             # Projects (system prompt presets)
│   │   └── whisperStore.ts             # Whisper model state
│   │
│   ├── services/                        # Business logic & native bridges
│   │   ├── llm.ts                       # LLMService — llama.rn context, streaming, GPU
│   │   ├── activeModelService.ts        # Singleton — load/unload text & image models
│   │   ├── modelManager.ts             # Download, store, track model files
│   │   ├── generationService.ts        # Lifecycle-independent text generation
│   │   ├── imageGenerationService.ts   # Lifecycle-independent image generation
│   │   ├── localDreamGenerator.ts      # ONNX SD wrapper (native subprocess)
│   │   ├── imageGenerator.ts           # Image generator helper
│   │   ├── intentClassifier.ts         # Pattern + LLM intent detection
│   │   ├── huggingface.ts              # HF API: search, files, credibility
│   │   ├── huggingFaceModelBrowser.ts  # Image model browsing
│   │   ├── whisperService.ts           # Whisper model download/load/transcribe
│   │   ├── voiceService.ts             # Native voice input bridge
│   │   ├── authService.ts              # Passphrase hash + keychain
│   │   ├── hardware.ts                 # Device info, RAM, recommendations
│   │   ├── backgroundDownloadService.ts # Android DownloadManager bridge
│   │   └── documentService.ts          # Document text extraction
│   │
│   ├── hooks/
│   │   ├── useAppState.ts              # AppState foreground/background tracking
│   │   ├── useVoiceRecording.ts        # Voice recording state machine
│   │   └── useWhisperTranscription.ts  # Whisper transcription hook
│   │
│   ├── types/
│   │   └── index.ts                    # All TypeScript interfaces & type aliases
│   │
│   ├── constants/
│   │   └── index.ts                    # Model recommendations, quantization info, HF config, colors
│   │
│   └── utils/
│       └── messageContent.ts           # Strip LLM control tokens from output
│
├── android/                             # Android native code
│   └── app/src/main/java/com/localllm/
│       ├── localdream/
│       │   └── LocalDreamModule.kt      # Stable Diffusion native module
│       └── download/
│           └── DownloadManagerModule.kt # Background download native module
│
├── ios/                                 # iOS native code (minimal — uses RN library natives)
│
├── __tests__/                           # Test suites
│   ├── unit/                            # Store & service unit tests
│   ├── integration/                     # Multi-service integration tests
│   ├── contracts/                       # Native module contract tests
│   ├── rntl/                            # React Native Testing Library component tests
│   ├── specs/                           # Behavior specifications
│   └── utils/                           # Test helpers & factories
│
├── .maestro/                            # E2E tests (Maestro framework)
│   ├── config.yaml
│   ├── flows/p0/                        # 8 critical-path E2E flows
│   ├── flows/p1/                        # Important-path E2E flows
│   └── utils/
│
├── docs/                                # Documentation
│   └── CODEBASE_GUIDE.md                # This file — comprehensive architecture guide
│
├── patches/                             # patch-package patches
├── releases/                            # Release APKs
│
└── (Claude Code Memory — External)      # NOT in repo
    ~/.claude/projects/-Users-mac-wednesday-on-device-llm-LocalLLM/memory/
    └── MEMORY.md                        # Persistent learnings across conversations
```

---

## 4. Navigation & Screen Map

### Root Navigator (Stack)

```
RootStack
│
├── OnboardingScreen          (shown once, first launch)
├── ModelDownloadScreen        (shown if no models downloaded after onboarding)
├── MainTabs                   (primary app interface)
├── DownloadManagerScreen      (modal overlay)
└── GalleryScreen              (modal overlay, fullscreen image viewer)
```

### Main Tabs (Bottom Tab Navigator, 5 tabs)

```
MainTabs
│
├── HomeTab
│   └── HomeScreen
│
├── ChatsTab (Stack)
│   ├── ChatsListScreen
│   └── ChatScreen
│
├── ProjectsTab (Stack)
│   ├── ProjectsScreen
│   ├── ProjectDetailScreen
│   └── ProjectEditScreen (modal presentation)
│
├── ModelsTab
│   └── ModelsScreen
│
└── SettingsTab (Stack)
    ├── SettingsScreen
    ├── ModelSettingsScreen
    ├── VoiceSettingsScreen
    ├── DeviceInfoScreen
    ├── StorageSettingsScreen
    └── SecuritySettingsScreen
```

### Screen Descriptions

| Screen | Purpose | Key testIDs |
|--------|---------|-------------|
| **OnboardingScreen** | 4 welcome slides (privacy, offline, model choice). Shown once. | `onboarding-screen` |
| **ModelDownloadScreen** | Recommends a model based on device RAM. User downloads or skips. | `model-download-screen` |
| **HomeScreen** | Dashboard: active text/image models, memory usage (used/total), recent conversations, quick "New Chat" button. | `home-screen`, `new-chat-button` |
| **ChatScreen** | Full chat interface. Streaming messages, model selector, project selector, generation settings, image generation with live preview, voice input, document attachments, debug panel. | `chat-screen`, `chat-input`, `send-button`, `stop-button` |
| **ChatsListScreen** | Sorted conversation list. Shows title, last message preview, project badge, timestamp. Swipe-to-delete. | `conversation-list` |
| **ModelsScreen** | Two sections: Text Models and Image Models. Search bar, credibility filters (LM Studio, Official, Verified), type filter (Vision). Download progress, pause/cancel. | `models-screen`, `model-list` |
| **ProjectsScreen** | List of system prompt presets. Shows name, description snippet, linked chat count. Default projects: General Assistant, Spanish Learning, Code Review, Writing Helper. | `projects-screen` |
| **ProjectDetailScreen** | Full project view: name, system prompt, description, linked conversations list. | |
| **ProjectEditScreen** | Create/edit form: name, description, system prompt, icon selection. | |
| **GalleryScreen** | 3-column image grid. Filter by conversation. Multi-select for batch delete. Save to device. View metadata (prompt, steps, seed, model). | `gallery-screen` |
| **SettingsScreen** | Hub with sections: Model Settings, Voice Settings, Security, Storage, Device Info. | `settings-screen` |
| **ModelSettingsScreen** | Sliders/inputs for: system prompt, temperature (0–2), top-p (0–1), repeat penalty (1–2), max tokens, context length, threads, batch size, GPU toggle + layers, image gen steps/guidance/resolution, loading strategy, generation details toggle. | |
| **VoiceSettingsScreen** | Download/select Whisper model (tiny/base/small, English or multilingual). | |
| **DeviceInfoScreen** | Device model, OS, total/available RAM, total/available storage, emulator flag, GPU capabilities. | |
| **StorageSettingsScreen** | Per-category storage (text models, image models, whisper, gallery). Per-model sizes. Delete from here. | |
| **SecuritySettingsScreen** | Toggle passphrase lock. Change passphrase (requires old). | |
| **LockScreen** | Passphrase input. Shows lockout timer (MM:SS) after 5 failed attempts. 5-minute lockout. | `lock-screen` |
| **PassphraseSetupScreen** | Set new passphrase with confirmation. Must match. | |
| **DownloadManagerScreen** | Modal showing all active/completed/failed downloads with progress bars, pause/resume/cancel/retry controls. | |

---

## 5. State Management (Zustand Stores)

All stores use `zustand/middleware` `persist` with AsyncStorage. Only serializable, durable data is persisted; transient UI flags are excluded via `partialize`.

### appStore (`local-llm-app-storage`)

| State Group | Fields | Notes |
|-------------|--------|-------|
| **Onboarding** | `hasCompletedOnboarding` | Set true once, never reset |
| **Device** | `deviceInfo`, `modelRecommendation` | Refreshed on app start |
| **Downloaded Models** | `downloadedModels[]`, `downloadedImageModels[]` | Metadata only; files on disk |
| **Active Models** | `activeModelId`, `activeImageModelId` | Persisted; model re-loaded on next use |
| **Loading Flags** | `isLoadingModel`, `isGeneratingImage` | Not persisted |
| **Downloads** | `downloadProgress{}`, `activeBackgroundDownloads[]` | Background downloads persisted (Android) |
| **Settings** | `systemPrompt`, `temperature`, `maxTokens`, `topP`, `repeatPenalty`, `contextLength`, `nThreads`, `nBatch`, `useGPU`, `nGPULayers`, `modelLoadingStrategy` | All persisted |
| **Image Settings** | `imageSteps`, `imageGuidanceScale`, `imageWidth`, `imageHeight`, `imageThreads` | All persisted |
| **Intent** | `imageGenerationMode`, `autoDetectMethod`, `classifierModelId` | Persisted |
| **UI** | `showGenerationDetails` | Persisted |
| **Gallery** | `generatedImages[]` | Full metadata array, persisted |

### chatStore (`local-llm-chat-storage`)

| State Group | Fields | Notes |
|-------------|--------|-------|
| **Conversations** | `conversations[]` | Full conversation objects with all messages |
| **Active** | `activeConversationId` | Which chat is currently open |
| **Streaming** | `streamingMessage`, `isStreaming`, `isThinking`, `streamingForConversationId` | Not persisted |
| **Actions** | `createConversation()`, `deleteConversation()`, `addMessage()`, `updateMessage()`, `deleteMessage()`, `deleteMessagesAfter()`, `setStreaming()`, `clearAllConversations()` | |

### authStore (`local-llm-auth-storage`)

| Field | Type | Notes |
|-------|------|-------|
| `isEnabled` | boolean | Whether passphrase lock is turned on |
| `isLocked` | boolean | Current lock state |
| `failedAttempts` | number | Resets on success |
| `lockoutUntil` | number \| null | Unix timestamp when lockout expires |
| `lastBackgroundTime` | number \| null | When app went to background (for auto-lock) |
| Constants | `MAX_ATTEMPTS = 5`, `LOCKOUT_DURATION = 5 min` | |

### projectStore (`local-llm-project-storage`)

| Field | Notes |
|-------|-------|
| `projects[]` | Array of Project objects |
| Default projects | General Assistant, Spanish Learning, Code Review, Writing Helper |
| Actions | `createProject()`, `updateProject()`, `deleteProject()`, `duplicateProject()` |

### whisperStore (`local-llm-whisper-storage`)

| Field | Notes |
|-------|-------|
| `downloadedModelId` | Which whisper model is downloaded |
| `isLoading`, `isDownloading` | Transient flags |
| Actions | `downloadModel()`, `loadModel()`, `unloadModel()`, `deleteModel()` |

---

## 6. Data Models & Types

### Core Entities

```
ModelInfo                    # Model from HuggingFace API
├── id, name, author
├── description, downloads, likes, tags
├── files: ModelFile[]
└── credibility?: ModelCredibility

ModelFile                    # A specific quantized file for a model
├── name, size, quantization, downloadUrl
└── mmProjFile?: { name, size, downloadUrl }   # Vision companion

DownloadedModel              # A model file on disk
├── id, name, author
├── filePath, fileName, fileSize, quantization
├── downloadedAt, credibility?
└── isVisionModel?, mmProjPath?, mmProjFileName?, mmProjFileSize?

ONNXImageModel               # Stable Diffusion model on disk
├── id, name, description
├── modelPath, downloadedAt, size
├── style? ('creative' | 'photorealistic' | 'anime')
└── backend? ('mnn' | 'qnn')

Conversation
├── id, title, modelId
├── messages: Message[]
├── createdAt, updatedAt
└── projectId?

Message
├── id, role ('user' | 'assistant' | 'system')
├── content, timestamp
├── isStreaming?, isThinking?, isSystemInfo?
├── attachments?: MediaAttachment[]
├── generationTimeMs?
└── generationMeta?: GenerationMeta

MediaAttachment
├── id, type ('image' | 'document'), uri
├── mimeType?, width?, height?, fileName?
├── textContent? (extracted document text)
└── fileSize?

GenerationMeta
├── gpu, gpuBackend?, gpuLayers?
├── modelName?
├── tokensPerSecond?, decodeTokensPerSecond?
├── timeToFirstToken?, tokenCount?
├── steps?, guidanceScale?, resolution?

GeneratedImage
├── id, prompt, negativePrompt?
├── imagePath, width, height
├── steps, seed, modelId
├── createdAt, conversationId?

Project
├── id, name, description, systemPrompt
├── icon?, createdAt, updatedAt
```

### Enums & Aliases

| Type | Values | Used By |
|------|--------|---------|
| `ModelSource` | `'lmstudio' \| 'official' \| 'verified-quantizer' \| 'community'` | Credibility badges |
| `ImageGenerationMode` | `'auto' \| 'manual'` | Settings: auto-detect vs explicit |
| `AutoDetectMethod` | `'pattern' \| 'llm'` | Settings: fast regex vs LLM fallback |
| `ModelLoadingStrategy` | `'performance' \| 'memory'` | Settings: keep loaded vs load-on-demand |
| `ImageModeState` | `'auto' \| 'force'` | Chat input toggle |
| `BackgroundDownloadStatus` | `'pending' \| 'running' \| 'paused' \| 'completed' \| 'failed' \| 'unknown'` | Download manager |

---

## 7. Core Services

### LLMService (`src/services/llm.ts`, 32KB)

The central service for on-device text inference.

**Responsibilities:**
- Initialize and manage llama.rn `LlamaContext`
- Configure GPU offloading (Metal on iOS, disabled on Android for stability)
- Stream tokens to callbacks during generation
- Track performance metrics (tok/s, TTFT, decode tok/s)
- Handle context window management (85% utilization cap, smart truncation)
- Support multimodal/vision models via mmproj files
- KV cache management (clear between conversations)
- Session caching for repeated system prompts

**Platform defaults:**

| Parameter | iOS | Android |
|-----------|-----|---------|
| Threads | 4 | 6 |
| Batch size | 256 | 256 |
| GPU layers | 99 (Metal) | 0 (disabled) |
| Context length | 2048 | 2048 |

### ActiveModelService (`src/services/activeModelService.ts`, 28KB)

Singleton that manages which models are loaded in native memory.

**Responsibilities:**
- Load/unload text models (llama.rn context creation)
- Load/unload image models (LocalDream subprocess)
- Memory budget enforcement (60% of device RAM max, warning at 50%)
- Memory estimation: 1.5x file size for text, 1.8x for image
- Automatic unload of previous model before loading new one
- Observable pattern for UI subscriptions

### ModelManager (`src/services/modelManager.ts`, 38KB)

Handles model file lifecycle on disk.

**Responsibilities:**
- Download from Hugging Face (foreground via RNFS, background via Android DownloadManager)
- Store text models in `Documents/local-llm/models/`
- Store image models in `Documents/image_models/`
- Track downloaded model metadata in AsyncStorage
- Handle vision model companion files (mmproj)
- Verify file integrity
- Delete models and clean up
- Recover models after app kill

### GenerationService (`src/services/generationService.ts`, 7KB)

Lifecycle-independent text generation manager.

**Responsibilities:**
- Manage generation state outside of any screen's lifecycle
- Subscriber pattern: screens subscribe/unsubscribe to generation state
- Handles app backgrounding during generation
- Tracks generation progress and completion

### ImageGenerationService (`src/services/imageGenerationService.ts`, 10KB)

Lifecycle-independent image generation manager.

**Responsibilities:**
- Orchestrate the full image generation pipeline
- Listen to native `LocalDreamProgress` events
- Save generated images to gallery store
- Insert generated image as assistant message in chat
- Preview path management during generation
- Continue generating even when user navigates away

### IntentClassifier (`src/services/intentClassifier.ts`, 12KB)

Determines whether a user message should trigger text generation or image generation.

**Two-stage pipeline:**

1. **Pattern matching (fast, no LLM needed):**
   - 45+ image patterns: "draw", "generate image", "paint", "create a picture", art styles, DALL-E references, negative prompts, resolution specs
   - 40+ text patterns: questions ("what is", "how do"), code requests, math, analysis, explanation
   - Short messages (<10 chars) → text
   - Multiple sentences with punctuation → text

2. **LLM classification (fallback for ambiguous cases):**
   - Simple yes/no prompt to the LLM
   - Can use a separate lightweight classifier model
   - Result cached (max 100 entries)
   - Falls back to text if LLM unavailable

### HuggingFaceService (`src/services/huggingface.ts`, 15KB)

API client for model discovery.

**Key methods:**
- `searchModels(query, options)` — GGUF filter, sort by downloads
- `getModelFiles(modelId)` — List quantized files with sizes, auto-pair mmproj companions
- `getDownloadUrl(modelId, fileName)` — Construct download URL

**Credibility determination:**
- LM Studio authors (highest) → Official model creators → Verified quantizers → Community

### WhisperService (`src/services/whisperService.ts`, 9KB)

Speech-to-text model management and transcription.

**Models available:**

| Model | Size | Language |
|-------|------|----------|
| tiny.en | 75 MB | English only |
| tiny | 75 MB | Multilingual |
| base.en | 142 MB | English only |
| base | 142 MB | Multilingual |
| small.en | 466 MB | English only |

**Transcription modes:**
- **Realtime:** Streams partial results every ~3 seconds
- **File:** Batch process a recorded audio file

### AuthService (`src/services/authService.ts`, 3KB)

Passphrase management.

- Hash passphrase with 1000 rounds of iteration
- Store in device Keychain (encrypted native storage)
- Methods: `setPassphrase()`, `verifyPassphrase()`, `hasPassphrase()`, `removePassphrase()`

### BackgroundDownloadService (`src/services/backgroundDownloadService.ts`, 9KB) — Android only

Bridge to Android's native DownloadManager.

- Downloads continue even after app is killed
- Persists download state in SharedPreferences
- 500ms polling for progress updates
- Emits events: `DownloadProgress`, `DownloadComplete`, `DownloadError`
- Moves completed files from Downloads temp to models directory

---

## 8. Native Integration Layer

### Android Native Modules

#### LocalDreamModule (`android/.../localdream/LocalDreamModule.kt`)

Stable Diffusion image generation via a native subprocess.

**Architecture:**
- Spawns `libstable_diffusion_core.so` as a subprocess
- Subprocess runs an HTTP server on `localhost:18081`
- TypeScript layer makes HTTP POST requests for generation
- Receives SSE (Server-Sent Events) stream with progress + base64 preview images

**Backend support:**

| Backend | Hardware | Model Format | Files |
|---------|----------|-------------|-------|
| MNN (CPU) | All Android | `.mnn` | CLIP, UNet, VAE decoder, tokenizer |
| QNN (NPU) | Qualcomm Snapdragon | `.bin` | Same components, Hexagon DSP optimized |

**Key native methods:**
- `loadModel(path)`, `unloadModel()`, `isModelLoaded()`
- `generateImage(prompt, negativePrompt, steps, guidanceScale, width, height, seed)`
- `cancelGeneration()`
- `saveRgbAsPng(base64, width, height, path)`
- `isNpuSupported()` — checks for Qualcomm chipset

**QNN runtime libraries:** Extracted from assets to `runtime_libs/`:
- `libQnnHtp.so` (Hexagon DSP backend)
- `libQnnSystem.so` (QNN system library)

#### DownloadManagerModule (`android/.../download/DownloadManagerModule.kt`)

Android system DownloadManager integration.

**Key native methods:**
- `startDownload(url, fileName)` — enqueues in system DownloadManager
- `cancelDownload(downloadId)`
- `getActiveDownloads()` — reads from SharedPreferences
- `getDownloadProgress(downloadId)` — queries DownloadManager
- `moveCompletedDownload(downloadId, destPath)` — moves from temp to models dir
- `startProgressPolling()` / `stopProgressPolling()` — 500ms interval

### iOS

Minimal custom native code. Relies on:
- `llama.rn` for Metal-accelerated LLM inference (99 GPU layers by default)
- `whisper.rn` for speech-to-text
- Standard RN library natives for everything else
- No image generation support (LocalDream is Android-only)

### Third-Party Native Bindings

| Package | Native Functionality |
|---------|---------------------|
| `llama.rn` | llama.cpp context creation, completion streaming, GPU offload |
| `whisper.rn` | whisper.cpp context, realtime + file transcription |
| `react-native-fs` | File read/write/download/stat/mkdir |
| `react-native-device-info` | RAM, device model, OS, emulator detection |
| `react-native-keychain` | Encrypted credential storage |
| `react-native-image-picker` | Camera and gallery image selection |
| `react-native-zip-archive` | Model archive extraction |

---

## 9. Product Flows — Detailed

This section expands on every testable flow, grouped by feature area. Each flow includes the **trigger**, **step-by-step behavior**, **services/stores involved**, and **edge cases**.

---

### 9.1 App Initialization & Onboarding

#### 9.1.1 Cold Start Sequence

**Trigger:** User taps app icon (fresh install or subsequent launch).

**Steps:**
1. `App.tsx` mounts → shows loading screen
2. Hardware service queries device info (RAM, model, OS) → stores in `appStore.deviceInfo`
3. Model recommendations calculated from RAM tier → `appStore.modelRecommendation`
4. ModelManager syncs downloaded models list (verifies files still exist on disk)
5. On Android: sync background download state from SharedPreferences
6. AuthStore checked: if `isEnabled && passphrase exists` → show `LockScreen`
7. Otherwise, check `hasCompletedOnboarding`:
   - `false` → navigate to `OnboardingScreen`
   - `true` + no downloaded models → `ModelDownloadScreen`
   - `true` + has models → `MainTabs`

**Services:** HardwareService, ModelManager, AuthService, BackgroundDownloadService (Android)
**Stores:** appStore, authStore

#### 9.1.2 Onboarding Flow

**Trigger:** First app launch (`hasCompletedOnboarding === false`).

**Steps:**
1. Display 4 slides: Welcome → Privacy → Offline → Choose Model
2. User swipes through or taps "Next"
3. On final slide, tap "Get Started"
4. `appStore.setHasCompletedOnboarding(true)`
5. Navigate to `ModelDownloadScreen`

**Slides content:**
| Slide | Title | Message |
|-------|-------|---------|
| 1 | Welcome to Local LLM | Run AI models directly on your device. No internet required, complete privacy. |
| 2 | Your Privacy Matters | All conversations stay on your device. No data is sent to any server. |
| 3 | Works Offline | Once you download a model, it works without internet. |
| 4 | Choose Your Model | Smaller models are faster, larger models are smarter. We'll help you pick. |

#### 9.1.3 First Model Download

**Trigger:** Onboarding complete, no models downloaded.

**Steps:**
1. `ModelDownloadScreen` shows recommended models filtered by device RAM
2. Each card shows: model name, parameter count, size estimate, description
3. User selects a model → download begins
4. Progress bar shows percentage + bytes
5. On completion → navigate to `MainTabs` (Home)
6. User can also tap "Skip" → goes to Home with no model (shows "download a model" prompt)

**Recommendations by RAM:**

| Device RAM | Max Parameters | Suggested Quantization |
|-----------|---------------|----------------------|
| 3–4 GB | 1.5B | Q4_K_M |
| 4–6 GB | 3B | Q4_K_M |
| 6–8 GB | 4B | Q4_K_M |
| 8–12 GB | 8B | Q4_K_M |
| 12–16 GB | 13B | Q4_K_M |
| 16+ GB | 30B | Q4_K_M |

---

### 9.2 Authentication & Security

#### 9.2.1 Passphrase Setup

**Trigger:** Settings → Security → Enable Passphrase.

**Steps:**
1. Navigate to `PassphraseSetupScreen`
2. Enter passphrase (first field)
3. Confirm passphrase (second field)
4. Validation: entries must match
5. On mismatch → error message, fields cleared
6. On match → `authService.setPassphrase(hash)` → stored in Keychain
7. `authStore.setEnabled(true)`
8. Navigate back to Settings

**Service:** AuthService (hashes with 1000 iteration rounds, stores in Keychain)

#### 9.2.2 App Lock Trigger

**Trigger:** App goes to background while auth is enabled.

**Steps:**
1. `useAppState` hook detects `AppState → background`
2. `authStore.lastBackgroundTime` set to `Date.now()`
3. When app returns to foreground:
   - Check if enough time has passed (immediate lock currently)
   - `authStore.setLocked(true)`
   - `LockScreen` renders over entire app

#### 9.2.3 Unlock Flow

**Trigger:** User enters passphrase on LockScreen.

**Steps:**
1. Check lockout: if `lockoutUntil > now` → show countdown timer (MM:SS), input disabled
2. User enters passphrase → `authService.verifyPassphrase(input)`
3. **Correct:** `authStore.setLocked(false)`, `resetFailedAttempts()` → app unlocks
4. **Incorrect:** `authStore.recordFailedAttempt()`
   - `failedAttempts++`
   - If `failedAttempts >= 5` → `lockoutUntil = now + 5 minutes`
   - Show error + remaining attempts count
5. Lockout persists across app restart (lockoutUntil is persisted)

---

### 9.3 Model Browsing & Download

#### 9.3.1 Browse Text Models

**Trigger:** Navigate to Models tab.

**Steps:**
1. `ModelsScreen` loads → calls `huggingFaceService.searchModels('')`
2. API returns GGUF models sorted by downloads
3. Each `ModelCard` shows: name, author, parameter count, downloads, credibility badge
4. User can:
   - **Search**: type query → re-fetches with search term
   - **Filter by credibility**: LM Studio, Official, Verified toggles → intersection filter
   - **Filter by type**: Vision toggle → only multimodal models
   - **Pull to refresh**: re-fetches from API
   - **Scroll for more**: pagination / infinite scroll

**Credibility badges:**
| Badge | Color | Meaning |
|-------|-------|---------|
| LM Studio | Cyan (#22D3EE) | Official LM Studio quantization — highest quality GGUF |
| Official | Green (#22C55E) | From the original model creator (Meta, Microsoft, Qwen, etc.) |
| Verified | Purple (#A78BFA) | From trusted quantizers (TheBloke, bartowski, etc.) |
| Community | Gray (#64748B) | Community contributed |

#### 9.3.2 View Model Files

**Trigger:** Tap a model card to expand.

**Steps:**
1. Calls `huggingFaceService.getModelFiles(modelId)`
2. Uses HF tree API (preferred) with fallback to siblings array
3. Filters for `.gguf` files only
4. Sorts by size (ascending)
5. Displays for each file: filename, quantization level (e.g., Q4_K_M), size (GB/MB)
6. For vision models: auto-pairs mmproj companion file with matching quantization
7. Shows quantization quality indicator (Low → Excellent)

#### 9.3.3 Download Text Model (Foreground)

**Trigger:** Tap download button on a model file.

**Steps:**
1. Construct download URL: `https://huggingface.co/{modelId}/resolve/main/{fileName}`
2. Start download via `RNFS.downloadFile()` with progress callback (500ms)
3. UI shows: progress bar, percentage, bytes downloaded / total
4. File saved to `Documents/local-llm/models/{fileName}`
5. If vision model: also download mmproj file sequentially
6. On completion:
   - Create `DownloadedModel` metadata object
   - Save to `appStore.downloadedModels[]`
   - Persist metadata to AsyncStorage
7. Model appears in "Downloaded" section and model selector

**Cancellation:** User taps cancel → `RNFS.stopDownload()` → partial file deleted

#### 9.3.4 Download Text Model (Background — Android only)

**Trigger:** Start download on Android (alternative download method).

**Steps:**
1. `backgroundDownloadService.startDownload(url, fileName)`
2. Enqueues in Android's native DownloadManager → returns `downloadId`
3. Metadata persisted in SharedPreferences
4. System shows notification with progress
5. 500ms polling queries DownloadManager for status
6. Events emitted: `DownloadProgress` (bytesDownloaded, totalBytes), `DownloadComplete`, `DownloadError`
7. On completion: file moved from `ExternalFilesDir/Downloads/` to `Documents/models/`
8. If app was killed: on next launch, `syncBackgroundDownloads()` recovers state

**States:** pending → running → paused → completed / failed

#### 9.3.5 Download Image Model

**Trigger:** Tap download on an image model card.

**Steps:**
1. Download archive (`.zip`) containing model components
2. Extract via `react-native-zip-archive`
3. Components: CLIP text encoder, UNet, VAE decoder, tokenizer JSON
4. Stored in `Documents/image_models/{modelName}/`
5. Create `ONNXImageModel` metadata with detected backend (mnn/qnn) and style
6. Save to `appStore.downloadedImageModels[]`

#### 9.3.6 Delete Model

**Trigger:** Long-press model in Downloaded section → Delete, or from Storage Settings.

**Steps:**
1. Show confirmation dialog ("This will permanently delete the model file")
2. If model is currently loaded → warn that it will be unloaded first
3. `activeModelService.unloadTextModel()` if needed
4. `RNFS.unlink(filePath)` → delete from disk
5. If vision model: also delete mmproj file
6. Remove from `appStore.downloadedModels[]`
7. Update AsyncStorage

---

### 9.4 Model Loading & Memory

#### 9.4.1 Load Text Model

**Trigger:** Tap model in selector, or auto-load on chat entry if `activeModelId` set.

**Steps:**
1. Check memory budget: `estimatedMemory = fileSize * 1.5`
2. If exceeds 60% of device RAM → show warning, possibly refuse
3. If another model loaded → unload first (free context, clear KV cache)
4. `llmService.initContext()` with parameters:
   - `model`: file path
   - `n_ctx`: from settings (default 2048)
   - `n_threads`: platform default
   - `n_batch`: 256
   - `n_gpu_layers`: iOS Metal = 99, Android = 0
   - Optional: `mmproj` path for vision models
5. UI shows loading indicator
6. On success:
   - `appStore.setActiveModelId(id)`
   - Detect multimodal support (`initMultimodal()`)
   - Show "Model loaded" system message in chat
   - Display load time
7. On failure:
   - OOM → suggest smaller model
   - Corrupt file → suggest re-download
   - Unknown error → show error + retry option

#### 9.4.2 Unload Text Model

**Trigger:** Explicit unload from UI, or automatic before loading different model.

**Steps:**
1. If generation in progress → stop it first
2. `llmService.releaseContext()` → frees native memory
3. Clear KV cache
4. `appStore.setActiveModelId(null)`
5. Show "Model unloaded" system message
6. Display freed memory estimate

#### 9.4.3 Load Image Model (Android only)

**Trigger:** Image generation requested, or manual load from model selector.

**Steps:**
1. Memory check: `estimatedMemory = modelSize * 1.8`
2. `LocalDreamModule.loadModel(modelPath)` → starts subprocess
3. Subprocess loads CLIP, UNet, VAE components
4. Detects backend (MNN vs QNN based on file extensions)
5. If QNN model on non-Qualcomm device → falls back to MNN
6. `appStore.setActiveImageModelId(id)`

#### 9.4.4 Model Loading Strategies

**Performance mode (`'performance'`):**
- Model stays loaded in RAM across generations
- Faster response times (no load latency between messages)
- Higher memory usage
- Session caching works optimally
- Intent classifier can swap to classifier model and swap back

**Memory mode (`'memory'`):**
- Model loaded on demand before each generation
- Unloaded after generation completes
- Lower peak memory usage
- Slower (load time added to each generation)
- Suitable for devices with < 6GB RAM

---

### 9.5 Text Generation

#### 9.5.1 Send Message & Generate Response

**Trigger:** User types message and taps Send.

**Steps:**
1. Validate: message not empty/whitespace-only, model loaded
2. Create `Message` object with `role: 'user'`, add to conversation via `chatStore.addMessage()`
3. Clear input field
4. **Intent classification** (if image mode is 'auto'):
   - Run pattern matching on message text
   - If uncertain and `autoDetectMethod === 'llm'`: classify via LLM
   - If intent is 'image' → route to image generation (see 9.6)
5. Build message context:
   - System prompt (from project if linked, else from settings)
   - Conversation history (truncated to fit context window at 85% utilization)
   - Current user message
6. `generationService.startGeneration()` → `llmService.completion()`
7. **Streaming phase:**
   - `chatStore.setStreaming(true)`
   - Tokens arrive via callback → `chatStore.updateStreamingMessage(token)`
   - `<think>` tags detected → `isThinking = true` (content shown in collapsible block)
   - UI auto-scrolls to follow new tokens
   - Stop button appears
8. **Completion:**
   - Final message saved to conversation with `generationMeta`:
     - `tokensPerSecond`, `decodeTokensPerSecond`, `timeToFirstToken`, `tokenCount`
     - `gpu` (boolean), `gpuBackend`, `gpuLayers`
     - `modelName`
   - `generationTimeMs` recorded
   - `chatStore.setStreaming(false)`
   - Conversation `updatedAt` timestamp updated

#### 9.5.2 Stop Generation

**Trigger:** User taps Stop button during streaming.

**Steps:**
1. `llmService.stopCompletion()` → signals native to stop
2. Current partial response is kept (not discarded)
3. Message finalized with partial content + metadata
4. Streaming state cleared
5. User can send new message immediately

#### 9.5.3 Retry Generation

**Trigger:** User taps retry on an assistant message.

**Steps:**
1. Delete the assistant message being retried
2. Re-send the preceding user message through the generation pipeline
3. New response streams in to replace the old one

#### 9.5.4 Context Window Management

**How it works:**
1. Before each generation, tokenize the full context (system + history + current)
2. If token count exceeds `contextLength * 0.85`:
   - Drop oldest messages (keeping system prompt + most recent messages)
   - Re-tokenize to verify fit
3. If KV cache is full → clear cache and rebuild context
4. Safety margin prevents overflows that would crash native inference

#### 9.5.5 Thinking Blocks

**Trigger:** Model outputs `<think>...</think>` tags.

**Behavior:**
1. Parser detects `<think>` opening tag
2. `isThinking` flag set on streaming message
3. Content inside tags rendered in a collapsible/dimmed block
4. `</think>` tag detected → `isThinking = false`
5. Content after closing tag rendered normally
6. Final message preserves thinking content (viewable on expand)

#### 9.5.6 Generation Metadata Display

When `showGenerationDetails` is enabled in settings:

| Metric | Source | Display |
|--------|--------|---------|
| Tokens/sec (overall) | `tokensPerSecond` | "12.3 tok/s" |
| Tokens/sec (decode) | `decodeTokensPerSecond` | "15.1 tok/s decode" |
| Time to first token | `timeToFirstToken` | "0.8s TTFT" |
| Total tokens | `tokenCount` | "342 tokens" |
| GPU used | `gpu` + `gpuBackend` | "Metal" or "CPU" |
| GPU layers | `gpuLayers` | "99 layers" |
| Model name | `modelName` | "Qwen2.5-3B-Q4_K_M" |
| Generation time | `generationTimeMs` | "28.4s" |

---

### 9.6 Image Generation (Android only)

#### 9.6.1 Auto-Triggered Image Generation

**Trigger:** User sends message that intent classifier routes to image generation.

**Steps:**
1. Intent classified as 'image' (see 9.5.1 step 4)
2. Check: image model loaded?
   - No → attempt to load `activeImageModelId`
   - Still no → show "No image model" error
3. Create user message in conversation
4. `imageGenerationService.generate()` with params:
   - `prompt`: user's message
   - `negativePrompt`: from settings (if configured)
   - `steps`: from settings (default varies by model)
   - `guidanceScale`: from settings
   - `width`, `height`: from settings
   - `seed`: random (or specified)
5. **Progress phase:**
   - Native module emits `LocalDreamProgress` events
   - UI shows: step counter ("Step 5/20"), progress bar, preview thumbnail
   - Preview images update every few steps (base64 → PNG → display)
6. **Completion:**
   - Final RGB data received as base64
   - Saved as PNG via `LocalDreamModule.saveRgbAsPng()`
   - `GeneratedImage` created with full metadata
   - Added to `appStore.generatedImages[]`
   - Assistant message added to conversation with image attachment
   - Generation meta includes: steps, guidanceScale, resolution, seed

#### 9.6.2 Manual/Forced Image Generation

**Trigger:** User toggles image mode to "Force" in chat input, then sends any message.

**Steps:**
1. Image mode toggle in `ChatInput` → `ImageModeState = 'force'`
2. Visual indicator shows image mode is active
3. Any message sent bypasses intent classification → routes directly to image generation
4. Same pipeline as 9.6.1 from step 2 onward

#### 9.6.3 Cancel Image Generation

**Trigger:** User taps Stop during image generation progress.

**Steps:**
1. `imageGenerationService.cancel()` → `LocalDreamModule.cancelGeneration()`
2. Current partial image may be available (from preview)
3. Generation state cleared
4. No image added to gallery or conversation

#### 9.6.4 Image Generation Parameters

| Parameter | Range | Default | Effect |
|-----------|-------|---------|--------|
| Steps | 1–50 | Model-dependent | More steps = higher quality, slower |
| Guidance Scale | 1.0–20.0 | 7.5 | Higher = stricter prompt following |
| Width | 128–512 (multiples of 64) | 512 | Image width in pixels |
| Height | 128–512 (multiples of 64) | 512 | Image height in pixels |
| Negative Prompt | Free text | Empty | What to exclude from generation |
| Seed | Integer | Random | Reproducibility (same seed = same image) |

#### 9.6.5 Backend Selection

| Backend | Hardware | Speed | Quality | Detection |
|---------|----------|-------|---------|-----------|
| MNN (CPU) | All Android | Slower | Good | Default fallback |
| QNN (NPU) | Qualcomm Snapdragon (SM/QCS/QCM) | 3-5x faster | Same | Auto-detected via `isNpuSupported()` |

Auto-selection: If QNN model downloaded and device supports QNN → use QNN. Otherwise → MNN.

---

### 9.7 Vision Models (Image Understanding)

#### 9.7.1 Load Vision Model

**Trigger:** Select a vision-capable model (has mmproj companion file).

**Steps:**
1. Same loading flow as 9.4.1
2. Additionally: `llmService.initContext()` receives `mmproj` path
3. `initMultimodal()` called → enables image input processing
4. Vision capability indicator shown in UI

#### 9.7.2 Send Image for Analysis

**Trigger:** User attaches image (camera or gallery) + sends message.

**Steps:**
1. Tap attachment button → choose Camera or Gallery
2. Image selected → `MediaAttachment` created with `type: 'image'`
3. Thumbnail shown in input area
4. User types prompt (e.g., "What's in this image?") + sends
5. Message created with `attachments` array containing the image
6. Image passed to llama.rn context alongside text
7. Vision encoder (mmproj) processes the image
8. Text model generates response about the image
9. Response streams normally with metadata

#### 9.7.3 Document Attachment

**Trigger:** User attaches a document (.txt, .py, .js, etc.).

**Steps:**
1. Tap attachment button → choose Document
2. `documentService.extractText(uri)` → extracts text content
3. `MediaAttachment` created with `type: 'document'`, `textContent` populated
4. Preview shows filename + text snippet
5. On send: text content included in prompt context
6. Model can reference and analyze document content

---

### 9.8 Voice Input

#### 9.8.1 Voice Recording & Transcription

**Trigger:** Long-press or tap microphone button in ChatInput.

**Steps:**
1. Check microphone permission → request if not granted
2. Check Whisper model availability:
   - Not downloaded → prompt to download (navigate to Voice Settings)
   - Downloaded but not loaded → load model
3. Start recording → `voiceService.startRecording()`
4. UI shows: recording indicator, duration timer, waveform visualization
5. User releases / taps stop → recording ends
6. Audio sent to `whisperService.transcribeRealtime()`:
   - Processes in chunks
   - Partial results update in real-time
   - Final transcription returned
7. Transcribed text inserted into chat input field
8. User can edit before sending

#### 9.8.2 Whisper Model Management

**Trigger:** Voice Settings screen.

**Steps:**
1. List available Whisper models with sizes
2. User selects and downloads a model
3. Download progress shown
4. On completion: model stored in `Documents/whisper-models/`
5. `whisperStore.downloadedModelId` set
6. Model loaded on first transcription request

---

### 9.9 Conversations

#### 9.9.1 Create Conversation

**Trigger:** "New Chat" button on Home or Chats tab.

**Steps:**
1. `chatStore.createConversation()` creates new `Conversation`:
   - Generated UUID
   - Title: "New Conversation" (auto-updated after first message)
   - `modelId`: current `activeModelId`
   - `projectId`: if started from a project
   - Empty `messages[]`
   - Timestamps set
2. Navigate to `ChatScreen` with new conversation

#### 9.9.2 Auto-Generate Title

**Trigger:** First user message sent in a conversation.

**Steps:**
1. After first response completes
2. Title derived from first message content (truncated)
3. `chatStore.updateConversation()` updates title

#### 9.9.3 Switch Conversations

**Trigger:** Tap a conversation in ChatsListScreen.

**Steps:**
1. If generation in progress → warn user (generation will stop)
2. `chatStore.setActiveConversationId(newId)`
3. Navigate to `ChatScreen`
4. Messages loaded from store (already in memory, persisted)
5. Scroll to bottom

#### 9.9.4 Delete Conversation

**Trigger:** Swipe-to-delete or long-press → Delete.

**Steps:**
1. Show confirmation dialog
2. `chatStore.deleteConversation(id)`:
   - Remove from `conversations[]`
   - All messages deleted
3. Associated gallery images remain (not cascade-deleted)
4. If was active conversation → navigate to conversations list

#### 9.9.5 Projects Integration

**Trigger:** Start chat from a project, or select project in chat.

**Steps:**
1. `chatStore.createConversation()` with `projectId` set
2. System prompt from `projectStore.projects[].systemPrompt` used instead of default
3. Project badge shown in chat header and conversation list
4. If project deleted later → conversation keeps its system prompt (snapshot)

---

### 9.10 Gallery

#### 9.10.1 View Gallery

**Trigger:** Navigate to Gallery tab/modal.

**Steps:**
1. Load `appStore.generatedImages[]`
2. Display as 3-column grid, sorted by `createdAt` (most recent first)
3. Each thumbnail loaded from `imagePath` on disk
4. Filter dropdown: "All" or specific conversation

#### 9.10.2 Image Detail View

**Trigger:** Tap an image thumbnail.

**Steps:**
1. Open fullscreen viewer
2. Pinch to zoom, pan to navigate
3. View metadata: prompt, negative prompt, steps, seed, guidance scale, resolution, model, timestamp
4. Actions: Share, Save to Device, Delete

#### 9.10.3 Save to Device

**Trigger:** Tap Save in image viewer.

**Steps:**
1. Copy image to device-accessible location:
   - Android: `Pictures/LocalLLM/` or `Documents/LocalLLM_Images/`
   - iOS: Camera Roll (via photo library API)
2. Show success confirmation

#### 9.10.4 Multi-Select & Batch Delete

**Trigger:** Enter selection mode (long-press an image).

**Steps:**
1. Selection mode activated → checkboxes appear on thumbnails
2. Tap to select/deselect individual images
3. "Select All" option available
4. Tap "Delete Selected"
5. Confirmation dialog
6. Delete selected images from disk + remove from `appStore.generatedImages[]`

---

### 9.11 Settings

#### 9.11.1 Text Generation Settings

| Setting | Type | Range | Default | Effect |
|---------|------|-------|---------|--------|
| System Prompt | Text area | Free text | (see APP_CONFIG) | Personality/behavior instructions |
| Temperature | Slider | 0.0 – 2.0 | 0.7 | Randomness (low = deterministic, high = creative) |
| Top-P | Slider | 0.0 – 1.0 | 0.9 | Nucleus sampling threshold |
| Repeat Penalty | Slider | 1.0 – 2.0 | 1.1 | Penalizes token repetition |
| Max Tokens | Input | 1 – 4096+ | 512 | Maximum response length |
| Context Length | Input | 512 – 8192 | 2048 | Conversation history window |
| Threads | Slider | 1 – device max | 4 (iOS) / 6 (Android) | CPU threads for inference |
| Batch Size | Input | 1 – 512 | 256 | Token processing batch |
| GPU | Toggle | On/Off | iOS: On, Android: Off | GPU acceleration |
| GPU Layers | Slider | 0 – 99 | iOS: 99, Android: 0 | Layers offloaded to GPU |
| Loading Strategy | Toggle | Performance / Memory | Performance | Keep model loaded vs load-on-demand |
| Show Details | Toggle | On/Off | Off | Show generation metadata on messages |

#### 9.11.2 Image Generation Settings

| Setting | Type | Range | Default |
|---------|------|-------|---------|
| Steps | Slider | 1 – 50 | Model-dependent |
| Guidance Scale | Slider | 1.0 – 20.0 | 7.5 |
| Width | Input | 128 – 512 | 512 |
| Height | Input | 128 – 512 | 512 |
| Threads | Slider | 1 – device max | Platform default |

#### 9.11.3 Intent Detection Settings

| Setting | Options | Effect |
|---------|---------|--------|
| Image Generation Mode | Auto / Manual | Auto detects intent; Manual requires explicit toggle |
| Auto-Detect Method | Pattern / LLM | Pattern-only (fast) vs Pattern + LLM fallback (accurate) |
| Classifier Model | (model selector) | Which model to use for LLM classification |

**All settings auto-save on change (no save button needed) and persist across app restarts.**

---

### 9.12 App Lifecycle

#### 9.12.1 Background / Foreground

**Trigger:** User switches apps, locks phone, or presses home button.

**Going to background:**
1. `useAppState` detects `AppState → background`
2. `authStore.lastBackgroundTime` recorded
3. Generation services continue (lifecycle-independent)
4. Background downloads continue (Android)

**Returning to foreground:**
1. `useAppState` detects `AppState → active`
2. If auth enabled → `authStore.setLocked(true)` → show `LockScreen`
3. Refresh device info (available memory may have changed)
4. If generation completed while backgrounded → messages already in store

#### 9.12.2 Force Kill & Recovery

**Trigger:** User swipes away app or system kills it.

**Recovery on next launch:**
1. All Zustand persisted stores rehydrated from AsyncStorage
2. Conversations, messages, settings all restored
3. Active model ID remembered (but model not loaded — needs re-load)
4. Background downloads (Android): synced from SharedPreferences
5. Streaming state cleared (was not persisted)
6. Any partial generation is lost (the streaming message was not saved)

#### 9.12.3 Generation During Background

**Text generation:** Continues via `generationService` (lifecycle-independent). When user returns, streaming message and final result are in the store.

**Image generation:** Continues via `imageGenerationService`. Progress events accumulate. When user returns to chat, they see current progress or completed image.

**Background downloads (Android):** Android DownloadManager continues independently. On next app open, `syncBackgroundDownloads()` queries system for status.

---

### 9.13 Intent Classification — Detailed

The intent classifier determines whether a user's message should trigger text generation or image generation.

#### Classification Pipeline

```
User message
    │
    ▼
[1] Quick checks ─────────────────────────────────────────┐
    │ • Message < 10 chars → TEXT                         │
    │ • Multiple sentences → TEXT                          │
    │ • Exact code/question keywords → TEXT                │
    │                                                      │
    ▼                                                      │
[2] Image pattern matching ────────────────────────────────┤
    │ • 45+ patterns: "draw", "generate image",           │
    │   "paint", art styles, DALL-E, negative prompt,     │
    │   resolution specifications                          │
    │ • Match found → IMAGE                               │
    │                                                      │
    ▼                                                      │
[3] Text pattern matching ─────────────────────────────────┤
    │ • 40+ patterns: questions, code, math, analysis,    │
    │   explanation, help requests                         │
    │ • Match found → TEXT                                │
    │                                                      │
    ▼                                                      │
[4] Ambiguous — check autoDetectMethod ────────────────────┤
    │                                                      │
    ├── 'pattern' mode → default TEXT                      │
    │                                                      │
    └── 'llm' mode → [5] LLM Classification               │
                          │                                │
                          ▼                                │
                    Prompt: "Is this asking to             │
                    create/generate/draw an image?"        │
                          │                                │
                          ├── "yes" → IMAGE                │
                          ├── "no" → TEXT                  │
                          └── error → TEXT (fallback)      │
                                                           │
                    Result cached (max 100 entries) ◄──────┘
```

#### Example Classifications

| Input | Classification | Stage | Reason |
|-------|---------------|-------|--------|
| "Hi" | TEXT | Quick check | < 10 chars |
| "Draw a cat" | IMAGE | Image patterns | Matches "draw" |
| "What is Python?" | TEXT | Text patterns | Matches "what is" |
| "A beautiful sunset over mountains" | TEXT (pattern) or IMAGE (LLM) | Ambiguous | No clear pattern; LLM may classify as image |
| "Generate an oil painting of a forest" | IMAGE | Image patterns | Matches "generate" + "oil painting" |
| "Write a function to sort an array" | TEXT | Text patterns | Matches "write a function" |

---

### 9.14 Error Handling

#### Network Errors

| Scenario | Handling |
|----------|---------|
| No internet during model browse | Error message + "Retry" button |
| Network drop during download (foreground) | Error + "Resume" option (HTTP range requests) |
| Network drop during download (background) | Android DownloadManager pauses; resumes when network returns |
| HuggingFace API timeout | Timeout error + retry |

#### Model Errors

| Scenario | Handling |
|----------|---------|
| Corrupt model file | Detection on load → error + "Delete and re-download" suggestion |
| OOM during model load | Error + "Try a smaller model" suggestion |
| Model file deleted externally | Detected during sync → removed from list |
| Incompatible model version | Error message during load |

#### Generation Errors

| Scenario | Handling |
|----------|---------|
| OOM during text generation | Error message + suggest reducing context length |
| Native crash during generation | Graceful error message, generation state cleared |
| Image generation failure | Error message, no image added |
| No model loaded when sending | Prompt to load a model |

#### Storage Errors

| Scenario | Handling |
|----------|---------|
| Insufficient storage before download | Pre-check + error with space requirements |
| Storage full mid-download | Download fails gracefully, partial file cleaned up |
| File system permission denied | Error message |

---

## 10. Testing Infrastructure

### Unit Tests (`__tests__/unit/`)

| Test File | Covers |
|-----------|--------|
| `stores/appStore.test.ts` | App store state transitions |
| `stores/chatStore.test.ts` | Conversation CRUD, message management |
| `stores/authStore.test.ts` | Auth state, lockout logic |
| `services/generationService.test.ts` | Text generation lifecycle |
| `services/intentClassifier.test.ts` | Pattern matching, LLM fallback |

### Integration Tests (`__tests__/integration/`)

| Test File | Covers |
|-----------|--------|
| `stores/chatStoreIntegration.test.ts` | Multi-store interactions |
| `models/activeModelService.test.ts` | Model load/unload with memory checks |
| `generation/generationFlow.test.ts` | End-to-end text generation |
| `generation/imageGenerationFlow.test.ts` | End-to-end image generation |

### Contract Tests (`__tests__/contracts/`)

Tests that verify native module interfaces haven't changed:

| Test File | Native Module |
|-----------|---------------|
| `llama.rn.test.ts` | llama.rn API shape |
| `whisper.rn.test.ts` | whisper.rn API shape |
| `whisper.contract.test.ts` | Whisper service contracts |
| `localDream.contract.test.ts` | LocalDream module contracts |
| `llamaContext.contract.test.ts` | LlamaContext lifecycle |

### Component Tests (`__tests__/rntl/`)

React Native Testing Library tests for screens:
- `ChatScreen.test.tsx`
- `ModelsScreen.test.tsx`
- `HomeScreen.test.tsx`

### E2E Tests (Maestro, `.maestro/`)

**Configuration:** App ID `com.localllm`, 30-second default timeout, screenshots on failure.

#### P0 Critical Path Flows

| Flow | File | What It Tests |
|------|------|---------------|
| App Launch | `01-app-launch.yaml` | Launch → loading disappears → home screen visible |
| Text Generation | `02-text-generation.yaml` | Home → new chat → type message → send → assistant responds |
| Stop Generation | `03-stop-generation.yaml` | Send message → tap stop during streaming → generation halts |
| Model Loading | `04-model-loading.yaml` | Open model selector → pick model → loading indicator → loaded |
| Model Download | `05-model-download.yaml` | Models screen → trigger download → progress → complete |
| Conversation Mgmt | `06-conversation-management.yaml` | Create chats → switch between → delete → verify |
| Image Generation | `07-image-generation.yaml` | Toggle image mode → send prompt → progress → image appears |
| App Lifecycle | `08-app-lifecycle.yaml` | Background → foreground → state preserved → auth lock if enabled |

#### Key testIDs Required

| Area | testIDs |
|------|---------|
| Navigation | `home-screen`, `chat-screen`, `models-screen`, `tab-bar`, `home-tab`, `chats-tab`, `models-tab`, `settings-tab` |
| Chat | `chat-input`, `send-button`, `stop-button`, `thinking-indicator`, `streaming-message`, `assistant-message` |
| Models | `model-selector`, `model-list`, `model-item-{index}`, `download-button`, `download-progress`, `download-complete` |
| Image | `image-mode-toggle`, `image-generation-progress`, `generated-image`, `image-message` |
| Conversations | `conversation-list-button`, `conversation-list`, `conversation-item-{index}` |
| Auth | `lock-screen` |

**Test commands:**
```bash
npm run test              # Jest unit/integration/contract tests
npm run test:e2e          # All P0 Maestro flows
npm run test:e2e:single   # Single Maestro flow
```

---

## 11. Constants & Configuration

### Model Recommendations by RAM

| Device RAM | Max Model Parameters | Recommended Quantization |
|-----------|---------------------|-------------------------|
| 3–4 GB | 1.5B | Q4_K_M |
| 4–6 GB | 3B | Q4_K_M |
| 6–8 GB | 4B | Q4_K_M |
| 8–12 GB | 8B | Q4_K_M |
| 12–16 GB | 13B | Q4_K_M |
| 16+ GB | 30B | Q4_K_M |

### Recommended Models

| Model | Parameters | Min RAM | Description |
|-------|-----------|---------|-------------|
| SmolLM2 135M | 0.135B | 2 GB | Ultra-tiny, runs on any device |
| SmolLM2 360M | 0.36B | 3 GB | Very small but surprisingly capable |
| Qwen 2.5 0.5B | 0.5B | 3 GB | Tiny but capable, great for basic tasks |
| Qwen 2.5 1.5B | 1.5B | 4 GB | Excellent balance of size and capability |
| SmolLM2 1.7B | 1.7B | 4 GB | Best tiny model for general use |
| Qwen 2.5 3B | 3B | 6 GB | Great quality for most mobile devices |
| Phi-3 Mini 4K | 3.8B | 6 GB | Microsoft's efficient small model |
| Llama 2 7B | 7B | 8 GB | Meta's popular chat model |

### Quantization Quality Ladder

| Quantization | Bits/Weight | Quality | Recommended | Notes |
|-------------|-------------|---------|-------------|-------|
| Q2_K | 2.625 | Low | No | Extreme compression, noticeable quality loss |
| Q3_K_S | 3.4375 | Low-Medium | No | High compression, some quality loss |
| Q3_K_M | 3.4375 | Medium | No | Good compression with acceptable quality |
| Q4_0 | 4.0 | Medium | No | Basic 4-bit quantization |
| Q4_K_S | 4.5 | Medium-Good | Yes | Good balance of size and quality |
| **Q4_K_M** | **4.5** | **Good** | **Yes** | **Optimal for mobile — best balance** |
| Q5_K_S | 5.5 | Good-High | No | Higher quality, larger size |
| Q5_K_M | 5.5 | High | No | Near original quality |
| Q6_K | 6.5 | Very High | No | Minimal quality loss |
| Q8_0 | 8.0 | Excellent | No | Best quality, largest size |

### Color Palette

| Name | Hex | Usage |
|------|-----|-------|
| Primary | #6366F1 | Buttons, active states |
| Primary Dark | #4F46E5 | Pressed states |
| Secondary | #10B981 | Success accents |
| Background | #0F172A | Main background |
| Surface | #1E293B | Cards, inputs |
| Surface Light | #334155 | Elevated surfaces |
| Text | #F8FAFC | Primary text |
| Text Secondary | #94A3B8 | Secondary text |
| Text Muted | #64748B | Disabled/hint text |
| Success | #22C55E | Success states |
| Warning | #F59E0B | Warning states |
| Error | #EF4444 | Error states |
| Border | #334155 | Borders, dividers |

---

## 12. File System Layout (On-Device)

```
Documents/
├── local-llm/
│   └── models/                    # Text LLM models (GGUF)
│       ├── qwen2.5-3b-q4_k_m.gguf
│       ├── qwen2.5-3b-q4_k_m-mmproj-f16.gguf   # Vision companion
│       └── ...
│
├── image_models/                  # Stable Diffusion models
│   └── {model-name}/
│       ├── clip_text_encoder.mnn  # (or .bin for QNN)
│       ├── unet.mnn
│       ├── vae_decoder.mnn
│       └── tokenizer.json
│
├── whisper-models/                # Whisper STT models
│   ├── ggml-tiny.en.bin
│   └── ...
│
└── LocalLLM_Images/               # User-saved generated images
    └── ...

Caches/
└── llm-sessions/                  # LLM session KV cache files
    └── ...

Files/
└── generated_images/              # Generated image PNGs
    ├── {uuid}.png
    └── ...

Cache/
└── preview/                       # Temp preview images during generation
    └── preview.png
```

**Android-specific:**
```
ExternalFilesDir/
└── Downloads/                     # Temp location for background downloads
    └── (moved to Documents/models/ on completion)

assets/
└── runtime_libs/                  # QNN runtime libraries
    ├── libQnnHtp.so
    └── libQnnSystem.so
```

---

## Appendix: Default System Prompt

```
You are a helpful AI assistant running locally on the user's device. Your responses should be:
- Accurate and factual - never make up information
- Concise but complete - answer the question fully without unnecessary elaboration
- Helpful and friendly - focus on solving the user's actual need
- Honest about limitations - if you don't know something, say so

If asked about yourself, you can mention you're a local AI assistant that prioritizes user privacy.
```

---

## Appendix: Default Projects

| Project | System Prompt Summary |
|---------|----------------------|
| **General Assistant** | Helpful AI assistant (default prompt) |
| **Spanish Learning** | Spanish language tutor with conversation practice |
| **Code Review** | Code reviewer providing constructive feedback |
| **Writing Helper** | Writing assistant for drafting and editing |

---

## Appendix: Claude Code Memory System

This project uses **Claude Code** (Anthropic's official CLI) for development assistance. Claude Code maintains a persistent memory system to track learnings across conversations.

### Memory Location

```
~/.claude/projects/-Users-mac-wednesday-on-device-llm-LocalLLM/memory/
├── MEMORY.md                    # Main memory file (loaded into Claude's context)
└── [topic-files].md             # Optional: detailed topic-specific notes
```

### Purpose

The memory system helps Claude Code:
- **Remember solutions** to common issues (e.g., download manager race conditions on emulators)
- **Track architectural decisions** and their rationale
- **Document gotchas** specific to this codebase (native module coordination, timing issues)
- **Build context** across multiple development sessions

### Structure

**MEMORY.md** — Primary file, kept concise (max 200 lines to avoid truncation):
- Quick reference for critical learnings
- Links to detailed topic files for complex subjects
- Recent significant fixes and their root causes

**Topic files** — Detailed notes on specific areas:
- `debugging.md` — Common debugging patterns
- `native-modules.md` — Native bridge coordination patterns
- `patterns.md` — Codebase-specific patterns and conventions

### When to Update

Update memory files when:
- Fixing non-obvious bugs (especially race conditions, timing issues)
- Making architectural decisions that future work should respect
- Discovering undocumented behaviors in native modules or third-party libraries
- Solving problems that could recur in different parts of the codebase

### Example Memory Entry

```markdown
## Download Manager Event Delivery Fix

**Issue**: Downloads complete but UI doesn't update on emulators.

**Root Cause**: Race condition where status was set to "completed" before event could be sent.

**Solution**: Track event delivery separately from status using `completedEventSent` flag.

**Key Learning**: Always separate event delivery tracking from state changes when coordinating
between native modules and React Native, especially on slow emulators.

**Files Modified**: `android/app/src/main/java/com/localllm/download/DownloadManagerModule.kt`
```

### Best Practices

- **Be concise** — Memory is most useful when it's scannable
- **Focus on "why"** — Capture rationale, not just what was changed
- **Include file paths** — Makes it easy to locate relevant code
- **Update proactively** — Don't wait until the end of a session; update as you learn
