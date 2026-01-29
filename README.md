# LocalLLM

A privacy-focused, offline-first AI chat application for Android that runs large language models entirely on your device. No data ever leaves your phone.

## Features

- **100% Offline** - All AI processing happens on-device using llama.cpp
- **Privacy First** - No conversations, prompts, or personal data sent to any server
- **Custom Personas** - Create AI personalities with custom behaviors and system prompts
- **Hardware-Aware** - Automatic device capability detection and model recommendations
- **GGUF Model Support** - Download and run quantized models from Hugging Face

## How It Works

LocalLLM uses [llama.cpp](https://github.com/ggerganov/llama.cpp) compiled for Android to run GGUF-quantized language models directly on your device's CPU/GPU. The app intelligently detects your device's capabilities and recommends appropriate models.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                   React Native UI                    │
├─────────────────────────────────────────────────────┤
│              TypeScript Services Layer               │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │
│   │  LLM Service│ │Model Manager│ │Hardware Svc │  │
│   └─────────────┘ └─────────────┘ └─────────────┘  │
├─────────────────────────────────────────────────────┤
│              Native Module Bridge                    │
├─────────────────────────────────────────────────────┤
│         llama.cpp (C++ via JNI/Android NDK)         │
└─────────────────────────────────────────────────────┘
```

---

## Privacy & Security

**Your data stays on your device. Period.**

- All model inference runs locally using llama.cpp
- Conversations are stored only in local app storage
- No analytics, tracking, or telemetry
- No network requests except for model downloads from Hugging Face
- Models are downloaded once and cached locally

### Network Activity

The **only** network activity is:
1. Fetching the model catalog from Hugging Face API
2. Downloading model files (GGUF) from Hugging Face

After downloading a model, the app works **completely offline**. You can enable airplane mode and continue chatting indefinitely.

### Data Storage

All data is stored in the app's private directory:
- **Models**: `/data/data/com.localllm/files/models/`
- **Conversations**: Local app storage (Zustand persist)
- **Settings**: Local app storage

This data is:
- Not accessible to other apps
- Not backed up to cloud services
- Automatically deleted when you uninstall the app

---

## Device Compatibility

### Hardware Requirements

LocalLLM performs automatic hardware detection to ensure optimal performance:

| Device Tier | RAM     | Recommended Models          | Performance |
|-------------|---------|-----------------------------| ------------|
| **High**    | ≥8 GB   | 7B Q4_K_M, 7B Q5_K_M       | Excellent   |
| **Medium**  | 6-8 GB  | 3B Q4_K_M, 7B Q2_K         | Good        |
| **Low**     | 4-6 GB  | 1B-3B models, Q2_K/Q3_K    | Moderate    |
| **Minimal** | <4 GB   | TinyLlama, Phi-2 (Q2_K)    | Basic       |

### Automatic Compatibility Checks

Before downloading any model, the app verifies:

#### 1. RAM Check
```
Required RAM ≈ Model Size × 1.2
```
The app estimates memory requirements and warns if a model may be too large.

#### 2. Storage Check
Verifies sufficient free disk space for:
- Model file download
- Temporary extraction space
- Runtime memory mapping

#### 3. Architecture Check
Confirms ARM64 support (required for llama.cpp NEON optimizations).

#### 4. Thermal Monitoring
During inference, the app monitors device temperature to prevent:
- Thermal throttling (which slows generation)
- Device overheating
- Battery degradation

### Supported Devices

**Tested and working:**
- Google Pixel 6/7/8 series
- Samsung Galaxy S21/S22/S23/S24 series
- OnePlus 9/10/11/12 series
- Xiaomi 12/13/14 series
- Most devices with 6GB+ RAM and ARM64 processor

**Minimum requirements:**
- Android 7.0 (API 24) or later
- ARM64 processor
- 4GB RAM (for smallest models)
- 2GB free storage (varies by model)

---

## Quantization Guide

GGUF models come in different quantization levels. Understanding these helps you choose the right balance of quality and performance.

### What is Quantization?

Quantization reduces model precision from 16-bit floats to fewer bits, dramatically reducing file size and memory usage while maintaining most of the model's capabilities.

### Quantization Comparison

| Quantization | Bits | Quality    | Size (7B) | RAM Needed | Speed    | Recommended For     |
|--------------|------|------------|-----------|------------|----------|---------------------|
| **Q2_K**     | 2    | Lowest     | ~2.5 GB   | ~3.5 GB    | Fastest  | Very limited RAM    |
| **Q3_K_S**   | 3    | Low        | ~3.0 GB   | ~4.0 GB    | Fast     | Limited RAM         |
| **Q3_K_M**   | 3    | Low-Med    | ~3.3 GB   | ~4.5 GB    | Fast     | Budget devices      |
| **Q4_K_S**   | 4    | Medium     | ~3.8 GB   | ~5.0 GB    | Moderate | Good balance        |
| **Q4_K_M**   | 4    | Good       | ~4.0 GB   | ~5.5 GB    | Moderate | **Most devices**    |
| **Q5_K_S**   | 5    | Very Good  | ~4.5 GB   | ~6.0 GB    | Slower   | Quality focus       |
| **Q5_K_M**   | 5    | Very Good  | ~5.0 GB   | ~6.5 GB    | Slower   | High-end devices    |
| **Q6_K**     | 6    | Excellent  | ~6.0 GB   | ~7.5 GB    | Slow     | Flagship devices    |
| **Q8_0**     | 8    | Near FP16  | ~7.5 GB   | ~9.0 GB    | Slowest  | Maximum quality     |

### Choosing the Right Quantization

**For most users:** Start with **Q4_K_M**
- Best balance of quality, size, and speed
- Works well on devices with 6-8GB RAM
- Minimal quality loss compared to full precision

**For limited RAM (4-6GB):** Use **Q3_K_M** or **Q4_K_S**
- Noticeable quality reduction but still usable
- Much faster inference
- Allows running larger model architectures

**For flagship devices (8GB+):** Consider **Q5_K_M** or **Q6_K**
- Near-original quality
- Slower but more coherent responses
- Better for complex reasoning tasks

---

## Personas

Personas allow you to customize the AI's behavior and personality for different use cases.

### What is a Persona?

A persona defines how the AI behaves through:

| Component | Description |
|-----------|-------------|
| **Name** | Identifier (e.g., "Code Mentor") |
| **Icon** | Visual emoji representation |
| **System Prompt** | Detailed behavioral instructions |
| **Description** | Your reference note |

### Built-in Personas

| Persona | Icon | Use Case |
|---------|------|----------|
| **Default** | Default | General-purpose helpful assistant |
| **Coder** | Coding-focused | Programming help, debugging, code review |
| **Creative Writer** | Writing-focused | Stories, poetry, creative content |
| **Tutor** | Teaching-focused | Patient explanations, learning assistance |

### Creating Custom Personas

1. Navigate to **Settings** → **Personas** → **Manage**
2. Tap **Create New Persona**
3. Configure your persona:

```
Name: Code Reviewer
Icon: (select emoji)
Description: Reviews code for bugs and best practices

System Prompt:
You are an experienced senior developer conducting code reviews.
Your role is to help improve code quality through constructive feedback.

When reviewing code:
- Identify bugs, security issues, and performance problems
- Suggest specific improvements with code examples
- Explain the reasoning behind each suggestion
- Acknowledge good practices you observe

Format reviews as:
## Critical Issues
[List any bugs or security problems]

## Suggestions
[Improvements for readability, performance, etc.]

## Positive Aspects
[What's done well]

Maintain a helpful, educational tone. Never be harsh or dismissive.
```

### Writing Effective System Prompts

**Structure your prompts with:**

1. **Role Definition** - Who is the AI?
2. **Core Behaviors** - What should it always do?
3. **Response Format** - How should it structure answers?
4. **Restrictions** - What should it avoid?

**Example template:**
```
You are [specific role with expertise level].

Your purpose is to [main goal/function].

Key behaviors:
- [Behavior 1: Be specific]
- [Behavior 2: Include examples]
- [Behavior 3: Define boundaries]

When responding:
- [Format guideline]
- [Tone guideline]
- [Length guideline]

You should NOT:
- [Explicit restriction 1]
- [Explicit restriction 2]
```

### Persona Examples

**Language Learning Partner**
```
You are a friendly language tutor helping someone learn Spanish.

Approach:
- Use simple vocabulary matching the learner's level
- Include translations in parentheses: "Hola (Hello)"
- Correct mistakes gently with explanations
- Add cultural context when relevant

Format:
- Keep responses conversational
- End with a practice question or prompt
- Use encouraging language

Adapt difficulty based on the conversation flow.
```

**Technical Documentation Writer**
```
You are a technical writer creating clear documentation.

Style guidelines:
- Use active voice and present tense
- Keep sentences under 25 words
- Define acronyms on first use
- Include code examples for technical concepts

Structure:
- Start with a brief overview
- Use numbered steps for procedures
- Add notes/warnings in callout format
- End with next steps or related topics

Target audience: Developers with intermediate experience.
```

**Brainstorming Partner**
```
You are a creative brainstorming partner.

Your role:
- Generate diverse ideas without judgment
- Build on suggestions collaboratively
- Ask probing questions to explore deeper
- Combine unexpected concepts

Approach:
- Quantity over quality initially
- No idea is too wild to mention
- Use "Yes, and..." thinking
- Organize ideas into themes when asked

Avoid: Criticizing ideas or being overly practical too early.
```

### Using Personas in Chat

1. Open the **Chat** tab
2. Look at the header - you'll see the current persona displayed
3. Tap the persona selector (shows icon + name + dropdown arrow)
4. Choose your desired persona from the list
5. Continue chatting - all new messages use the selected persona

**Important notes:**
- Changing personas affects all future messages in that conversation
- Previous messages in the conversation remain unchanged
- Each conversation remembers its assigned persona
- You can create new chats with different personas for different topics

---

## Model Management

### Downloading Models

1. Go to the **Models** tab
2. Browse recommendations or search Hugging Face
3. Select a model to see available quantizations
4. Review the compatibility check results
5. Tap download and wait for completion

### Trusted Model Sources

The app highlights models from verified sources:

| Source | Badge | Description |
|--------|-------|-------------|
| **LM Studio** | LM Studio badge | Community-verified quantizations |
| **Official** | Official badge | From the original model creator |
| **TheBloke** | Verified badge | Well-known GGUF converter |

**Why this matters:** Quantization quality varies. Trusted sources ensure proper conversion without corruption or quality loss.

### Model Information

Each model card shows:
- **Parameter count** (1B, 3B, 7B, etc.)
- **Quantization options** with file sizes
- **Download count** (popularity indicator)
- **Compatibility status** for your device
- **Source credibility** badge

### Switching Models

1. Download multiple models
2. Go to **Home** or **Chat** screen
3. Tap the model selector
4. Choose your preferred model
5. Wait for model to load (few seconds)

### Deleting Models

1. Go to **Models** tab
2. Find the downloaded model
3. Tap the delete/trash icon
4. Confirm deletion

This frees up storage immediately.

---

## Settings

### Model Parameters

Fine-tune AI responses in **Settings** → **Model Settings**:

| Parameter | Range | Default | Effect |
|-----------|-------|---------|--------|
| **Temperature** | 0.0 - 2.0 | 0.7 | Creativity/randomness. Lower = focused, higher = creative |
| **Max Tokens** | 64 - 4096 | 512 | Maximum response length |
| **Top P** | 0.1 - 1.0 | 0.9 | Nucleus sampling. Lower = more focused vocabulary |
| **Repeat Penalty** | 1.0 - 2.0 | 1.1 | Discourages repetitive text. Higher = less repetition |
| **Context Length** | 512 - 8192 | 2048 | Conversation memory size |

### Parameter Recommendations

**For creative writing:**
- Temperature: 0.9 - 1.2
- Top P: 0.95
- Repeat Penalty: 1.15

**For coding assistance:**
- Temperature: 0.3 - 0.5
- Top P: 0.85
- Repeat Penalty: 1.05

**For factual Q&A:**
- Temperature: 0.1 - 0.3
- Top P: 0.8
- Repeat Penalty: 1.0

### Data Management

- **Clear All Conversations** - Delete chat history (keeps models)
- **Reset App** - Complete reset including models (requires re-download)

---

## Troubleshooting

### Model Won't Load

**Symptoms:** Loading spinner indefinitely, crash on model select

**Solutions:**
1. Check RAM in Settings → Device Information
2. Try a smaller quantization (Q3_K instead of Q4_K)
3. Close other apps to free memory
4. Restart the app completely
5. Restart your device if issue persists

### Slow Response Generation

**Symptoms:** Long pauses between tokens, sluggish typing

**Solutions:**
1. Use a smaller model (3B instead of 7B)
2. Choose more aggressive quantization (Q3_K_S)
3. Reduce context length in settings
4. Check if device is hot (thermal throttling)
5. Close background apps

### App Crashes During Chat

**Symptoms:** App force closes mid-conversation

**Causes & Solutions:**
1. **Out of memory** → Use smaller model/quantization
2. **Context overflow** → Reduce context length setting
3. **Corrupted model** → Delete and re-download the model
4. **Device overheating** → Let device cool down, reduce usage

### Download Failures

**Symptoms:** Download stuck, error messages, incomplete files

**Solutions:**
1. Check internet connection stability
2. Verify sufficient storage space (model size + 20% buffer)
3. Try downloading over WiFi instead of cellular
4. Wait and retry (Hugging Face servers may be busy)
5. Try a different quantization of the same model

### Model Produces Gibberish

**Symptoms:** Nonsensical output, repeated characters, broken responses

**Causes & Solutions:**
1. **Corrupted download** → Delete and re-download
2. **Wrong quantization for device** → Try Q4_K_M
3. **Temperature too high** → Lower to 0.7
4. **Context overflow** → Start a new conversation

---

## Building from Source

### Prerequisites

- Node.js 18+
- React Native CLI
- Android Studio (Arctic Fox or later)
- Android SDK 24+
- Android NDK (for native compilation)

### Development Setup

```bash
# Clone the repository
git clone <repository-url>
cd LocalLLM

# Install dependencies
npm install

# Start Metro bundler
npm start

# In another terminal, run on device
npm run android
```

### Building Standalone Debug APK

Create an APK that works without the Metro development server:

```bash
# 1. Create assets directory
mkdir -p android/app/src/main/assets

# 2. Bundle JavaScript
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output android/app/src/main/assets/index.android.bundle \
  --assets-dest android/app/src/main/res

# 3. Build the APK
cd android && ./gradlew assembleDebug

# 4. Find APK at:
# android/app/build/outputs/apk/debug/app-debug.apk

# 5. Install on device
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

### Project Structure

```
LocalLLM/
├── src/
│   ├── components/       # Reusable UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── ChatMessage.tsx
│   │   └── ChatInput.tsx
│   ├── screens/          # Screen components
│   │   ├── OnboardingScreen.tsx
│   │   ├── HomeScreen.tsx
│   │   ├── ChatScreen.tsx
│   │   ├── ModelsScreen.tsx
│   │   ├── SettingsScreen.tsx
│   │   └── PersonasScreen.tsx
│   ├── services/         # Business logic
│   │   ├── hardware.ts   # Device capability detection
│   │   ├── huggingface.ts # HF API integration
│   │   ├── modelManager.ts # Model download/storage
│   │   └── llm.ts        # LLM inference wrapper
│   ├── stores/           # Zustand state management
│   │   ├── appStore.ts   # App-wide state
│   │   ├── chatStore.ts  # Conversation state
│   │   └── personaStore.ts # Persona management
│   ├── navigation/       # React Navigation setup
│   ├── constants/        # Configuration constants
│   └── types/            # TypeScript type definitions
├── android/              # Android native code
└── ios/                  # iOS native code (if applicable)
```

---

## Technical Details

### Supported Model Architectures

Compatible with llama.cpp supported architectures:
- LLaMA / LLaMA 2 / LLaMA 3 / LLaMA 3.1
- Mistral / Mixtral
- Phi-2 / Phi-3 / Phi-3.5
- Qwen / Qwen 2 / Qwen 2.5
- Gemma / Gemma 2
- TinyLlama
- SmolLM / SmolLM2
- StableLM
- And other GGUF-compatible architectures

### Performance Optimizations

The app automatically optimizes based on your device:

- **Thread Count** - Matches physical CPU cores
- **Batch Size** - Scaled to available RAM
- **Context Size** - Capped based on memory constraints
- **Memory Mapping** - Efficient model loading without full RAM copy

### Memory Management

- Models use memory-mapped files (mmap)
- Automatic model unloading when switching
- Responds to system memory pressure warnings
- Graceful degradation under low memory conditions

---

## License

MIT License - See LICENSE file for details.

## Acknowledgments

- [llama.cpp](https://github.com/ggerganov/llama.cpp) - The inference engine
- [llama.rn](https://github.com/mybigday/llama.rn) - React Native bindings
- [Hugging Face](https://huggingface.co) - Model hosting and discovery
- [React Native](https://reactnative.dev) - Cross-platform framework
