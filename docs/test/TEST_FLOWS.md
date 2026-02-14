# OffgridMobile Test Flows - Comprehensive Inventory

This document catalogs every testable flow in the application.

**Coverage Legend:**
- ✅ = Fully tested (Unit + Integration/RNTL + E2E)
- ⚠️ = Partially tested (missing some layers)
- 📝 = Planned but not implemented
- ❌ = No test coverage

**Current Overall Coverage: ~90% of P0 flows, ~65% of all flows**

See `TEST_PRIORITY_MAP.md` for detailed test status and `TEST_SPEC_FORMAT.md` for how to write tests.

---

## 1. Onboarding & First Launch

| # | Flow | Description |
|---|------|-------------|
| 1.1 | Fresh install onboarding | App opens → welcome screens → permissions → complete |
| 1.2 | Onboarding with model download | Onboarding → recommended model → download → ready to chat |
| 1.3 | Skip onboarding download | Skip model download → home with no model |
| 1.4 | Onboarding persistence | Partially complete → kill app → resumes where left off |
| 1.5 | Onboarding completed flag | Completed once → never shown again |

---

## 2. Authentication & Security

| # | Flow | Description |
|---|------|-------------|
| 2.1 | First-time passphrase setup | Settings → Security → set passphrase → enabled |
| 2.2 | Passphrase confirmation match | Enter passphrase twice → must match |
| 2.3 | Passphrase confirmation mismatch | Entries differ → error shown |
| 2.4 | Passphrase strength indicator | Weak/medium/strong feedback |
| 2.5 | App lock on background | App backgrounded → returns → lock screen |
| 2.6 | Successful unlock | Correct passphrase → app unlocks |
| 2.7 | Failed unlock attempt | Wrong passphrase → error + attempt counted |
| 2.8 | Multiple failed attempts | Track count across attempts |
| 2.9 | Lockout triggered | 5 failures → 5 minute lockout |
| 2.10 | Lockout countdown | Shows remaining time |
| 2.11 | Lockout expiry | Timer ends → can try again |
| 2.12 | Lockout persists across app restart | Locked → kill app → still locked |
| 2.13 | Change passphrase | Requires old passphrase → set new |
| 2.14 | Disable passphrase | Requires passphrase → then disabled |
| 2.15 | Auth state persistence | Enabled state survives app restart |

---

## 3. Permissions

| # | Flow | Description |
|---|------|-------------|
| 3.1 | Microphone permission request | First voice input → permission prompt |
| 3.2 | Microphone permission granted | Permission given → recording works |
| 3.3 | Microphone permission denied | Denied → graceful error message |
| 3.4 | Camera permission request | First image attachment → permission prompt |
| 3.5 | Camera permission granted | Permission given → camera works |
| 3.6 | Camera permission denied | Denied → graceful error, can still use gallery |
| 3.7 | Storage permission (Android) | Required for downloads on older Android |
| 3.8 | Permission settings redirect | "Go to settings" → opens app settings |

---

## 4. Home Screen

| # | Flow | Description |
|---|------|-------------|
| 4.1 | Home with no model | Shows "download a model" prompt |
| 4.2 | Home with model not loaded | Shows model name + "tap to load" |
| 4.3 | Home with model loaded | Shows model name + memory usage |
| 4.4 | Model loading from home | Tap model → loading indicator → loaded |
| 4.5 | Quick model selector | Open selector → pick model → loads |
| 4.6 | Memory usage display | Shows RAM used / available |
| 4.7 | Recent conversations | Shows last N chats |
| 4.8 | New conversation from home | "New Chat" → creates + navigates |
| 4.9 | Tap recent conversation | Navigates to that chat |
| 4.10 | Device info on home | Shows device model + capabilities |
| 4.11 | Home refresh | Pull to refresh → updates model list |

---

## 5. Text Model Management

### Browsing & Discovery
| # | Flow | Description |
|---|------|-------------|
| 5.1 | Models tab loads | Shows list of available models from HuggingFace |
| 5.2 | Model list loading state | Spinner while fetching |
| 5.3 | Model list error state | API error → retry button |
| 5.4 | Search models by name | Type query → list filters |
| 5.5 | Search clears | Clear search → full list |
| 5.6 | Filter by credibility - LM Studio | Toggle → only LM Studio models |
| 5.7 | Filter by credibility - Official | Toggle → only official models |
| 5.8 | Filter by credibility - Verified | Toggle → only verified quantizers |
| 5.9 | Filter by model type - Vision | Toggle → only vision-capable models |
| 5.10 | Multiple filters combined | LM Studio + Vision → intersection |
| 5.11 | Clear all filters | Reset → full list |
| 5.12 | Empty filter results | No matches → "no models found" |
| 5.13 | Pull to refresh | Refresh model list from API |
| 5.14 | Pagination / infinite scroll | Load more models on scroll |

### Model Details
| # | Flow | Description |
|---|------|-------------|
| 5.15 | View model card | Tap model → expanded details |
| 5.16 | View available files | List of quantization options |
| 5.17 | File size display | Shows size in GB/MB |
| 5.18 | Quantization explanation | Info about Q4_K_M etc |
| 5.19 | Vision model indicator | Badge for vision-capable |
| 5.20 | Author display | Shows who uploaded |
| 5.21 | Credibility badge | LM Studio/Official/Verified badge |
| 5.22 | Model recommendations | "Recommended for your device" |

### Downloading
| # | Flow | Description |
|---|------|-------------|
| 5.23 | Start foreground download | Select file → download starts |
| 5.24 | Download progress display | Progress bar + percentage |
| 5.25 | Download speed display | MB/s indicator |
| 5.26 | Download ETA | Estimated time remaining |
| 5.27 | Download pause | Pause button → pauses |
| 5.28 | Download resume | Resume → continues from where left off |
| 5.29 | Download cancel | Cancel → partial file cleaned up |
| 5.30 | Download complete | Progress → 100% → model in list |
| 5.31 | Download while app backgrounded | Continues in background (foreground mode) |
| 5.32 | Multiple concurrent downloads | Download 2+ models at once |
| 5.33 | Download queue | Start multiple → queued |
| 5.34 | Insufficient storage | Not enough space → error before download |
| 5.35 | Download network error | Network drops → error + retry option |
| 5.36 | Download resumes after network | Network back → can resume |
| 5.37 | Vision model download | Downloads main + mmproj file |
| 5.38 | Vision model partial download | Main file done, mmproj fails → handles gracefully |
| 5.39 | Duplicate download prevention | Already downloaded → shows "downloaded" |
| 5.40 | Already downloading prevention | In progress → can't start again |

### Downloaded Models
| # | Flow | Description |
|---|------|-------------|
| 5.41 | View downloaded models | Tab/section shows downloaded |
| 5.42 | Downloaded model info | Size on disk, date downloaded |
| 5.43 | Delete downloaded model | Delete → removed from disk + list |
| 5.44 | Delete confirmation | Confirm dialog before delete |
| 5.45 | Delete active model | Warning that it will be unloaded |
| 5.46 | Model file corruption | Corrupted file detected → error + delete option |
| 5.47 | Scan for untracked models | Find models added externally |
| 5.48 | Model recovery | App killed → model files still exist → recovered |

---

## 6. Image Model Management

| # | Flow | Description |
|---|------|-------------|
| 6.1 | Image models tab | Switch to image models list |
| 6.2 | Browse available image models | List from HuggingFace repos |
| 6.3 | Image model details | Size, style, backend info |
| 6.4 | Download image model | Download → extract → ready |
| 6.5 | Image model extraction progress | Zip extraction progress |
| 6.6 | View downloaded image models | List downloaded SD models |
| 6.7 | Delete image model | Remove from disk |
| 6.8 | Backend indicator | MNN vs QNN vs Core ML badge |
| 6.9 | QNN compatibility | Shows if device supports QNN |
| 6.10 | Image model size warning | Large model → warning |
| 6.11 | Core ML model browsing (iOS) | Fetch available models from Apple repos |
| 6.12 | Core ML model caching | Cache model list with 5-min TTL |
| 6.13 | Core ML partial failure | Some repos fail → return partial results |

---

## 7. Background Downloads (Cross-Platform)

| # | Flow | Description |
|---|------|-------------|
| 7.1 | Start background download | Select → uses DownloadManager (Android) / URLSession (iOS) |
| 7.2 | Notification appears | System notification shows progress |
| 7.3 | Download manager screen | View all background downloads |
| 7.4 | Progress in download manager | Percentage + bytes downloaded |
| 7.5 | Pause background download | Pause → paused state in notification |
| 7.6 | Resume background download | Resume → continues |
| 7.7 | Cancel background download | Cancel → removed |
| 7.8 | Download completes | Notification → complete |
| 7.9 | App killed during download | Download continues via system |
| 7.10 | App reopens - download complete | Detects completion → moves file → adds to list |
| 7.11 | App reopens - download in progress | Shows current progress |
| 7.12 | App reopens - download failed | Shows failed state |
| 7.13 | Clear completed downloads | Remove from list |
| 7.14 | Multiple background downloads | Several simultaneous |
| 7.15 | iOS download parity | Same DownloadManagerModule interface via URLSession |
| 7.16 | iOS polling compatibility | startProgressPolling/stopProgressPolling are no-ops on iOS |
| 7.17 | iOS completed download localUri | Completed download includes localUri (moved from temp) |

---

## 8. Model Loading & Memory

| # | Flow | Description |
|---|------|-------------|
| 8.1 | Load text model | Select model → loading → loaded |
| 8.2 | Loading progress indicator | Shows loading state |
| 8.3 | Loading time display | Shows how long loading took |
| 8.4 | Model loaded confirmation | Success message/indicator |
| 8.5 | Load failure - corrupt file | Error message + suggestion |
| 8.6 | Load failure - insufficient memory | OOM error → suggestion to try smaller |
| 8.7 | Load failure - unknown error | Generic error + retry |
| 8.8 | Unload model | Unload → memory freed |
| 8.9 | Unload confirmation | Confirm before unloading |
| 8.10 | Memory freed display | Shows reclaimed memory |
| 8.11 | Switch text models | A loaded → select B → A unloads → B loads |
| 8.12 | Switch with active generation | Warn that generation will stop |
| 8.13 | Load image model | Select → loading → ready |
| 8.14 | Image model loading progress | Shows loading state |
| 8.15 | Switch image models | Swap image models |
| 8.16 | Memory warning threshold | Low memory → warning before load |
| 8.17 | Memory critical | Very low → refuse to load |
| 8.18 | Performance mode | Model stays loaded between generations |
| 8.19 | Memory mode | Model unloads after generation |
| 8.20 | GPU layer loading | Load N layers to GPU |
| 8.21 | GPU loading failure | GPU unavailable → falls back to CPU |
| 8.22 | Model session caching | Same system prompt → cached session |

---

## 9. Text Generation

### Basic Generation
| # | Flow | Description | Status |
|---|------|-------------|--------|
| 9.1 | Send text message | Type → send → message appears | ✅ E2E: 02-text-generation.yaml |
| 9.2 | Message appears in chat | User message shown immediately | ✅ |
| 9.3 | Generation starts | Loading/thinking indicator | ✅ |
| 9.4 | Streaming tokens | Tokens appear one by one | ✅ |
| 9.5 | Streaming performance | Smooth token display | ✅ E2E validates |
| 9.6 | Generation completes | Full response shown | ✅ |
| 9.7 | Response saved | Response persists after app restart | ✅ |
| 9.8 | Time to first token | TTFT displayed | ⚠️ RNTL only |
| 9.9 | Tokens per second | Generation speed shown | ⚠️ RNTL only |
| 9.10 | Total token count | Shows prompt + response tokens | ⚠️ RNTL only |

### Generation Controls
| # | Flow | Description | Status |
|---|------|-------------|--------|
| 9.11 | Stop generation | Stop button → generation halts | ✅ E2E: 03-stop-generation.yaml |
| 9.12 | Partial response saved | Stopped response is kept | ✅ |
| 9.13 | Retry generation | Retry → regenerates last response | ⚠️ Unit + RNTL only |
| 9.14 | Edit user message | Edit → changes saved | ⚠️ Unit + RNTL only |
| 9.15 | Regenerate from edit | Edit message → regenerates from that point | ⚠️ Unit only |
| 9.16 | Delete messages after | Delete from point → later messages removed | ⚠️ Unit + RNTL only |

### Generation Context
| # | Flow | Description |
|---|------|-------------|
| 9.17 | Conversation history | Previous messages in context |
| 9.18 | System prompt applied | Project system prompt used |
| 9.19 | Context length limit | Old messages dropped when limit hit |
| 9.20 | Context truncation | Smart truncation preserves recent |
| 9.21 | Long conversation | 50+ messages → still works |
| 9.22 | Empty conversation | First message has no history |

### Generation Settings Impact
| # | Flow | Description |
|---|------|-------------|
| 9.23 | Temperature low (0.1) | Deterministic output |
| 9.24 | Temperature high (1.5) | Random/creative output |
| 9.25 | Max tokens reached | Response stops at limit |
| 9.26 | Top-p affects output | Different sampling |
| 9.27 | Repeat penalty works | Reduces repetition |
| 9.28 | Thread count affects speed | More threads = faster |

### Generation Errors
| # | Flow | Description |
|---|------|-------------|
| 9.29 | Generation error | Error message shown |
| 9.30 | Model crashes mid-generation | Handles gracefully |
| 9.31 | OOM during generation | Error + suggestion |
| 9.32 | No model loaded | Prompt to load model |

### Special Output Handling
| # | Flow | Description |
|---|------|-------------|
| 9.33 | Thinking blocks | `<think>` tags parsed + displayed separately |
| 9.34 | Code blocks | Markdown code blocks rendered |
| 9.35 | Markdown rendering | Bold, italic, lists, etc. |
| 9.36 | Long response | Handles multi-paragraph responses |
| 9.37 | Unicode/emoji in response | Rendered correctly |

### Generation Metadata
| # | Flow | Description |
|---|------|-------------|
| 9.38 | Show generation details on | Details visible in message |
| 9.39 | Show generation details off | Details hidden |
| 9.40 | GPU indicator | Shows if GPU used |
| 9.41 | Model name in metadata | Which model generated |

---

## 10. Intent Classification

| # | Flow | Description |
|---|------|-------------|
| 10.1 | Clear text intent | "What is X?" → text |
| 10.2 | Clear image intent | "Draw a cat" → image |
| 10.3 | Question patterns → text | "How do I...", "Why is...", etc. |
| 10.4 | Generation patterns → image | "Generate", "create", "paint", etc. |
| 10.5 | Art style patterns → image | "Oil painting of", "anime style" |
| 10.6 | Code patterns → text | "Write a function", "debug this" |
| 10.7 | SD-specific → image | "Stable diffusion", "negative prompt" |
| 10.8 | Ambiguous prompt - pattern mode | Falls back to text |
| 10.9 | Ambiguous prompt - LLM mode | Uses model to classify |
| 10.10 | LLM classification loading | Shows "analyzing" state |
| 10.11 | Classifier model switch | Uses different model for classification |
| 10.12 | Classifier model swap back | Returns to main model after |
| 10.13 | Intent cache hit | Repeated prompt uses cache |
| 10.14 | Intent cache size limit | Cache eviction when full |
| 10.15 | Quick check for UI hints | Hint shown before sending |
| 10.16 | Pattern false positive | "Show me how to draw" → text not image |
| 10.17 | Pattern false negative | Edge case not caught → correct fallback |

---

## 11. Image Generation

### Basic Generation
| # | Flow | Description |
|---|------|-------------|
| 11.1 | Auto-detect triggers generation | "Draw X" → image generated |
| 11.2 | Manual mode generation | Force image → any prompt works |
| 11.3 | Image model loads | Model loads if not loaded |
| 11.4 | Generation progress | Step X/Y shown |
| 11.5 | Preview during generation | Partial image shown |
| 11.6 | Preview updates | Updates as steps complete |
| 11.7 | Generation completes | Final image shown |
| 11.8 | Image in chat | Image appears in conversation |
| 11.9 | Image in gallery | Image added to gallery |
| 11.10 | Image saved to disk | File persists |

### Generation Controls
| # | Flow | Description |
|---|------|-------------|
| 11.11 | Cancel image generation | Cancel → stops mid-generation |
| 11.12 | Partial image on cancel | Shows what was generated |
| 11.13 | Retry image generation | Retry → regenerates |
| 11.14 | Different seed | Retry produces different image |

### Generation Parameters
| # | Flow | Description |
|---|------|-------------|
| 11.15 | Negative prompt | Specify exclusions → applied |
| 11.16 | Custom steps (low) | 10 steps → fast but rough |
| 11.17 | Custom steps (high) | 30+ steps → slow but detailed |
| 11.18 | Guidance scale low | More creative interpretation |
| 11.19 | Guidance scale high | Strict prompt following |
| 11.20 | Custom resolution square | 512x512 |
| 11.21 | Custom resolution landscape | 768x512 |
| 11.22 | Custom resolution portrait | 512x768 |
| 11.23 | Resolution not divisible by 8 | Rejected or auto-adjusted |
| 11.24 | Thread count affects speed | More threads = faster |

### Backend Selection
| # | Flow | Description |
|---|------|-------------|
| 11.25 | MNN backend (Android) | CPU-based generation |
| 11.26 | QNN backend (Android) | NPU-accelerated generation |
| 11.27 | QNN not available | Falls back to MNN |
| 11.28 | Auto backend selection | Picks best for device |
| 11.29a | Core ML backend (iOS) | ANE-accelerated generation via ml-stable-diffusion |

### Generation Errors
| # | Flow | Description |
|---|------|-------------|
| 11.30 | Generation error | Error message shown |
| 11.31 | No image model loaded | Prompt to download/select |
| 11.32 | OOM during generation | Error + lower resolution suggestion |
| 11.33a | Platform routing | Platform.select routes to correct native module |

### Image Metadata
| # | Flow | Description |
|---|------|-------------|
| 11.33 | Metadata saved | Prompt, steps, seed, etc. stored |
| 11.34 | Metadata displayed | View generation settings |
| 11.35 | Model name in metadata | Which SD model used |

---

## 12. Vision Models (Image Understanding)

| # | Flow | Description |
|---|------|-------------|
| 12.1 | Load vision model | Model + mmproj both loaded |
| 12.2 | Attach image from gallery | Pick image → attached |
| 12.3 | Attach image from camera | Take photo → attached |
| 12.4 | Image attachment preview | Thumbnail shown in input |
| 12.5 | Remove attachment | X button → removed |
| 12.6 | Send with image | Message + image sent |
| 12.7 | Image in context | Model "sees" the image |
| 12.8 | Generate about image | "What's in this?" → description |
| 12.9 | Multiple images | Several images in conversation |
| 12.10 | Image without vision model | Warning that model can't see images |
| 12.11 | Large image handling | Resize/compress if needed |
| 12.12 | Image format support | JPG, PNG, etc. |

---

## 13. Document Attachments

| # | Flow | Description |
|---|------|-------------|
| 13.1 | Attach text document | Pick .txt → content extracted |
| 13.2 | Attach code file | Pick .py/.js → content extracted |
| 13.3 | Document preview | Shows filename + snippet |
| 13.4 | Document in context | Content included in prompt |
| 13.5 | Summarize document | "Summarize this" → summary |
| 13.6 | Large document | Truncated to fit context |
| 13.7 | Unsupported format | Error message |
| 13.8 | Multiple documents | Several files attached |
| 13.9 | Document + image | Both attached together |

---

## 14. Voice Input

| # | Flow | Description |
|---|------|-------------|
| 14.1 | Tap mic to start | Recording begins |
| 14.2 | Recording indicator | Visual feedback while recording |
| 14.3 | Recording duration | Shows time elapsed |
| 14.4 | Stop recording | Stop → transcription starts |
| 14.5 | Transcription progress | Loading indicator |
| 14.6 | Transcription complete | Text appears in input |
| 14.7 | Partial transcription | Live updates while speaking |
| 14.8 | Cancel recording | Cancel → discarded |
| 14.9 | Empty recording | Very short → ignored |
| 14.10 | Long recording | Handles extended speech |
| 14.11 | No Whisper model | Prompt to download |
| 14.12 | Whisper model loading | Load before first transcription |
| 14.13 | Transcription accuracy | Quality matches model size |
| 14.14 | Background noise | Handles noisy environment |
| 14.15 | Multiple languages | Works with selected language |

### Whisper Model Management
| # | Flow | Description |
|---|------|-------------|
| 14.16 | View Whisper models | List tiny/small/base/medium |
| 14.17 | Download Whisper model | Download → ready |
| 14.18 | Switch Whisper model | Change to different size |
| 14.19 | Delete Whisper model | Remove downloaded model |
| 14.20 | English-only model | Smaller, English only |
| 14.21 | Multilingual model | Larger, many languages |
| 14.22 | Model recommendation | Based on device RAM |

---

## 15. Conversations

### Conversation Lifecycle
| # | Flow | Description |
|---|------|-------------|
| 15.1 | Create new conversation | New button → empty chat |
| 15.2 | Conversation created timestamp | Created date stored |
| 15.3 | Auto-generate title | First message → title derived |
| 15.4 | Edit conversation title | Manual title change |
| 15.5 | Conversation updated timestamp | Updates on new message |
| 15.6 | Delete conversation | Delete → removed |
| 15.7 | Delete confirmation | Confirm dialog |
| 15.8 | Delete removes messages | All messages deleted |
| 15.9 | Delete removes images | Associated gallery images removed |

### Conversation Navigation
| # | Flow | Description |
|---|------|-------------|
| 15.10 | View conversations list | List of all chats |
| 15.11 | Conversations sorted by date | Most recent first |
| 15.12 | Conversation preview | Shows last message snippet |
| 15.13 | Switch conversations | Tap → switches to chat |
| 15.14 | Empty conversations list | "No conversations" state |
| 15.15 | Swipe to delete | Swipe action deletes |
| 15.16 | Search conversations | Search by title/content |

### Conversation Persistence
| # | Flow | Description |
|---|------|-------------|
| 15.17 | Conversations persist | Survives app restart |
| 15.18 | Messages persist | All messages saved |
| 15.19 | Conversation state restored | Active conversation remembered |
| 15.20 | Scroll position restored | Returns to same position |

### Conversation with Project
| # | Flow | Description |
|---|------|-------------|
| 15.21 | Start from project | Project → new chat → system prompt applied |
| 15.22 | Project linked | Conversation shows project |
| 15.23 | Project deleted | Conversations keep their system prompt |

---

## 16. Chat UI & Interactions

### Message Display
| # | Flow | Description |
|---|------|-------------|
| 16.1 | User message styling | Right-aligned, colored |
| 16.2 | Assistant message styling | Left-aligned, different color |
| 16.3 | System message styling | Distinct style |
| 16.4 | Message timestamp | Shows when sent |
| 16.5 | Message grouping | Adjacent same-role grouped |
| 16.6 | Streaming message style | Different while streaming |
| 16.7 | Long message display | Handles paragraphs correctly |
| 16.8 | Code syntax highlighting | Code blocks colored |
| 16.9 | Link detection | URLs tappable |
| 16.10 | Copy message | Long press → copy |
| 16.11 | Message actions menu | Edit, delete, retry options |

### Chat Input
| # | Flow | Description |
|---|------|-------------|
| 16.12 | Type message | Text input works |
| 16.13 | Multiline input | Enter creates new line |
| 16.14 | Send button enabled | Enabled when text present |
| 16.15 | Send button disabled | Disabled when empty |
| 16.16 | Send button disabled - no model | Disabled without model |
| 16.17 | Send button disabled - generating | Disabled during generation |
| 16.18 | Clear input after send | Input clears on send |
| 16.19 | Input character limit | Handles very long input |
| 16.20 | Paste long text | Paste works correctly |
| 16.21 | Unicode/emoji input | Handles special characters |
| 16.22 | Whitespace-only blocked | Can't send empty/spaces |
| 16.23 | Keyboard handling | Keyboard pushes up input |
| 16.24 | Input focus | Tap input → keyboard opens |

### Chat Scrolling
| # | Flow | Description |
|---|------|-------------|
| 16.25 | Auto-scroll new message | Scrolls to bottom on new message |
| 16.26 | Auto-scroll during stream | Follows streaming content |
| 16.27 | Manual scroll up | Can scroll to old messages |
| 16.28 | Manual scroll - no auto-scroll | Doesn't force to bottom |
| 16.29 | Scroll to bottom button | Tap → scrolls to bottom |
| 16.30 | Pull to refresh | Refresh conversation? |

### Chat States
| # | Flow | Description |
|---|------|-------------|
| 16.31 | Empty chat state | "Send a message to start" |
| 16.32 | Loading model state | Shows loading indicator |
| 16.33 | Generating state | Shows generating indicator |
| 16.34 | Error state | Shows error message |
| 16.35 | Offline state | Shows offline indicator |

### Attachments UI
| # | Flow | Description |
|---|------|-------------|
| 16.36 | Attachment button | Opens attachment options |
| 16.37 | Attachment options | Camera, gallery, document |
| 16.38 | Attachment preview | Shows thumbnail/name |
| 16.39 | Remove attachment | X removes it |
| 16.40 | Multiple attachments | Several shown |
| 16.41 | Image mode toggle | Switch to image generation mode |
| 16.42 | Image mode indicator | Shows when in image mode |

---

## 17. Projects (System Prompt Presets)

### Project Management
| # | Flow | Description |
|---|------|-------------|
| 17.1 | View projects list | List of all projects |
| 17.2 | Default projects | 4 default projects present |
| 17.3 | Create new project | New → form → save |
| 17.4 | Project name required | Can't save without name |
| 17.5 | Project description | Optional description |
| 17.6 | Project system prompt | Required system prompt |
| 17.7 | Project icon selection | Choose icon |
| 17.8 | Save project | Save → appears in list |
| 17.9 | Edit project | Edit existing → save changes |
| 17.10 | Delete project | Delete → removed |
| 17.11 | Delete confirmation | Confirm before delete |
| 17.12 | Duplicate project | Copy with new name |

### Project Usage
| # | Flow | Description |
|---|------|-------------|
| 17.13 | Start chat from project | Project → new chat → prompt applied |
| 17.14 | Project preview | See system prompt preview |
| 17.15 | Project linked conversations | View chats using this project |
| 17.16 | Projects persist | Survive app restart |

---

## 18. Gallery

### Gallery Display
| # | Flow | Description |
|---|------|-------------|
| 18.1 | View gallery | Grid of all generated images |
| 18.2 | Gallery loading | Loading indicator |
| 18.3 | Empty gallery | "No images" state |
| 18.4 | Image thumbnails | Thumbnails load correctly |
| 18.5 | Image grid layout | Responsive grid |
| 18.6 | Scroll gallery | Scroll through many images |
| 18.7 | Gallery sorted by date | Most recent first |

### Gallery Filtering
| # | Flow | Description |
|---|------|-------------|
| 18.8 | Filter by conversation | Select conversation → filtered |
| 18.9 | Clear filter | Show all images |
| 18.10 | Empty filter result | No images for conversation |

### Image Actions
| # | Flow | Description |
|---|------|-------------|
| 18.11 | Tap image | Opens fullscreen viewer |
| 18.12 | Fullscreen viewer | Image fills screen |
| 18.13 | Pinch to zoom | Zoom in/out |
| 18.14 | Pan zoomed image | Move around |
| 18.15 | Close fullscreen | Back → returns to gallery |
| 18.16 | View image metadata | See prompt, settings |
| 18.17 | Share image | Share to other apps |
| 18.18 | Save to device gallery | Export to photos |

### Image Deletion
| # | Flow | Description |
|---|------|-------------|
| 18.19 | Delete single image | Delete → removed |
| 18.20 | Delete confirmation | Confirm before delete |
| 18.21 | Multi-select mode | Enter selection mode |
| 18.22 | Select multiple images | Tap to select/deselect |
| 18.23 | Select all | Select all visible |
| 18.24 | Delete selected | Delete multiple at once |
| 18.25 | Clear gallery | Delete all images |
| 18.26 | Deletion removes file | File deleted from disk |

### Gallery Persistence
| # | Flow | Description |
|---|------|-------------|
| 18.27 | Gallery persists | Images survive restart |
| 18.28 | Metadata persists | Prompt/settings survive |
| 18.29 | Orphan file handling | File exists but not in DB |

---

## 19. Settings

### Settings Navigation
| # | Flow | Description |
|---|------|-------------|
| 19.1 | Open settings | Settings tab → screen opens |
| 19.2 | Settings sections | Grouped by category |
| 19.3 | Navigate to model settings | Tap → model settings screen |
| 19.4 | Navigate to voice settings | Tap → voice settings screen |
| 19.5 | Navigate to security | Tap → security screen |
| 19.6 | Navigate to storage | Tap → storage screen |
| 19.7 | Navigate to device info | Tap → device info screen |
| 19.8 | Back navigation | Back → returns to settings |

### Model Settings (Text)
| # | Flow | Description |
|---|------|-------------|
| 19.9 | Temperature slider | Adjust 0.0 - 2.0 |
| 19.10 | Temperature value display | Shows current value |
| 19.11 | Max tokens input | Set max response length |
| 19.12 | Max tokens validation | Positive integer only |
| 19.13 | Top-p slider | Adjust 0.0 - 1.0 |
| 19.14 | Repeat penalty slider | Adjust 1.0 - 2.0 |
| 19.15 | Context length input | Set context window |
| 19.16 | Context length validation | Reasonable range |
| 19.17 | Thread count slider | 1 to device max |
| 19.18 | Batch size input | Set batch size |
| 19.19 | GPU toggle | Enable/disable GPU |
| 19.20 | GPU layers slider | 0 to max layers |
| 19.21 | GPU requires reload notice | "Requires model reload" |
| 19.22 | Loading strategy toggle | Performance vs memory |
| 19.23 | Reset to defaults | Reset all model settings |
| 19.24 | Settings saved immediately | Changes auto-save |

### Image Generation Settings
| # | Flow | Description |
|---|------|-------------|
| 19.25 | Steps slider | Adjust 1 - 50 |
| 19.26 | Guidance scale slider | Adjust 1.0 - 20.0 |
| 19.27 | Width input | Set image width |
| 19.28 | Height input | Set image height |
| 19.29 | Resolution validation | Divisible by 8 |
| 19.30 | Image threads slider | 1 to device max |
| 19.31 | Image settings apply next gen | Takes effect on next generation |

### Intent Detection Settings
| # | Flow | Description |
|---|------|-------------|
| 19.32 | Image generation mode | Auto vs manual |
| 19.33 | Auto-detect method | Pattern vs LLM |
| 19.34 | Classifier model select | Choose classifier model |
| 19.35 | Show generation details | Toggle metadata display |

### Settings Persistence
| # | Flow | Description |
|---|------|-------------|
| 19.36 | All settings persist | Survive app restart |
| 19.37 | Settings sync | Changes reflect immediately |
| 19.38 | Settings migration | Old settings preserved on update |

---

## 20. Storage Settings

| # | Flow | Description |
|---|------|-------------|
| 20.1 | View total storage used | Sum of all models |
| 20.2 | Text models storage | Size of text models |
| 20.3 | Image models storage | Size of image models |
| 20.4 | Whisper models storage | Size of Whisper models |
| 20.5 | Gallery storage | Size of generated images |
| 20.6 | Available storage | Free disk space |
| 20.7 | Storage warning | Low storage warning |
| 20.8 | Per-model sizes | Size of each model |
| 20.9 | Sort by size | Largest first |
| 20.10 | Delete from storage screen | Remove model from here |
| 20.11 | Bulk delete | Select multiple → delete |

---

## 21. Device Info

| # | Flow | Description |
|---|------|-------------|
| 21.1 | View device info | Screen opens |
| 21.2 | Device model | Shows phone model |
| 21.3 | OS version | Shows Android/iOS version |
| 21.4 | Total RAM | Shows device RAM |
| 21.5 | Available RAM | Shows free RAM |
| 21.6 | Total storage | Shows device storage |
| 21.7 | Available storage | Shows free storage |
| 21.8 | Emulator detection | Flags if running in emulator |
| 21.9 | GPU info | Shows GPU capabilities |
| 21.10 | Model recommendations | Suggests models for device |
| 21.11 | Refresh device info | Update readings |

---

## 22. Download Manager Screen

| # | Flow | Description |
|---|------|-------------|
| 22.1 | View download manager | Screen opens |
| 22.2 | Active downloads list | Shows in-progress downloads |
| 22.3 | Download progress | Percentage and bytes |
| 22.4 | Download status | Running/paused/completed/failed |
| 22.5 | Pause download | Pause button works |
| 22.6 | Resume download | Resume button works |
| 22.7 | Cancel download | Cancel button works |
| 22.8 | Completed downloads | Shows completed with checkmark |
| 22.9 | Failed downloads | Shows error state |
| 22.10 | Retry failed | Retry button works |
| 22.11 | Clear completed | Remove from list |
| 22.12 | Empty state | No active downloads message |

---

## 23. App Lifecycle & Persistence

| # | Flow | Description |
|---|------|-------------|
| 23.1 | App to background | State preserved |
| 23.2 | Return from background | Resumes correctly |
| 23.3 | Background during generation | Generation continues or pauses |
| 23.4 | App force killed | State saved |
| 23.5 | Reopen after kill | State restored |
| 23.6 | Active model remembered | Model ID persisted |
| 23.7 | Active conversation remembered | Returns to same chat |
| 23.8 | Settings restored | All settings restored |
| 23.9 | Downloads restored | Background downloads recovered |
| 23.10 | Generation interrupted | Partial response handled |
| 23.11 | First launch after update | Migration runs |
| 23.12 | AsyncStorage corruption | Graceful handling |

---

## 24. Navigation

| # | Flow | Description |
|---|------|-------------|
| 24.1 | Bottom tab navigation | Home/Chat/Models/Gallery/Settings |
| 24.2 | Tab state preserved | Tab remembers state |
| 24.3 | Stack navigation | Push/pop screens |
| 24.4 | Back button (Android) | Hardware back works |
| 24.5 | Gesture navigation | Swipe back works |
| 24.6 | Deep nested back | Multiple levels → returns correctly |
| 24.7 | Navigate during generation | Warning or handled gracefully |
| 24.8 | Navigate during download | Download continues |

---

## 25. Error Handling

### Network Errors
| # | Flow | Description |
|---|------|-------------|
| 25.1 | No internet - model browse | Error message + retry |
| 25.2 | No internet - download | Error + retry option |
| 25.3 | No internet - HuggingFace API | Graceful error |
| 25.4 | Network timeout | Timeout handled |
| 25.5 | Network slow | Progress still shows |
| 25.6 | Network recovery | Auto-retry or manual |
| 25.7 | Partial download resume | Resume from where left off |

### Model Errors
| # | Flow | Description |
|---|------|-------------|
| 25.8 | Corrupt model file | Detected + error shown |
| 25.9 | Model load OOM | Error + smaller model suggestion |
| 25.10 | Model incompatible | Version mismatch error |
| 25.11 | Model missing | Deleted externally → removed from list |

### Generation Errors
| # | Flow | Description |
|---|------|-------------|
| 25.12 | Generation crash | Error message |
| 25.13 | Generation OOM | Error + suggestion |
| 25.14 | Generation timeout | Long generation handled |
| 25.15 | Native module crash | Graceful recovery |

### Storage Errors
| # | Flow | Description |
|---|------|-------------|
| 25.16 | Storage full | Error before download |
| 25.17 | Storage full mid-download | Handles gracefully |
| 25.18 | File system error | Generic error handling |
| 25.19 | Permission denied | Error message |

### Platform-Specific Errors
| # | Flow | Description |
|---|------|-------------|
| 25.20 | LocalDream unavailable (iOS) | "Not supported" message |
| 25.21 | Background download unavailable (iOS) | Falls back to foreground |
| 25.22 | GPU unavailable | Falls back to CPU |
| 25.23 | QNN unavailable | Falls back to MNN |

---

## 26. Edge Cases & Stress Tests

### Input Edge Cases
| # | Flow | Description |
|---|------|-------------|
| 26.1 | Very long message | 10000+ characters |
| 26.2 | Message with only spaces | Blocked/ignored |
| 26.3 | Message with only newlines | Handled |
| 26.4 | Unicode edge cases | Emoji, RTL, etc. |
| 26.5 | Special characters | <, >, &, etc. |
| 26.6 | Code injection attempts | Handled safely |
| 26.7 | Extremely long word | No spaces → handled |

### Scale Edge Cases
| # | Flow | Description |
|---|------|-------------|
| 26.8 | Very long conversation | 100+ messages |
| 26.9 | Many conversations | 50+ conversations |
| 26.10 | Many downloaded models | 20+ models |
| 26.11 | Large gallery | 500+ images |
| 26.12 | Rapid message sending | Spam send button |
| 26.13 | Rapid model switching | Quick switch back and forth |

### Concurrent Operations
| # | Flow | Description |
|---|------|-------------|
| 26.14 | Download during generation | Both work |
| 26.15 | Multiple downloads | All progress |
| 26.16 | Generation + voice recording | Both work |
| 26.17 | Switch conversation during generation | Warning or handled |
| 26.18 | Delete model during generation | Warning |
| 26.19 | App background during generation | Generation pauses/continues |

### Memory Pressure
| # | Flow | Description |
|---|------|-------------|
| 26.20 | Low memory warning | System warns → app responds |
| 26.21 | System kills background app | State persisted |
| 26.22 | Memory pressure during generation | Handles gracefully |

---

## Summary

**Total flows: 360+**

| Category | Count |
|----------|-------|
| Onboarding | 5 |
| Authentication | 15 |
| Permissions | 8 |
| Home Screen | 11 |
| Text Model Management | 48 |
| Image Model Management | 13 |
| Background Downloads | 17 |
| Model Loading | 22 |
| Text Generation | 41 |
| Intent Classification | 17 |
| Image Generation | 36 |
| Vision Models | 12 |
| Document Attachments | 9 |
| Voice Input | 22 |
| Conversations | 23 |
| Chat UI | 42 |
| Projects | 16 |
| Gallery | 29 |
| Settings | 38 |
| Storage Settings | 11 |
| Device Info | 11 |
| Download Manager | 12 |
| App Lifecycle | 12 |
| Navigation | 8 |
| Error Handling | 23 |
| Edge Cases | 22 |
