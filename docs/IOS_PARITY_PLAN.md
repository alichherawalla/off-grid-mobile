# iOS Feature Parity Plan

A comprehensive, implementation-ready plan for bringing LocalLLM's iOS build to full feature parity with Android. Covers architecture, cross-platform abstractions, native module design, model ecosystem, and every file that needs to change.

---

## Table of Contents

1. [Current State: What iOS Has and What It Lacks](#1-current-state)
2. [Strategy: iOS-Native, Not Android-Ported](#2-strategy)
3. [Cross-Platform Abstraction Pattern](#3-cross-platform-abstraction-pattern)
4. [Feature 1: Image Generation via Core ML](#4-feature-1-image-generation-via-core-ml)
5. [Feature 2: Background Downloads via URLSession](#5-feature-2-background-downloads-via-urlsession)
6. [Feature 3: Image Model Browsing for Core ML](#6-feature-3-image-model-browsing-for-core-ml)
7. [Shared TypeScript Changes](#7-shared-typescript-changes)
8. [iOS Project Configuration](#8-ios-project-configuration)
9. [Complete File Manifest](#9-complete-file-manifest)
10. [Testing Strategy](#10-testing-strategy)
11. [Risk Register](#11-risk-register)
12. [Platform Behavior Differences](#12-platform-behavior-differences)
13. [Performance Expectations](#13-performance-expectations)
14. [Phase Ordering & Dependencies](#14-phase-ordering--dependencies)

---

## 1. Current State

### What iOS already has (working today)

| Feature | Implementation | Notes |
|---------|---------------|-------|
| Text LLM inference | `llama.rn` + Metal GPU (99 layers) | Faster than Android CPU |
| Vision/multimodal | `llama.rn` + mmproj | Full support |
| Speech-to-text | `whisper.rn` | Same as Android |
| File I/O | `react-native-fs` | Same as Android |
| Secure storage | `react-native-keychain` | Same as Android |
| Chat, projects, gallery UI | React Native | Same as Android |
| Foreground model downloads | `RNFS.downloadFile()` | Same as Android |

### What iOS was missing (now implemented)

> **Note (Feb 2026):** Image generation via Core ML and the Core ML model browser have been implemented. Background downloads via URLSession are still pending. See `ios/LocalLLM/CoreMLDiffusion/CoreMLDiffusionModule.swift` and `src/services/coreMLModelBrowser.ts`.

| Feature | Android Implementation | iOS Status |
|---------|----------------------|------------|
| **Image generation** | LocalDream: spawns `libstable_diffusion_core.so` subprocess, runs HTTP server on localhost:18081, communicates via SSE. Backends: MNN (CPU), QNN (Qualcomm NPU). | **IMPLEMENTED** — `CoreMLDiffusionModule.swift` wraps Apple's `ml-stable-diffusion` StableDiffusionPipeline with ANE acceleration. |
| **Image model browsing** | Fetches from `xororz/sd-mnn` and `xororz/sd-qnn` HuggingFace repos. Models are `.zip` archives containing `.mnn`/`.bin` files. | **IMPLEMENTED** — `coreMLModelBrowser.ts` fetches from Apple's Core ML repos on HuggingFace. |
| **Background downloads** | Android `DownloadManager` system service via custom Kotlin native module (`DownloadManagerModule.kt`). Survives app kill. Polls at 500ms for progress. | **PARTIAL** — `DownloadManagerModule.swift` exists but uses foreground RNFS downloads. Full `URLSession` background configuration still pending. |

---

## 2. Strategy

### Why not port LocalDream to iOS?

LocalDream is deeply Android-specific:
- Spawns a Linux ELF binary (`libstable_diffusion_core.so`) as a subprocess — iOS doesn't allow spawning subprocesses
- Uses MNN (Alibaba's framework compiled for ARM64 Android) and QNN (Qualcomm NPU) — neither targets iOS
- Communicates via localhost HTTP server with SSE — this whole architecture exists because Android can run native binaries as processes

**iOS has a better option**: Apple's own `ml-stable-diffusion` Swift package, which runs Stable Diffusion natively via Core ML with hardware acceleration across CPU, GPU (Metal), and ANE (Apple Neural Engine). This is the same technology behind apps like Draw Things.

### The cross-platform principle

The TypeScript service layer is already well-abstracted. The key insight is:

```
┌─────────────────────────────────────────────────┐
│          TypeScript (shared, both platforms)      │
│                                                   │
│  imageGenerationService.ts  (orchestration)       │
│       │                                           │
│       ▼                                           │
│  localDreamGenerator.ts  (native bridge)          │
│       │                                           │
│       ├── Platform.OS === 'android'               │
│       │     └── NativeModules.LocalDreamModule    │
│       │                                           │
│       └── Platform.OS === 'ios'                   │
│             └── NativeModules.CoreMLDiffusion     │
│                                                   │
│  Both native modules expose IDENTICAL interface:  │
│  loadModel, generateImage, cancelGeneration, etc. │
│  Both emit IDENTICAL events:                      │
│  LocalDreamProgress, LocalDreamError              │
└─────────────────────────────────────────────────┘
```

**Same pattern for downloads:**

```
┌─────────────────────────────────────────────────┐
│  backgroundDownloadService.ts  (shared)           │
│       │                                           │
│       └── NativeModules.DownloadManagerModule     │
│             │                                     │
│             ├── Android: Kotlin, DownloadManager  │
│             │   (polling-based, SharedPreferences) │
│             │                                     │
│             └── iOS: Swift, URLSession background │
│                 (delegate-based, UserDefaults)     │
│                                                   │
│  SAME module name on both platforms.              │
│  SAME method signatures.                          │
│  SAME event names.                                │
│  TypeScript doesn't know which platform it's on.  │
└─────────────────────────────────────────────────┘
```

This means: **almost zero TypeScript changes**. The abstraction boundary is at the native module level.

---

## 3. Cross-Platform Abstraction Pattern

This section explains exactly how both platforms coexist without pulling our hair out.

### 3.1 The "Same Interface, Different Engine" Pattern

Every native module follows this contract:

```
┌──────────────────────────────────────────────────────────┐
│ NATIVE MODULE CONTRACT (what TypeScript sees)             │
│                                                           │
│ Module Name:  "LocalDreamModule" (Android)                │
│               "CoreMLDiffusionModule" (iOS)                │
│                                                           │
│ Methods (identical signatures):                           │
│   loadModel(params: {modelPath, backend?}) → boolean      │
│   unloadModel() → boolean                                 │
│   isModelLoaded() → boolean                               │
│   getLoadedModelPath() → string | null                    │
│   generateImage(params) → {id, imagePath, seed, ...}      │
│   cancelGeneration() → boolean                            │
│   isGenerating() → boolean                                │
│   getGeneratedImages() → GeneratedImage[]                 │
│   deleteGeneratedImage(id) → boolean                      │
│   isNpuSupported() → boolean                              │
│   getConstants() → {DEFAULT_STEPS, ...}                   │
│                                                           │
│ Events (identical names and shapes):                      │
│   LocalDreamProgress → {step, totalSteps, progress,       │
│                          previewPath?}                     │
│   LocalDreamError → {error: string}                       │
│                                                           │
│ TypeScript bridge selects module at import time:          │
│   const Module = Platform.select({                        │
│     android: NativeModules.LocalDreamModule,              │
│     ios: NativeModules.CoreMLDiffusionModule,             │
│   });                                                     │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Where Platform Divergence Lives

Platform-specific code is **isolated to three places**:

| Layer | What diverges | How it's handled |
|-------|--------------|-----------------|
| **Native modules** (Swift/Kotlin) | Completely different implementation. Android spawns subprocess + HTTP. iOS uses Core ML pipeline in-process. | Separate codebases, same exported interface. |
| **TypeScript bridge** (`localDreamGenerator.ts`) | One `Platform.select()` at the top to pick the right native module. | Single file, ~5 lines changed. Everything else is shared. |
| **Model browser** (`huggingFaceModelBrowser.ts` / `coreMLModelBrowser.ts`) | Different HuggingFace repos, different file formats (`.mnn`/`.bin` vs `.mlmodelc`). | Separate service for iOS model discovery. `ModelsScreen` calls the right one per platform. |

### 3.3 What Stays Shared (the majority of code)

These files work on both platforms with zero or minimal changes:

| File | Why it just works |
|------|-------------------|
| `imageGenerationService.ts` | Calls `onnxImageGeneratorService.*` which routes to the right native module. |
| `activeModelService.ts` | Calls `onnxImageGeneratorService.loadModel()` which routes correctly. |
| `backgroundDownloadService.ts` | References `DownloadManagerModule` — same name on both platforms. |
| `ChatScreen.tsx` | Subscribes to `imageGenerationService` — platform-agnostic. |
| `GalleryScreen.tsx` | Reads from `appStore.generatedImages` — platform-agnostic. |
| `ModelSettingsScreen.tsx` | Settings are just numbers (steps, guidance, etc.) — platform-agnostic. |
| `DownloadManagerScreen.tsx` | Uses `backgroundDownloadService` — platform-agnostic. |
| All Zustand stores | Pure state — no platform awareness. |

### 3.4 The "One Change" Rule

When adding iOS support, each layer requires exactly one touch point:

```
localDreamGenerator.ts:
  BEFORE:  const { LocalDreamModule } = NativeModules;
  AFTER:   const DiffusionModule = Platform.select({
             android: NativeModules.LocalDreamModule,
             ios: NativeModules.CoreMLDiffusionModule,
           });

backgroundDownloadService.ts:
  BEFORE:  return Platform.OS === 'android' && DownloadManagerModule != null;
  AFTER:   return DownloadManagerModule != null;
  (Because iOS module is also named DownloadManagerModule)

imageGenerationService.ts:
  BEFORE:  gpuBackend = Platform.OS === 'ios' ? 'Metal' : ...
  AFTER:   gpuBackend = Platform.OS === 'ios' ? 'Core ML (ANE)' : ...
```

That's it. Three files with small changes. Everything else is new native code or new model browser code.

---

## 4. Feature 1: Image Generation via Core ML

### 4.1 Technology Choice: Apple `ml-stable-diffusion`

**Repository**: [apple/ml-stable-diffusion](https://github.com/apple/ml-stable-diffusion)

This is Apple's official Swift package for running Stable Diffusion on Apple Silicon via Core ML. It provides:
- `StableDiffusionPipeline` class — load model, generate images, step-by-step callbacks
- ANE-optimized attention (`SPLIT_EINSUM_V2`) — runs on Apple Neural Engine for speed
- `reduceMemory` mode — critical for iPhones with limited RAM
- Support for SD 1.5, 2.0, 2.1, SDXL, SD3

**Why this over alternatives?**:
- `expo-stable-diffusion` — last updated Aug 2023, abandoned, limited
- `react-native-ml-stable-diffusion` — 5 GitHub stars, 10 commits, beta, abandoned
- `react-native-executorch` (Software Mansion) — no image generation support yet
- Custom Metal shaders (Draw Things approach) — proprietary, not available as library
- **Apple's own package**: actively maintained, official, well-documented, best iOS SD performance

### 4.2 How Core ML SD Works (vs Android LocalDream)

| Aspect | Android (LocalDream) | iOS (Core ML) |
|--------|---------------------|---------------|
| **Runtime** | Spawns `libstable_diffusion_core.so` as subprocess | In-process `StableDiffusionPipeline` |
| **Communication** | HTTP POST to localhost:18081, SSE response | Direct Swift method calls |
| **Hardware accel** | MNN (CPU), QNN (Qualcomm NPU) | Core ML auto-dispatches across CPU + GPU + ANE |
| **Model format** | `.mnn` / `.bin` files | `.mlmodelc` compiled Core ML models |
| **Model components** | clip, unet, vae_decoder, tokenizer.json | Same components but in Core ML format |
| **Progress** | SSE events parsed in Kotlin → RN events | Pipeline callback in Swift → RN events |
| **Image output** | RGB bytes → Android Bitmap → PNG | CGImage → UIImage → PNG |
| **Cancel** | Disconnect HTTP connection | Boolean flag checked between steps |
| **Memory** | 1.8x file size multiplier | 1.5x (more efficient due to ANE offloading) |

### 4.3 Native Module: `CoreMLDiffusionModule.swift`

**Location**: `ios/LocalLLM/CoreMLDiffusion/CoreMLDiffusionModule.swift`

```swift
import StableDiffusion  // Apple's ml-stable-diffusion package

@objc(CoreMLDiffusionModule)
class CoreMLDiffusionModule: RCTEventEmitter {

    private var pipeline: StableDiffusionPipeline?
    private var loadedModelPath: String?
    private var isCurrentlyGenerating = false
    private var cancelFlag = false
    private let generationQueue = DispatchQueue(
        label: "com.localllm.coreml.generation",
        qos: .userInitiated
    )

    // ─── Lifecycle ──────────────────────────────────────────

    @objc func loadModel(_ params: NSDictionary,
                         resolve: @escaping RCTPromiseResolveBlock,
                         reject: @escaping RCTPromiseRejectBlock) {
        guard let modelPath = params["modelPath"] as? String else {
            reject("INVALID_PARAMS", "modelPath required", nil)
            return
        }

        generationQueue.async { [weak self] in
            do {
                // Unload previous model
                self?.pipeline = nil

                let config = MLModelConfiguration()
                config.computeUnits = .cpuAndNeuralEngine

                let resourceURL = URL(fileURLWithPath: modelPath)
                self?.pipeline = try StableDiffusionPipeline(
                    resourcesAt: resourceURL,
                    controlNet: [],
                    configuration: config,
                    reduceMemory: true  // Critical for iPhone
                )
                try self?.pipeline?.loadResources()
                self?.loadedModelPath = modelPath
                resolve(true)
            } catch {
                reject("LOAD_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc func unloadModel(_ resolve: @escaping RCTPromiseResolveBlock,
                           reject: @escaping RCTPromiseRejectBlock) {
        pipeline = nil
        loadedModelPath = nil
        resolve(true)
    }

    @objc func isModelLoaded(_ resolve: @escaping RCTPromiseResolveBlock,
                             reject: @escaping RCTPromiseRejectBlock) {
        resolve(pipeline != nil)
    }

    @objc func getLoadedModelPath(_ resolve: @escaping RCTPromiseResolveBlock,
                                  reject: @escaping RCTPromiseRejectBlock) {
        resolve(loadedModelPath as Any)
    }

    // ─── Generation ─────────────────────────────────────────

    @objc func generateImage(_ params: NSDictionary,
                             resolve: @escaping RCTPromiseResolveBlock,
                             reject: @escaping RCTPromiseRejectBlock) {
        guard let pipeline = self.pipeline else {
            reject("NO_MODEL", "No model loaded", nil)
            return
        }
        guard !isCurrentlyGenerating else {
            reject("BUSY", "Generation already in progress", nil)
            return
        }

        let prompt = params["prompt"] as? String ?? ""
        let negativePrompt = params["negativePrompt"] as? String ?? ""
        let steps = params["steps"] as? Int ?? 20
        let guidanceScale = params["guidanceScale"] as? Float ?? 7.5
        let seed = params["seed"] as? UInt32 ?? UInt32.random(in: 0..<UInt32.max)
        let width = params["width"] as? Int ?? 512
        let height = params["height"] as? Int ?? 512
        let previewInterval = params["previewInterval"] as? Int ?? 2

        isCurrentlyGenerating = true
        cancelFlag = false
        let startTime = Date()

        generationQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                var config = StableDiffusionPipeline.Configuration(prompt: prompt)
                config.negativePrompt = negativePrompt
                config.stepCount = steps
                config.seed = seed
                config.guidanceScale = guidanceScale
                // Note: Core ML SD uses fixed 512x512 for SD1.5/2.1.
                // SDXL can do 768x768+.

                let images = try pipeline.generateImages(
                    configuration: config,
                    progressHandler: { progress in
                        let step = progress.step
                        let total = progress.stepCount

                        // Emit progress event (same shape as Android)
                        var eventData: [String: Any] = [
                            "step": step,
                            "totalSteps": total,
                            "progress": Float(step) / Float(total),
                        ]

                        // Save preview image at intervals
                        if step % previewInterval == 0,
                           let currentImage = progress.currentImages.first,
                           let cgImage = currentImage {
                            let previewPath = self.savePreviewImage(
                                cgImage, step: step
                            )
                            if let path = previewPath {
                                eventData["previewPath"] = path
                            }
                        }

                        self.sendEvent(
                            withName: "LocalDreamProgress",
                            body: eventData
                        )

                        // Check cancel flag
                        return !self.cancelFlag
                    }
                )

                self.isCurrentlyGenerating = false

                if self.cancelFlag {
                    reject("CANCELLED", "Generation cancelled", nil)
                    return
                }

                // Save final image
                guard let cgImage = images?.compactMap({ $0 }).first else {
                    reject("NO_OUTPUT", "No image generated", nil)
                    return
                }

                let imageId = UUID().uuidString
                let imagePath = self.saveGeneratedImage(cgImage, id: imageId)
                let genTimeMs = Int(Date().timeIntervalSince(startTime) * 1000)

                resolve([
                    "id": imageId,
                    "imagePath": imagePath,
                    "width": width,
                    "height": height,
                    "seed": seed,
                    "generationTimeMs": genTimeMs,
                ] as [String: Any])

            } catch {
                self.isCurrentlyGenerating = false
                reject("GEN_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc func cancelGeneration(_ resolve: @escaping RCTPromiseResolveBlock,
                                reject: @escaping RCTPromiseRejectBlock) {
        cancelFlag = true
        resolve(true)
    }

    @objc func isGenerating(_ resolve: @escaping RCTPromiseResolveBlock,
                            reject: @escaping RCTPromiseRejectBlock) {
        resolve(isCurrentlyGenerating)
    }

    @objc func isNpuSupported(_ resolve: @escaping RCTPromiseResolveBlock,
                              reject: @escaping RCTPromiseRejectBlock) {
        // All A14+ chips have Neural Engine; Core ML uses it automatically
        resolve(true)
    }

    // ─── File Management ────────────────────────────────────

    // getGeneratedImages(), deleteGeneratedImage(), saveRgbAsPng()
    // — same file management patterns as Android, using FileManager
    // — images stored in Documents/generated_images/<uuid>.png
    // — previews stored in Caches/preview/preview_step_<N>.png

    // ─── Constants ──────────────────────────────────────────

    override func constantsToExport() -> [AnyHashable: Any]! {
        return [
            "DEFAULT_STEPS": 20,
            "DEFAULT_GUIDANCE_SCALE": 7.5,
            "DEFAULT_WIDTH": 512,
            "DEFAULT_HEIGHT": 512,
            "SUPPORTED_WIDTHS": [128, 192, 256, 320, 384, 448, 512],
            "SUPPORTED_HEIGHTS": [128, 192, 256, 320, 384, 448, 512],
            "SERVER_PORT": 0,  // No server on iOS
        ]
    }

    override func supportedEvents() -> [String]! {
        return ["LocalDreamProgress", "LocalDreamError"]
    }

    // ─── Private Helpers ────────────────────────────────────

    private func saveGeneratedImage(_ image: CGImage, id: String) -> String {
        let docsDir = FileManager.default.urls(
            for: .documentDirectory, in: .userDomainMask
        ).first!
        let imagesDir = docsDir.appendingPathComponent("generated_images")
        try? FileManager.default.createDirectory(
            at: imagesDir, withIntermediateDirectories: true
        )
        let filePath = imagesDir.appendingPathComponent("\(id).png")

        let uiImage = UIImage(cgImage: image)
        if let data = uiImage.pngData() {
            try? data.write(to: filePath)
        }
        return filePath.path
    }

    private func savePreviewImage(_ image: CGImage, step: Int) -> String? {
        let cachesDir = FileManager.default.urls(
            for: .cachesDirectory, in: .userDomainMask
        ).first!
        let previewDir = cachesDir.appendingPathComponent("preview")
        try? FileManager.default.createDirectory(
            at: previewDir, withIntermediateDirectories: true
        )
        let filePath = previewDir.appendingPathComponent(
            "preview_step_\(step).png"
        )

        let uiImage = UIImage(cgImage: image)
        if let data = uiImage.pngData() {
            try? data.write(to: filePath)
            return filePath.path
        }
        return nil
    }
}
```

**ObjC bridge** (`CoreMLDiffusionModule.m`):

```objc
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(CoreMLDiffusionModule, RCTEventEmitter)

RCT_EXTERN_METHOD(loadModel:(NSDictionary *)params
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(unloadModel:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isModelLoaded:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getLoadedModelPath:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(generateImage:(NSDictionary *)params
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(cancelGeneration:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isGenerating:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isNpuSupported:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(saveRgbAsPng:(NSDictionary *)params
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getGeneratedImages:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deleteGeneratedImage:(NSString *)imageId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
```

### 4.4 Core ML Model Format & Hosting

**Model structure on disk** (after download + extraction):

```
Documents/image_models/stable-diffusion-2-1-base/
├── TextEncoder.mlmodelc/          # CLIP text encoder
├── Unet.mlmodelc/                 # Denoising UNet (or chunked:)
├── UnetChunk1.mlmodelc/           #   Chunk 1 (< 1GB, required for iOS)
├── UnetChunk2.mlmodelc/           #   Chunk 2
├── VAEDecoder.mlmodelc/           # VAE decoder
├── SafetyChecker.mlmodelc/        # Safety checker (optional)
├── merges.txt                     # Tokenizer merge rules
└── vocab.json                     # Tokenizer vocabulary
```

**Pre-converted models on HuggingFace** (ready to download):

| Repo | Model | Attention | Quantization | Size |
|------|-------|-----------|-------------|------|
| `apple/coreml-stable-diffusion-2-1-base` | SD 2.1 Base | SPLIT_EINSUM_V2 | float16 | ~2.5 GB |
| `apple/coreml-stable-diffusion-2-1-base` | SD 2.1 Base | SPLIT_EINSUM_V2 | 6-bit palettized | ~1.0 GB |
| `apple/coreml-stable-diffusion-v1-5` | SD 1.5 | SPLIT_EINSUM_V2 | float16 | ~2.5 GB |

**Key**: Always use `SPLIT_EINSUM_V2` attention variant — this is optimized for ANE. The `ORIGINAL` variant only uses GPU and is significantly slower on iPhone.

**Key**: Always use chunked UNet (`UnetChunk1` + `UnetChunk2`) — iOS Neural Engine has a per-model size limit under 1GB.

### 4.5 Model Conversion (for custom models)

If we want to offer the same models as Android (AnythingV5, AbsoluteReality, etc.), they need to be converted to Core ML format. This is a **one-time offline process** using Apple's Python tooling:

```bash
# Install conversion tools
pip install -e "git+https://github.com/apple/ml-stable-diffusion.git#egg=python_coreml_stable_diffusion"

# Convert SD 1.5 custom model to Core ML
python -m python_coreml_stable_diffusion.torch2coreml \
  --model-version "runwayml/stable-diffusion-v1-5" \
  --convert-unet --convert-text-encoder --convert-vae-decoder \
  --attention-implementation SPLIT_EINSUM_V2 \
  --chunk-unet \
  --quantize-nbits 6 \
  -o ./output_coreml/

# Compile for iOS deployment
xcrun coremlcompiler compile output_coreml/Unet.mlpackage output_coreml/
```

The converted + compiled models are then uploaded to HuggingFace for iOS users to download.

---

## 5. Feature 2: Background Downloads via URLSession

### 5.1 How iOS Background Downloads Work

iOS background downloads use `URLSession` with a background configuration. The actual download is handled by a system daemon (`nsurlsessiond`) that runs outside the app process — similar to how Android's `DownloadManager` is a system service.

```
┌──────────────────────────────────────────────────┐
│ Android                     │ iOS                 │
├──────────────────────────────┼─────────────────────┤
│ System DownloadManager       │ URLSession (bgnd)   │
│ SharedPreferences            │ UserDefaults        │
│ BroadcastReceiver            │ AppDelegate handler │
│ 500ms polling for progress   │ Delegate callbacks  │
│ Survives force-quit          │ NOT force-quit      │
│ System notification built-in │ Manual notification │
│ Numeric downloadId           │ Task identifier     │
└──────────────────────────────┴─────────────────────┘
```

### 5.2 Native Module: `BackgroundDownloadModule.swift`

**Critical design decision**: Name this module `DownloadManagerModule` (same as Android) so that `NativeModules.DownloadManagerModule` resolves on both platforms. This means zero changes to `backgroundDownloadService.ts` beyond removing the `Platform.OS === 'android'` check.

**Location**: `ios/LocalLLM/BackgroundDownload/BackgroundDownloadModule.swift`

```swift
@objc(DownloadManagerModule)
class BackgroundDownloadModule: RCTEventEmitter, URLSessionDownloadDelegate {

    static let sessionId = "com.localllm.backgrounddownload"
    static var shared: BackgroundDownloadModule?
    private var backgroundCompletionHandler: (() -> Void)?

    // Track active downloads: taskId -> metadata
    private var activeDownloads: [Int: DownloadMetadata] = [:]

    private struct DownloadMetadata: Codable {
        let downloadId: Int     // Maps to URLSessionTask.taskIdentifier
        let url: String
        let fileName: String
        let modelId: String
        let title: String
        let totalBytes: Int64
        var status: String
        var bytesDownloaded: Int64
        var startedAt: Double
        var completedAt: Double?
        var completedEventSent: Bool  // Race condition guard (same as Android)
        var localUri: String?
        var failureReason: String?
    }

    // ─── Lazy Background Session ────────────────────────────

    private lazy var backgroundSession: URLSession = {
        let config = URLSessionConfiguration.background(
            withIdentifier: Self.sessionId
        )
        config.isDiscretionary = false         // Start immediately
        config.sessionSendsLaunchEvents = true // Relaunch on completion
        config.allowsCellularAccess = true
        config.timeoutIntervalForResource = 86400 // 24 hours
        return URLSession(
            configuration: config,
            delegate: self,
            delegateQueue: nil
        )
    }()

    // ─── Exported Methods (same as Android) ─────────────────

    @objc func startDownload(_ params: NSDictionary, ...) {
        // 1. Create URLSessionDownloadTask
        // 2. Persist metadata to UserDefaults
        // 3. Resume task
        // 4. Return {downloadId, fileName, modelId}
    }

    @objc func cancelDownload(_ downloadId: NSNumber, ...) {
        // Find task by identifier, cancel it, clean up
    }

    @objc func getActiveDownloads(_ resolve: ..., reject: ...) {
        // Read from UserDefaults, return array
    }

    @objc func getDownloadProgress(_ downloadId: NSNumber, ...) {
        // Return current bytes/total/status from in-memory tracking
    }

    @objc func moveCompletedDownload(_ downloadId: NSNumber,
                                      targetPath: NSString, ...) {
        // Move from temp completion location to target
    }

    // No-ops for API compatibility with Android's polling model
    @objc func startProgressPolling(_ resolve: ..., reject: ...) {
        resolve(nil)  // iOS uses delegate callbacks, no polling needed
    }

    @objc func stopProgressPolling(_ resolve: ..., reject: ...) {
        resolve(nil)
    }

    // ─── URLSessionDownloadDelegate ─────────────────────────

    func urlSession(_ session: URLSession,
                    downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        // Emit DownloadProgress event (same shape as Android)
        let taskId = downloadTask.taskIdentifier
        guard let meta = activeDownloads[taskId] else { return }

        sendEvent(withName: "DownloadProgress", body: [
            "downloadId": meta.downloadId,
            "fileName": meta.fileName,
            "modelId": meta.modelId,
            "bytesDownloaded": totalBytesWritten,
            "totalBytes": totalBytesExpectedToWrite,
            "status": "running",
        ])
    }

    func urlSession(_ session: URLSession,
                    downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        // CRITICAL: File at `location` is temporary.
        // Must move it SYNCHRONOUSLY in this method or it's deleted.
        let taskId = downloadTask.taskIdentifier
        guard var meta = activeDownloads[taskId] else { return }

        // Move to intermediate location in Documents
        let docsDir = FileManager.default.urls(
            for: .documentDirectory, in: .userDomainMask
        ).first!
        let downloadsDir = docsDir.appendingPathComponent("downloads")
        try? FileManager.default.createDirectory(
            at: downloadsDir, withIntermediateDirectories: true
        )
        let destURL = downloadsDir.appendingPathComponent(meta.fileName)
        try? FileManager.default.moveItem(at: location, to: destURL)

        // Update metadata
        meta.status = "completed"
        meta.localUri = destURL.path
        meta.completedAt = Date().timeIntervalSince1970 * 1000
        activeDownloads[taskId] = meta
        persistDownloads()

        // Emit DownloadComplete (same shape as Android)
        if !meta.completedEventSent {
            sendEvent(withName: "DownloadComplete", body: [
                "downloadId": meta.downloadId,
                "fileName": meta.fileName,
                "modelId": meta.modelId,
                "bytesDownloaded": meta.totalBytes,
                "totalBytes": meta.totalBytes,
                "status": "completed",
                "localUri": destURL.path,
            ])
            meta.completedEventSent = true
            activeDownloads[taskId] = meta
            persistDownloads()
        }
    }

    func urlSession(_ session: URLSession,
                    task: URLSessionTask,
                    didCompleteWithError error: Error?) {
        guard let error = error else { return }
        let taskId = task.taskIdentifier
        guard let meta = activeDownloads[taskId] else { return }

        sendEvent(withName: "DownloadError", body: [
            "downloadId": meta.downloadId,
            "fileName": meta.fileName,
            "modelId": meta.modelId,
            "status": "failed",
            "reason": error.localizedDescription,
        ])
    }

    func urlSessionDidFinishEvents(
        forBackgroundURLSession session: URLSession
    ) {
        // Call the stored completion handler from AppDelegate
        DispatchQueue.main.async {
            self.backgroundCompletionHandler?()
            self.backgroundCompletionHandler = nil
        }
    }

    // ─── Background Session Recovery ────────────────────────

    func setBackgroundCompletionHandler(
        _ handler: @escaping () -> Void,
        for identifier: String
    ) {
        if identifier == Self.sessionId {
            backgroundCompletionHandler = handler
        }
    }

    // ─── Persistence (UserDefaults) ─────────────────────────

    private func persistDownloads() {
        // Encode activeDownloads to JSON, save to UserDefaults
        // Key: "com.localllm.activeDownloads"
    }

    private func restoreDownloads() {
        // Decode from UserDefaults on init
        // Reconnect with existing background session tasks
    }

    // ─── Events ─────────────────────────────────────────────

    override func supportedEvents() -> [String]! {
        return ["DownloadProgress", "DownloadComplete", "DownloadError"]
    }
}
```

### 5.3 AppDelegate Changes

**File**: `ios/LocalLLM/AppDelegate.swift`

Add this method to handle downloads completing while app was suspended/terminated:

```swift
func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
) {
    // iOS calls this when a background download completes while app was dead.
    // The URLSession is recreated (lazily) with the same identifier,
    // and the system delivers all pending delegate events.
    BackgroundDownloadModule.shared?.setBackgroundCompletionHandler(
        completionHandler, for: identifier
    )
}
```

### 5.4 Key Difference: Force-Quit Behavior

This is the one **unavoidable iOS limitation**:

| Scenario | Android | iOS |
|----------|---------|-----|
| User presses Home | Download continues | Download continues |
| System kills app (low memory) | Download continues | Download continues |
| User swipes up to force-quit | **Download continues** | **Download CANCELLED** |

There is no workaround for this. Apple cancels all background URLSession transfers when the user force-quits. We should:
1. Document this clearly in the UI (e.g., "Keep app running for download to complete")
2. Implement resume data support so cancelled downloads can be restarted
3. Fall back to foreground downloads (RNFS) if background is unreliable

---

## 6. Feature 3: Image Model Browsing for Core ML

### 6.1 New Service: `coreMLModelBrowser.ts`

**Location**: `src/services/coreMLModelBrowser.ts`

This parallels the existing `huggingFaceModelBrowser.ts` which fetches Android-specific MNN/QNN models from `xororz/sd-mnn` and `xororz/sd-qnn`.

```typescript
export interface CoreMLImageModel {
  id: string;
  name: string;
  displayName: string;
  backend: 'coreml';
  attention: 'split_einsum_v2' | 'original';
  quantization: 'float16' | '6bit' | '8bit';
  downloadUrl: string;
  fileName: string;
  size: number;
  repo: string;
  minRAM: number;  // Minimum device RAM in GB
}

const COREML_REPOS = [
  'apple/coreml-stable-diffusion-2-1-base',
  'apple/coreml-stable-diffusion-v1-5',
  // Add community repos with quantized variants as available
] as const;

export async function fetchAvailableCoreMLModels(
  forceRefresh = false
): Promise<CoreMLImageModel[]> {
  // 1. Fetch HuggingFace tree API for each repo
  // 2. Filter for .zip files containing SPLIT_EINSUM_V2 variants
  // 3. Parse file names to extract quantization level
  // 4. Return sorted by size (smallest first)
}
```

### 6.2 Platform-Aware ModelsScreen

**File**: `src/screens/ModelsScreen.tsx`

The image models tab currently calls `fetchAvailableModels()` from `huggingFaceModelBrowser.ts`. On iOS, it should call `fetchAvailableCoreMLModels()`:

```typescript
import { Platform } from 'react-native';
import { fetchAvailableModels } from '../services/huggingFaceModelBrowser';
import { fetchAvailableCoreMLModels } from '../services/coreMLModelBrowser';

// In the image tab section:
const imageModels = Platform.OS === 'ios'
  ? await fetchAvailableCoreMLModels()
  : await fetchAvailableModels();
```

The `ModelCard` component works for both — it displays name, size, download button. The only visual difference is the backend badge (`Core ML` instead of `MNN`/`QNN`).

### 6.3 Model Manager Extension

**File**: `src/services/modelManager.ts`

Add Core ML model download and extraction:

```typescript
async downloadCoreMLImageModel(
  model: CoreMLImageModel,
  onProgress?: (progress: DownloadProgress) => void
): Promise<ONNXImageModel> {
  // 1. Download .zip from HuggingFace
  // 2. Extract to Documents/image_models/{modelName}/
  //    Contains: TextEncoder.mlmodelc/, UnetChunk1.mlmodelc/,
  //              UnetChunk2.mlmodelc/, VAEDecoder.mlmodelc/, etc.
  // 3. Create ONNXImageModel metadata with backend: 'coreml'
  // 4. Add to appStore.downloadedImageModels
  // 5. Return metadata
}
```

---

## 7. Shared TypeScript Changes

These are the minimal TypeScript changes needed to support both platforms.

### 7.1 `src/types/index.ts`

```typescript
// BEFORE:
export interface ONNXImageModel {
  // ...
  backend?: 'mnn' | 'qnn';
}

// AFTER:
export interface ONNXImageModel {
  // ...
  backend?: 'mnn' | 'qnn' | 'coreml';
}
```

### 7.2 `src/services/localDreamGenerator.ts`

```typescript
// BEFORE:
const { LocalDreamModule } = NativeModules;
// ...
class LocalDreamGeneratorService {
  private getEmitter(): NativeEventEmitter {
    if (!this.eventEmitter) {
      this.eventEmitter = new NativeEventEmitter(LocalDreamModule);
    }
    return this.eventEmitter;
  }

  isAvailable(): boolean {
    return Platform.OS === 'android' && LocalDreamModule != null;
  }
  // ... all methods use LocalDreamModule directly
}

// AFTER:
const { LocalDreamModule, CoreMLDiffusionModule } = NativeModules;

// Platform-select the right native module at import time
const DiffusionModule = Platform.select({
  android: LocalDreamModule,
  ios: CoreMLDiffusionModule,
  default: null,
});

class LocalDreamGeneratorService {
  private getEmitter(): NativeEventEmitter {
    if (!this.eventEmitter && DiffusionModule) {
      this.eventEmitter = new NativeEventEmitter(DiffusionModule);
    }
    return this.eventEmitter!;
  }

  isAvailable(): boolean {
    return DiffusionModule != null;
  }
  // ... all methods use DiffusionModule instead of LocalDreamModule
  //     (find-replace: LocalDreamModule → DiffusionModule)
}
```

That's it — the rest of the class stays identical because both native modules have the same interface.

### 7.3 `src/services/backgroundDownloadService.ts`

```typescript
// BEFORE:
isAvailable(): boolean {
  return Platform.OS === 'android' && DownloadManagerModule != null;
}

// AFTER:
isAvailable(): boolean {
  return DownloadManagerModule != null;
}
```

One line. The iOS native module uses the same name `DownloadManagerModule`, so everything else works.

### 7.4 `src/services/imageGenerationService.ts`

```typescript
// BEFORE (line 379-383):
const gpuBackend = Platform.OS === 'ios'
  ? 'Metal'
  : backend === 'qnn'
    ? 'QNN (NPU)'
    : 'MNN (CPU)';

// AFTER:
const gpuBackend = Platform.OS === 'ios'
  ? 'Core ML (ANE)'
  : backend === 'qnn'
    ? 'QNN (NPU)'
    : 'MNN (CPU)';
```

### 7.5 `src/services/activeModelService.ts`

```typescript
// Update memory estimation for Core ML models (line 22):
// BEFORE:
const IMAGE_MODEL_OVERHEAD_MULTIPLIER = 1.8;

// AFTER:
const IMAGE_MODEL_OVERHEAD_MULTIPLIER = Platform.OS === 'ios' ? 1.5 : 1.8;
// Core ML is more memory-efficient due to ANE offloading
```

---

## 8. iOS Project Configuration

### 8.1 Deployment Target

**Why raise it**: Apple's `ml-stable-diffusion` requires iOS 16.2+ minimum. 6-bit quantization (which cuts model size ~60%, critical for fitting in iPhone RAM) requires iOS 17.0+.

**Current**: iOS 13.0 in Podfile, 15.1 in Xcode project

**Target**: iOS 17.0

| File | Change |
|------|--------|
| `ios/Podfile` | `platform :ios, '13.0'` → `platform :ios, '17.0'` |
| `ios/LocalLLM.xcodeproj/project.pbxproj` | All `IPHONEOS_DEPLOYMENT_TARGET` → `17.0` |

### 8.2 Entitlements

**New file**: `ios/LocalLLM/LocalLLM.entitlements`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.developer.kernel.increased-memory-limit</key>
    <true/>
</dict>
</plist>
```

This entitlement is **required** for Stable Diffusion models which consume 1-2.5GB of RAM. Without it, iOS will kill the app when memory exceeds the default per-app limit (~2GB on most iPhones).

### 8.3 Info.plist

Add background modes for download support:

```xml
<key>UIBackgroundModes</key>
<array>
    <string>fetch</string>
    <string>processing</string>
</array>
```

### 8.4 Swift Package Manager Dependency

Add `ml-stable-diffusion` via Xcode's SPM integration:

- **URL**: `https://github.com/apple/ml-stable-diffusion`
- **Version**: Latest stable (currently 1.x)
- **Add to**: `LocalLLM` target

This is added via `project.pbxproj` modifications (Xcode handles this when you add the package through its UI).

### 8.5 Bridging Header

If one doesn't exist, create `ios/LocalLLM/LocalLLM-Bridging-Header.h`:

```objc
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
```

---

## 9. Complete File Manifest

### New Files (10 files)

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `ios/LocalLLM/CoreMLDiffusion/CoreMLDiffusionModule.swift` | ~500 | Core ML SD native module |
| `ios/LocalLLM/CoreMLDiffusion/CoreMLDiffusionModule.m` | ~40 | ObjC bridge macros |
| `ios/LocalLLM/BackgroundDownload/BackgroundDownloadModule.swift` | ~400 | URLSession download module |
| `ios/LocalLLM/BackgroundDownload/BackgroundDownloadModule.m` | ~30 | ObjC bridge macros |
| `ios/LocalLLM/LocalLLM.entitlements` | ~10 | Increased memory limit |
| `src/services/coreMLModelBrowser.ts` | ~150 | Core ML model discovery |
| `__tests__/contracts/coreMLDiffusion.contract.test.ts` | ~80 | Interface contract test |
| `__tests__/contracts/iosDownloadManager.contract.test.ts` | ~80 | Interface contract test |

### Modified Files (13 files)

| File | What Changes | Scope |
|------|-------------|-------|
| `ios/Podfile` | Deployment target 13.0 → 17.0 | 1 line |
| `ios/LocalLLM.xcodeproj/project.pbxproj` | Target, SPM package, entitlements, new sources | Config |
| `ios/LocalLLM/Info.plist` | Add UIBackgroundModes | 4 lines |
| `ios/LocalLLM/AppDelegate.swift` | Add handleEventsForBackgroundURLSession | ~10 lines |
| `src/types/index.ts` | Add `'coreml'` to backend union | 1 line |
| `src/services/localDreamGenerator.ts` | Platform-select native module | ~10 lines + find-replace |
| `src/services/backgroundDownloadService.ts` | Remove Platform.OS check | 1 line |
| `src/services/imageGenerationService.ts` | Update gpuBackend display string | 1 line |
| `src/services/activeModelService.ts` | Platform-aware memory multiplier | 1 line |
| `src/services/modelManager.ts` | Add downloadCoreMLImageModel() | ~50 lines |
| `src/screens/ModelsScreen.tsx` | Platform-aware image model fetching | ~10 lines |
| `src/screens/DownloadManagerScreen.tsx` | Remove Android-only gates | ~5 lines |
| `docs/CODEBASE_GUIDE.md` | Update iOS native section | Documentation |

### Untouched Files (the payoff of good abstractions)

These files need **zero changes** despite gaining iOS image generation + background downloads:

- `src/services/imageGenerationService.ts` (except 1 string)
- `src/services/generationService.ts`
- `src/screens/ChatScreen.tsx`
- `src/screens/GalleryScreen.tsx`
- `src/screens/HomeScreen.tsx`
- `src/screens/ModelSettingsScreen.tsx`
- `src/stores/appStore.ts`
- `src/stores/chatStore.ts`
- `src/components/ChatInput.tsx`
- `src/components/ChatMessage.tsx`
- All other screens and components

---

## 10. Testing Strategy

### 10.1 Contract Tests (verify interface parity)

The most critical tests: verify that both native modules expose the same interface.

```typescript
// __tests__/contracts/coreMLDiffusion.contract.test.ts
describe('CoreMLDiffusionModule contract', () => {
  it('exposes same methods as LocalDreamModule', () => {
    const expectedMethods = [
      'loadModel', 'unloadModel', 'isModelLoaded',
      'getLoadedModelPath', 'generateImage', 'cancelGeneration',
      'isGenerating', 'isNpuSupported', 'saveRgbAsPng',
      'getGeneratedImages', 'deleteGeneratedImage',
    ];
    // Verify each method exists on the mock
  });

  it('emits same events as LocalDreamModule', () => {
    const expectedEvents = ['LocalDreamProgress', 'LocalDreamError'];
    // Verify supportedEvents() returns these
  });

  it('getConstants() returns expected shape', () => {
    // Verify DEFAULT_STEPS, DEFAULT_GUIDANCE_SCALE, etc.
  });
});
```

### 10.2 Integration Tests

```typescript
// __tests__/integration/generation/imageGenerationFlow.test.ts
describe('Image generation flow', () => {
  describe('iOS (Core ML)', () => {
    beforeEach(() => {
      Platform.OS = 'ios';
      // Mock CoreMLDiffusionModule
    });

    it('routes to CoreMLDiffusionModule on iOS', () => { ... });
    it('emits LocalDreamProgress events', () => { ... });
    it('saves generated image to Documents/generated_images/', () => { ... });
    it('reports Core ML (ANE) as gpuBackend', () => { ... });
  });

  describe('Android (LocalDream)', () => {
    // Existing tests unchanged
  });
});
```

### 10.3 E2E Tests (Maestro)

The existing Maestro flow `.maestro/flows/p0/07-image-generation.yaml` should work on both platforms since it interacts with UI elements (testIDs) that are shared. Verify:
- Image mode toggle works
- Generation progress shows
- Generated image appears in chat
- Image appears in gallery

### 10.4 Manual Testing Checklist

| Test | Platform | Steps |
|------|----------|-------|
| Load Core ML model | iOS | ModelsScreen → download SD 2.1 → verify loaded |
| Generate image | iOS | Chat → type "draw a cat" → verify image appears |
| Cancel generation | iOS | Start gen → tap stop → verify cancellation |
| Background gen | iOS | Start gen → go to HomeScreen → return → verify progress |
| Background download | iOS | Start model download → background app → return → verify progress |
| Memory pressure | iOS | Load SD model on 4GB device → verify no crash with 6-bit model |
| Gallery | iOS | Generate images → Gallery tab → verify grid + metadata |
| Model unload | iOS | Load model → unload → verify memory freed |

---

## 11. Risk Register

### High Severity

| Risk | Impact | Mitigation |
|------|--------|------------|
| **First-time Core ML compilation** takes 1-3 minutes | Users think app is frozen | Use pre-compiled `.mlmodelc` from HuggingFace (eliminates this entirely). Show "Optimizing model for your device (one-time)" progress indicator as fallback. |
| **4GB RAM iPhones crash** loading SD models | App killed by iOS | Default to 6-bit quantized models (~1GB). Enforce memory budget check. Block model load if estimated RAM > 60% of device total. Show "Recommended: iPhone 12 or newer with 6GB+ RAM" in UI. |
| **SPM + CocoaPods build conflicts** | Build fails | Test with clean builds. If conflicts arise, wrap `ml-stable-diffusion` in a local CocoaPod (`pod 'CoreMLDiffusion', :path => './LocalPods/CoreMLDiffusion'`). |

### Medium Severity

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Force-quit kills iOS downloads** | Users lose download progress | Implement resume data (`cancelByProducingResumeData`). Show warning: "Swiping away the app will cancel downloads." Fall back to foreground downloads. |
| **Core ML model availability** | Not all Android models have Core ML versions | Start with Apple's official pre-converted models (SD 1.5, 2.1). Convert popular Android models (AnythingV5, etc.) offline and host on HuggingFace. |
| **ANE availability varies by device** | Slower on older devices | Core ML auto-falls-back to CPU+GPU when ANE unavailable. Performance degrades gracefully (18s on iPhone 12 vs 5s on iPhone 15 Pro). |

### Low Severity

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Event name collision** (LocalDreamProgress on iOS) | Confusing naming | Accept it — renaming would break Android. The event name is internal (users never see it). |
| **Core ML model size differs from Android** | Confusing if same model shows different sizes | Show platform-specific sizes in model browser. iOS 6-bit is ~1GB vs Android MNN ~1.2GB. |

---

## 12. Platform Behavior Differences

Things developers need to remember when working on both platforms:

### Image Generation

| Behavior | Android | iOS |
|----------|---------|-----|
| Process architecture | Out-of-process HTTP server | In-process Core ML pipeline |
| GPU acceleration | QNN NPU (Qualcomm only) or CPU | ANE + GPU + CPU (automatic dispatch) |
| Model format | `.mnn` / `.bin` files | `.mlmodelc` directories |
| Model source repos | `xororz/sd-mnn`, `xororz/sd-qnn` | `apple/coreml-stable-diffusion-*` |
| Cancel mechanism | HTTP connection disconnect | Boolean flag between steps |
| Preview image format | RGB bytes → Android Bitmap → PNG | CGImage → UIImage → PNG |
| Memory overhead multiplier | 1.8x file size | 1.5x file size |
| Model loading time | Fast (subprocess spawn) | Slow first time (Core ML compilation), fast after |

### Background Downloads

| Behavior | Android | iOS |
|----------|---------|-----|
| System service | `DownloadManager` | `URLSession` background configuration |
| Progress delivery | Polling (500ms) | Delegate callbacks (push-based) |
| Persistence | SharedPreferences | UserDefaults |
| Survives force-quit? | Yes | **No** |
| System notification | Built-in (automatic) | Must create manually (optional) |
| Completion event | `BroadcastReceiver` | `handleEventsForBackgroundURLSession` in AppDelegate |
| File on completion | Stays in Downloads dir | **Temporary file, must move immediately** |
| Polling methods | Functional | No-ops (compatibility stubs) |

### Things That Are Identical

| Aspect | Both Platforms |
|--------|---------------|
| TypeScript interface | `loadModel()`, `generateImage()`, `cancelGeneration()`, etc. |
| Event names | `LocalDreamProgress`, `DownloadProgress`, `DownloadComplete`, `DownloadError` |
| Event shapes | Same JSON structure |
| Image storage | `Documents/generated_images/<uuid>.png` |
| Preview storage | `Caches/preview/preview_step_<N>.png` |
| Model storage | `Documents/image_models/<modelName>/` |
| Settings | Same params (steps, guidance, seed, width, height) |
| Gallery | Same `GeneratedImage` objects in `appStore.generatedImages` |

---

## 13. Performance Expectations

### Image Generation (SD 2.1 Base, 512x512, 20 steps)

| Device | Chip | RAM | Core ML (6-bit) | Viable? |
|--------|------|-----|-----------------|---------|
| iPhone 12 | A14 | 4 GB | ~18s | Yes (tight on RAM) |
| iPhone 13 | A15 | 4 GB | ~15s | Yes (tight on RAM) |
| iPhone 13 Pro | A15 Pro | 6 GB | ~12s | Yes |
| iPhone 14 | A15 | 6 GB | ~12s | Yes |
| iPhone 14 Pro | A16 | 6 GB | ~8s | Yes |
| iPhone 15 | A16 | 6 GB | ~8s | Yes |
| iPhone 15 Pro | A17 Pro | 8 GB | ~5-6s | Excellent |
| iPhone 16 | A18 | 8 GB | ~4-5s | Excellent |
| iPhone 16 Pro | A18 Pro | 8 GB | ~3-5s | Best |

**For comparison, Android:**
- CPU (MNN): ~15s on Snapdragon 8 Gen 3
- NPU (QNN): ~5-10s on Snapdragon 8 Gen 2+

### Background Downloads

| Connection | 1GB Model | 2.5GB Model |
|-----------|-----------|-------------|
| Wi-Fi (50 Mbps) | ~2.5 min | ~7 min |
| 5G (100 Mbps) | ~1.5 min | ~3.5 min |
| LTE (20 Mbps) | ~7 min | ~17 min |

Same on both platforms — download speed is network-bound, not implementation-bound.

---

## 14. Phase Ordering & Dependencies

```
Phase 1: iOS Project Configuration (1-2 days)
  ├── Raise deployment target to 17.0
  ├── Add entitlements file
  ├── Add SPM dependency (ml-stable-diffusion)
  ├── Update Info.plist
  └── Extend ONNXImageModel.backend type
       │
       ▼
Phase 2: Core ML Image Generation Native Module (5-7 days)  ← CRITICAL PATH
  ├── CoreMLDiffusionModule.swift (~500 lines)
  ├── CoreMLDiffusionModule.m (ObjC bridge)
  ├── Update localDreamGenerator.ts (Platform.select)
  ├── Update imageGenerationService.ts (backend string)
  └── Contract tests
       │
       ▼
Phase 3: Core ML Model Browsing & Download (3-4 days)
  ├── coreMLModelBrowser.ts (new service)
  ├── Update modelManager.ts (Core ML download/extraction)
  ├── Update ModelsScreen.tsx (platform-aware tab)
  └── Convert/host initial Core ML models on HuggingFace
       │
       ▼
Phase 4: Background Downloads Native Module (3-4 days)
  ├── BackgroundDownloadModule.swift (~400 lines)
  ├── BackgroundDownloadModule.m (ObjC bridge)
  ├── Update AppDelegate.swift (background session handler)
  ├── Update backgroundDownloadService.ts (remove platform gate)
  ├── Update DownloadManagerScreen.tsx (remove platform gates)
  └── Contract tests
       │
       ▼
Phase 5: Integration Testing & Polish (2-3 days)
  ├── Update activeModelService.ts (memory multiplier)
  ├── Integration tests
  ├── Manual testing on real devices
  ├── Update CODEBASE_GUIDE.md
  └── Edge case fixes

Total estimate: 14-20 days
```

**Phase 2 is the critical path** — it's the most complex native code and the highest-risk integration. Phases 3 and 4 can run in parallel after Phase 2 is stable.

**Phase 4 (background downloads) is independent** of image generation. It could be started in parallel with Phase 2 if two developers are available.

---

## Appendix: Quick Reference — "Where Does Platform-Specific Code Live?"

For any developer working on this codebase, here's where to look when something is platform-specific:

```
ANDROID-SPECIFIC:
  android/app/src/main/java/com/localllm/localdream/LocalDreamModule.kt
  android/app/src/main/java/com/localllm/download/DownloadManagerModule.kt

iOS-SPECIFIC:
  ios/LocalLLM/CoreMLDiffusion/CoreMLDiffusionModule.swift
  ios/LocalLLM/CoreMLDiffusion/CoreMLDiffusionModule.m
  ios/LocalLLM/BackgroundDownload/BackgroundDownloadModule.swift
  ios/LocalLLM/BackgroundDownload/BackgroundDownloadModule.m

PLATFORM ROUTING (TypeScript):
  src/services/localDreamGenerator.ts       ← Platform.select() picks native module
  src/services/backgroundDownloadService.ts ← Same module name, no routing needed
  src/services/coreMLModelBrowser.ts        ← iOS-only model discovery
  src/services/huggingFaceModelBrowser.ts   ← Android-only model discovery
  src/screens/ModelsScreen.tsx              ← Platform.OS for model tab

EVERYTHING ELSE:
  Platform-agnostic. Don't add Platform.OS checks.
```
