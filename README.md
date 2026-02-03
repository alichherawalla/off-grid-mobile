# LocalLLM

**The truly offline-first LLM manager for mobile. Your AI, your device, your data.**

<p align="center">
  <img src="screenshots/Screenshot_2026-01-30-12-29-09-94_f28200242d1465b50ec18721116dc637.jpg" width="250" alt="Home Screen">
  <img src="screenshots/Screenshot_2026-01-30-12-29-44-44_f28200242d1465b50ec18721116dc637.jpg" width="250" alt="Chat Interface">
  <img src="screenshots/Screenshot_2026-01-30-12-31-04-59_f28200242d1465b50ec18721116dc637.jpg" width="250" alt="Browse Models">
</p>

LocalLLM is a React Native application that brings the power of large language models and image generation directly to your mobile device. Unlike cloud-based AI assistants that send every conversation to remote servers, LocalLLM runs **entirely on-device**—no internet required, no data leaves your phone, complete privacy guaranteed.

**Now with on-device image generation!** Create stunning AI-generated images from text prompts, completely offline.

---

## Why LocalLLM?

In a world where AI assistants harvest your conversations, LocalLLM takes a different approach:

| Cloud AI | LocalLLM |
|----------|----------|
| Requires internet | Works completely offline |
| Data sent to servers | Data never leaves device |
| Monthly subscriptions | One-time model download |
| Privacy policies change | You control everything |
| Service can shut down | Your AI is always available |

**This is AI the way it should be—truly yours.**

---

## Visual Tour

### Home Dashboard

The home screen gives you a complete overview at a glance: your currently active model, all downloaded models ready to use, and quick actions to start chatting or explore more models.

<p align="center">
  <img src="screenshots/Screenshot_2026-01-30-12-29-09-94_f28200242d1465b50ec18721116dc637.jpg" width="300" alt="Home Dashboard">
  <img src="screenshots/Screenshot_2026-01-30-12-29-34-82_f28200242d1465b50ec18721116dc637.jpg" width="300" alt="Home with Active Model">
</p>

### Intelligent Chat Interface

A full-featured chat experience with real-time streaming responses. Watch the AI think before it responds with the expandable thought process view—perfect for reasoning models like Qwen3.

<p align="center">
  <img src="screenshots/Screenshot_2026-01-30-12-29-44-44_f28200242d1465b50ec18721116dc637.jpg" width="300" alt="Chat with Thinking">
  <img src="screenshots/Screenshot_2026-01-30-12-30-49-82_f28200242d1465b50ec18721116dc637.jpg" width="300" alt="Chat Interface">
</p>

**Chat features include:**
- Real-time token streaming
- Expandable thought process view (for reasoning models)
- **Generation metadata** — see GPU backend, model name, decode tok/s, time-to-first-token (TTFT), and token count for every response
- Message actions: Copy, Edit, Resend
- Voice input with on-device Whisper transcription
- **Vision model support** with image attachments
- Debug panel for power users

### Vision Model Support

Send images to vision-capable models like LLaVA and SmolVLM. When you download a vision model, LocalLLM automatically detects and downloads the required multimodal projector (mmproj) file.

**Vision features:**
- Automatic mmproj file detection and download
- Camera and photo library support
- Image preview before sending
- Works completely offline after download

---

## 🎨 On-Device Image Generation

LocalLLM now includes **on-device AI image generation** powered by ONNX Runtime. Generate stunning images from text prompts—completely offline, completely private.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    Image Generation Pipeline                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   "A sunny day at the beach"                                     │
│            │                                                      │
│            ▼                                                      │
│   ┌─────────────────┐                                            │
│   │  CLIP Tokenizer │  Text → Token IDs                          │
│   └────────┬────────┘                                            │
│            │                                                      │
│            ▼                                                      │
│   ┌─────────────────┐                                            │
│   │  Text Encoder   │  Token IDs → Text Embeddings (768-dim)     │
│   └────────┬────────┘                                            │
│            │                                                      │
│            ▼                                                      │
│   ┌─────────────────┐     ┌─────────────────┐                    │
│   │     Scheduler   │ ──▶ │      UNet       │  Iterative         │
│   │  (Euler/LCM)    │ ◀── │  (Denoising)    │  Denoising         │
│   └─────────────────┘     └────────┬────────┘                    │
│                                    │                              │
│                                    ▼                              │
│                           ┌─────────────────┐                    │
│                           │   VAE Decoder   │  Latents → Image   │
│                           └────────┬────────┘                    │
│                                    │                              │
│                                    ▼                              │
│                           ┌─────────────────┐                    │
│                           │  512×512 Image  │                    │
│                           └─────────────────┘                    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Supported Image Models

| Model | Size | Style | Steps | Generation Time* |
|-------|------|-------|-------|------------------|
| **Absolute Reality** | ~1 GB | Photorealistic | 10-20 | ~2-4 min |
| **LCM DreamShaper v7** | ~2.2 GB | Creative/Artistic | 4-8 | ~1-2 min |

*Times measured on Snapdragon 8 Gen 3 (CPU inference)

### Standard vs LCM Models

LocalLLM supports both **Standard Diffusion** and **LCM (Latent Consistency Models)**:

| Feature | Standard SD | LCM |
|---------|-------------|-----|
| Steps Required | 10-50 | 4-8 |
| Quality | Excellent | Good-Very Good |
| Speed | Slower | Faster |
| Best For | Final outputs | Quick iterations |
| Guidance Scale | 7-12 | 1-2 |

**LCM Advantage:** Generate images in just 4-8 steps instead of 20-50, with minimal quality loss. Perfect for quick previews and iterations.

### Image Generation Features

- **Real-time Preview**: See your image emerge during generation (every 2 steps)
- **Automatic Intent Detection**: AI classifies if your message wants an image or text response
- **Manual Override**: Force image generation with the toggle button
- **Fullscreen Viewer**: Tap any generated image to view in fullscreen
- **Save to Gallery**: Save generated images to your Pictures folder
- **Generation Timing**: See how long each image took to generate
- **Customizable Settings**:
  - Steps (4-50)
  - Guidance Scale (1-20)
  - Random or fixed seed

### Using Image Generation

1. **Download an Image Model**
   - Go to Models tab → Image Models section
   - Download "Absolute Reality" (photorealistic) or "LCM DreamShaper" (fast creative)

2. **Set as Active**
   - Tap "Set Active" on your downloaded model
   - The model loads automatically (or on next chat)

3. **Generate Images**
   - Type a descriptive prompt: "A majestic mountain at sunset with golden light"
   - **Auto Mode**: AI detects image requests automatically
   - **Force Mode**: Tap the image icon to force image generation
   - Wait for the magic ✨

4. **Save Your Creation**
   - Tap the generated image to view fullscreen
   - Tap "Save" to save to Pictures/LocalLLM

### Image Generation Settings

| Setting | Range | Default | Description |
|---------|-------|---------|-------------|
| **Steps** | 4-50 | 10 | More steps = higher quality, slower |
| **Guidance Scale** | 1-20 | 7.5 | Higher = closer to prompt, less creative |
| **Seed** | Any | Random | Same seed = reproducible results |

**Pro Tips:**
- For LCM models, use 4-8 steps and guidance scale 1-2
- For Standard SD, use 15-25 steps and guidance scale 7-12
- Lower guidance for abstract art, higher for specific subjects
- Use detailed prompts: include style, lighting, composition

### Technical Details

**ONNX Runtime Inference:**
- Pure CPU inference (no GPU required)
- Multi-threaded processing (8 threads default)
- Memory-optimized model loading
- Support for both `.ort` and `.onnx` model formats

**Model Architecture:**
- CLIP text encoder for prompt understanding
- UNet for iterative denoising (the heavy lifting)
- VAE decoder for final image generation
- Euler scheduler for standard models
- LCM-specific guidance embedding for LCM models

**Memory Usage:**
- ~1.5-3 GB during generation
- Models unloaded after generation if needed
- Background loading on app startup

### Privacy Note

Just like text generation, **all image generation happens 100% on-device**:
- No images sent to any server
- No prompts logged or transmitted
- Generated images stay in local storage
- Enable airplane mode and create freely

---

### Switch Models Instantly

Tap the model name in the header to switch between downloaded models without leaving your conversation. Load, unload, or switch with a single tap.

<p align="center">
  <img src="screenshots/Screenshot_2026-01-30-12-29-49-11_f28200242d1465b50ec18721116dc637.jpg" width="300" alt="Model Selector">
</p>

### Fine-Tune Every Parameter

Full control over inference parameters, just like LM Studio on desktop. Adjust temperature, tokens, sampling, and performance settings to get exactly the responses you want.

<p align="center">
  <img src="screenshots/Screenshot_2026-01-30-12-29-52-89_f28200242d1465b50ec18721116dc637.jpg" width="300" alt="Generation Settings">
</p>

| Setting | Range | Description |
|---------|-------|-------------|
| Temperature | 0 - 2 | Controls creativity/randomness |
| Max Tokens | 64 - 4096 | Response length limit |
| Top P | 0.1 - 1.0 | Nucleus sampling threshold |
| Repeat Penalty | 1.0 - 2.0 | Reduces repetition |
| Context Length | 512 - 8192 | Conversation memory window |
| CPU Threads | 1 - 12 | Performance tuning |
| Batch Size | 32 - 512 | Processing chunk size |
| GPU Layers | 0 - 99 | Layers offloaded to GPU (0 = CPU only) |
| Enable GPU | On/Off | Toggle GPU acceleration |

### Projects

Create custom AI contexts with unique system prompts. Perfect for different use cases—code review, creative writing, language learning, or anything you imagine.

<p align="center">
  <img src="screenshots/Screenshot_2026-01-30-12-30-08-22_f28200242d1465b50ec18721116dc637.jpg" width="250" alt="Projects List">
  <img src="screenshots/Screenshot_2026-01-30-12-30-16-06_f28200242d1465b50ec18721116dc637.jpg" width="250" alt="Project Edit">
  <img src="screenshots/Screenshot_2026-01-30-12-30-18-77_f28200242d1465b50ec18721116dc637.jpg" width="250" alt="Project Detail">
</p>

Each project has its own:
- Color-coded identity
- Custom system prompt
- Dedicated conversation history
- Quick-switch from chat header

<p align="center">
  <img src="screenshots/Screenshot_2026-01-30-12-29-59-91_f28200242d1465b50ec18721116dc637.jpg" width="300" alt="Project Selector in Chat">
  <img src="screenshots/Screenshot_2026-01-30-12-30-57-70_f28200242d1465b50ec18721116dc637.jpg" width="300" alt="Project Conversations">
</p>

### Conversation Management

All your chats organized with project badges, timestamps, and previews. Quickly find any conversation or start fresh.

<p align="center">
  <img src="screenshots/Screenshot_2026-01-30-12-30-54-66_f28200242d1465b50ec18721116dc637.jpg" width="300" alt="Chats List">
</p>

### Browse & Download Models

Search Hugging Face's vast model library directly from the app. Filter by type (Text, Vision, Code) and source (LM Studio, Official, Verified, Community). Compatibility is checked automatically before download.

<p align="center">
  <img src="screenshots/Screenshot_2026-01-30-12-31-04-59_f28200242d1465b50ec18721116dc637.jpg" width="300" alt="Browse Models">
</p>

### On-Device Voice Transcription

Speak instead of type with Whisper-powered voice input. Like the LLM itself, transcription runs **entirely on-device**—your voice never leaves your phone.

<p align="center">
  <img src="screenshots/Screenshot_2026-01-30-12-31-12-02_f28200242d1465b50ec18721116dc637.jpg" width="300" alt="Voice Transcription Settings">
</p>

**Voice features:**
- Hold to record, release to transcribe
- Slide left to cancel
- Real-time partial transcription
- Multiple Whisper model sizes

### Debug & Developer Tools

For power users, a comprehensive debug panel shows exactly what's happening: context statistics, message counts, the active project's system prompt, and the exact ChatML-formatted prompt sent to the model.

<p align="center">
  <img src="screenshots/Screenshot_2026-01-30-12-30-02-40_f28200242d1465b50ec18721116dc637.jpg" width="250" alt="Debug Panel">
  <img src="screenshots/Screenshot_2026-01-30-12-30-37-63_f28200242d1465b50ec18721116dc637.jpg" width="250" alt="Debug Info Full">
  <img src="screenshots/Screenshot_2026-01-30-12-30-40-03_f28200242d1465b50ec18721116dc637.jpg" width="250" alt="Debug ChatML">
</p>

### Security & Settings

Optional passphrase lock protects your conversations. Device information helps you understand what hardware is running your AI.

<p align="center">
  <img src="screenshots/Screenshot_2026-01-30-12-31-07-25_f28200242d1465b50ec18721116dc637.jpg" width="300" alt="Settings">
</p>

---

## Quick Start

### Option 1: Install Pre-built APK

1. Download the APK: **[LocalLLM-v1.0.0.apk](releases/LocalLLM-v1.0.0.apk)** (~166 MB)
2. Transfer to your Android device
3. Enable "Install from Unknown Sources" in Settings
4. Install and launch LocalLLM
5. Download a model and start chatting!

### Option 2: Build from Source

```bash
# Clone the repository
git clone https://github.com/alichherawalla/offline-mobile-llm-manager.git
cd LocalLLM

# Install dependencies
npm install

# Run on connected Android device
npm run android
```

---

## How It Works

LocalLLM uses [llama.cpp](https://github.com/ggerganov/llama.cpp) compiled for Android to run GGUF-quantized language models directly on your device's CPU and GPU. The app intelligently detects your device's capabilities and recommends appropriate models.

### GPU Acceleration

LocalLLM supports GPU offloading for text model inference via the OpenCL backend on Qualcomm Adreno GPUs. Configure the number of GPU layers in Settings > Model Settings — each layer offloaded to the GPU reduces CPU load. If GPU initialization fails, the app automatically falls back to CPU-only inference.

The active backend (OpenCL or CPU) is displayed alongside every generated response, together with decode speed and time-to-first-token.

> **Note:** GPU support via OpenCL is experimental. On some Qualcomm devices the OpenCL compute driver can be unstable for LLM workloads. If you experience crashes, reduce GPU layers or disable GPU entirely — the CPU inference path with ARM NEON/i8mm/dotprod SIMD optimizations delivers strong performance on modern Snapdragon chips.

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       React Native UI                             │
├──────────────────────────────────────────────────────────────────┤
│                  TypeScript Services Layer                        │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│   │  LLM Service│ │Whisper Svc  │ │Hardware Svc │ │ONNX Image │ │
│   └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
├──────────────────────────────────────────────────────────────────┤
│                    Native Module Bridge                           │
├──────────────────────────────────────────────────────────────────┤
│   llama.rn      whisper.rn      ONNX Runtime    Android DL Mgr   │
│   (C++ JNI)     (C++ JNI)       (Kotlin)        (Kotlin)         │
├──────────────────────────────────────────────────────────────────┤
│             GPU: OpenCL (Qualcomm Adreno)                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Privacy & Security

**Your data stays on your device. Period.**

- All model inference runs locally using llama.cpp
- All voice transcription runs locally using whisper.cpp
- Conversations are stored only in local app storage
- No analytics, tracking, or telemetry
- No network requests except for model downloads
- Optional passphrase lock for sensitive conversations

### Network Activity

The **only** network activity is:
1. Fetching model metadata from Hugging Face
2. Downloading model files (GGUF)

After downloading models, the app works **completely offline**. Enable airplane mode and chat indefinitely.

---

## Device Compatibility

### Hardware Requirements

| Device Tier | RAM | Recommended Models | Performance |
|-------------|-----|-------------------|-------------|
| **Flagship** | ≥8 GB | 7B Q4_K_M, 7B Q5_K_M | Excellent |
| **High** | 6-8 GB | 3B Q4_K_M, 7B Q2_K | Good |
| **Medium** | 4-6 GB | 1B-3B models, Q3_K | Moderate |
| **Entry** | <4 GB | TinyLlama, SmolLM | Basic |

### Tested Devices

- Google Pixel 6/7/8 series
- Samsung Galaxy S21/S22/S23/S24 series
- OnePlus 9/10/11/12 series
- Xiaomi 12/13/14 series
- Most devices with 6GB+ RAM and ARM64 processor

### Minimum Requirements

- Android 7.0 (API 24) or later
- ARM64 processor
- 4GB RAM (for smallest models)
- 2GB free storage (varies by model)

---

## Quantization Guide

GGUF models come in different quantization levels. Choose the right balance of quality and performance for your device.

| Quantization | Quality | Size (7B) | RAM Needed | Best For |
|--------------|---------|-----------|------------|----------|
| **Q2_K** | Lowest | ~2.5 GB | ~3.5 GB | Very limited RAM |
| **Q3_K_M** | Low-Med | ~3.3 GB | ~4.5 GB | Budget devices |
| **Q4_K_M** | Good | ~4.0 GB | ~5.5 GB | **Most devices** |
| **Q5_K_M** | Very Good | ~5.0 GB | ~6.5 GB | Quality focus |
| **Q6_K** | Excellent | ~6.0 GB | ~7.5 GB | Flagship devices |
| **Q8_0** | Near FP16 | ~7.5 GB | ~9.0 GB | Maximum quality |

**Recommendation:** Start with **Q4_K_M** for the best balance of quality and performance.

---

## Supported Models

LocalLLM supports any GGUF-format model compatible with llama.cpp:

### Text Models
- **Qwen3** - Excellent multilingual reasoning
- **Llama 3.2** - Meta's latest open models
- **Phi-3** - Microsoft's efficient small models
- **Gemma 2** - Google's open models
- **Mistral** - High-quality European models
- **SmolLM** - Hugging Face's tiny but capable models

### Vision Models
- **SmolVLM** - Compact vision-language model (recommended)
- **LLaVA** - Large Language and Vision Assistant
- **Qwen2-VL** - Qwen's vision-language models
- **MiniCPM-V** - Efficient multimodal models

Vision models automatically download the required mmproj companion file for image understanding.

And thousands more on Hugging Face...

---

## Project Structure

```
LocalLLM/
├── src/
│   ├── components/      # Reusable UI components
│   ├── constants/       # App-wide constants and theme
│   ├── hooks/           # Custom React hooks
│   ├── navigation/      # React Navigation setup
│   ├── screens/         # Main app screens
│   ├── services/        # LLM, Whisper, hardware services
│   ├── stores/          # Zustand state management
│   └── types/           # TypeScript definitions
├── android/             # Android native code
└── screenshots/         # App screenshots
```

---

## Building for Production

### Debug APK

```bash
cd android && ./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

### Release APK

```bash
cd android && ./gradlew assembleRelease
# Output: android/app/build/outputs/apk/release/app-release.apk
```

See the [full build guide](#building-from-source) below for signing configuration.

---

## Technical Stack

- **React Native** with TypeScript
- **llama.rn** - Native GGUF model inference via llama.cpp with optional OpenCL GPU offloading
- **whisper.rn** - On-device speech recognition via whisper.cpp
- **ONNX Runtime** - Stable Diffusion image generation
- **Android DownloadManager** - Native background model downloads that survive app backgrounding
- **Zustand** - State management with AsyncStorage persistence
- **React Navigation** - Native navigation with nested stacks

---

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - See LICENSE file for details.

## Acknowledgments

- [llama.cpp](https://github.com/ggerganov/llama.cpp) - The LLM inference engine
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) - Speech recognition engine
- [ONNX Runtime](https://onnxruntime.ai/) - Cross-platform ML inference for image generation
- [llama.rn](https://github.com/mybigday/llama.rn) - React Native LLM bindings
- [whisper.rn](https://github.com/mybigday/whisper.rn) - React Native Whisper bindings
- [Hugging Face](https://huggingface.co) - Model hosting and discovery
- [ShiftHackZ](https://github.com/ShiftHackZ) - ONNX-optimized Stable Diffusion models

---

<p align="center">
  <strong>LocalLLM</strong> — Because your AI should be truly yours.
  <br>
  <em>Built with privacy in mind, powered by open-source AI.</em>
</p>
