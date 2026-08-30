# Off Grid Mobile — QA Test Plan

> Every flow in the app. Written so a manual QA tester can follow step-by-step.

---

## How to read this

- **Precondition** = what must be true before you start
- **Steps** = do these in order
- **Expected** = what you should see
- **Priority**: P0 = every build, P1 = every release, P2 = weekly regression
- **[iOS]** / **[Android]** = platform-specific test

---

# PART A — APP LIFECYCLE

## 1. First Launch

### 1.1 Onboarding appears on first launch (P0)

| Precondition | Fresh install, no prior data |
|---|---|

| # | Step | Expected |
|---|------|----------|
| 1 | Launch the app | Onboarding screen (NOT Home). Animated slide with keyword, accent line, title, description. Dot indicators at bottom |
| 2 | Swipe left through all slides | Each animates in (staggered: keyword → line → title → desc). Dots track position |
| 3 | On the last slide | Button says "Get Started" (not "Next") |
| 4 | Tap "Get Started" | Goes to Model Download screen |

### 1.2 Skip onboarding (P0)

| # | Step | Expected |
|---|------|----------|
| 1 | Tap "Skip" on any slide | Goes to Model Download screen |

### 1.3 Model Download screen — first time (P0)

| # | Step | Expected |
|---|------|----------|
| 1 | Observe screen | "Set Up Your AI". Device info (RAM, tier). Recommended models filtered by device RAM (only models < 60% of RAM shown) |
| 2 | Tap "Skip for Now" | Home screen. Setup card: "Download a text model to start chatting" |

### 1.4 Download first model from this screen (P0)

| # | Step | Expected |
|---|------|----------|
| 1 | Tap a recommended model card | Shows download button |
| 2 | Tap download | Progress bar with percentage. Bytes downloaded / total |
| 3 | Wait for completion | "Success" alert |
| 4 | Tap OK | Home screen. Model available in picker |

### 1.5 Second launch — no onboarding (P0)

| # | Step | Expected |
|---|------|----------|
| 1 | Kill and relaunch app | Home screen directly. No onboarding, no model download screen |
| 2 | If a model was previously active | Model card shows previously selected model |

### 1.6 Second launch — navigation logic (P1)

| Condition | Initial Screen |
|---|---|
| Never completed onboarding | Onboarding |
| Onboarding done, 0 downloaded models | Model Download |
| Onboarding done, has models | Main (Home tab) |
| Passphrase lock enabled | Lock Screen → then above logic |

---

## 2. App Lock

### 2.1 Enable passphrase (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Settings → Security | Toggle OFF |
| 2 | Toggle ON | Setup screen: lock icon, "New Passphrase" + "Confirm" inputs, tips |
| 3 | Enter "ab" → submit | Error: min 6 characters |
| 4 | Enter 51-char passphrase | Error: max 50 characters |
| 5 | Enter "test123" / "test456" (mismatched) | Error: don't match |
| 6 | Enter "test123" / "test123" → "Enable Lock" | Success alert. Toggle ON |

### 2.2 Lock screen on reopen (P0 when enabled)

| # | Step | Expected |
|---|------|----------|
| 1 | Kill app | - |
| 2 | Reopen | Lock screen: lock icon, "App Locked", passphrase input, Unlock button |
| 3 | Enter correct passphrase → Unlock | App unlocks to Home |

### 2.3 Lock screen on background return (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Switch to another app (don't kill) | App goes background. Lock state set immediately |
| 2 | Return to app | Lock screen shown |

### 2.4 Lockout after 5 failures (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Enter wrong passphrase | "4 attempts remaining" |
| 2 | Wrong 3 more times | Count: 3, 2, 1 |
| 3 | Wrong once more (5th) | "Too many failed attempts". Timer starts at ~5:00 |
| 4 | Timer counts down | Real-time MM:SS |
| 5 | Timer reaches 0:00 | Input re-enabled. Attempts reset |

### 2.5 Change passphrase (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Security → "Change Passphrase" | Extra "Current Passphrase" field |
| 2 | Wrong current passphrase | Error |
| 3 | Correct current + new + confirm → submit | Success |

### 2.6 Disable passphrase (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Toggle OFF | Confirmation |
| 2 | Confirm | Lock disabled. No lock screen on reopen |

---

# PART B — MODEL MANAGEMENT

## 3. Text Models

### 3.1 Search for a model (P0)

| # | Step | Expected |
|---|------|----------|
| 1 | Models tab | Search bar, filter toggle, model list |
| 2 | Type "SmolLM2-135M" → tap "Search" | Loading. Results: model cards with name, author, credibility badge |

### 3.2 Download — first time (P0)

| # | Step | Expected |
|---|------|----------|
| 1 | Tap model card | Detail: author, credibility, description, downloads/likes counts, "Available Files" |
| 2 | Files shown | Filename, size, quantization. Files > 60% device RAM hidden |
| 3 | Tap download icon on a file | Progress bar. Cancel (X) button appears on card |
| 4 | Complete | "Success" alert |

### 3.3 Download vision model with mmproj (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Find a vision model (note in files: "Vision files include mmproj") | Tap download |
| 2 | Two parallel downloads start | Main model + mmproj file |
| 3 | Both complete | Model marked as vision-capable |

### 3.4 Re-download already downloaded model (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Navigate to a model you already downloaded | Downloaded file shows checkmark, no download button |

### 3.5 Cancel download (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Start download | Progress + cancel (X) button |
| 2 | Tap X | Download stops. Progress removed. Partial file cleaned up |

### 3.6 Download with network loss (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Start download → airplane mode | Error after timeout |
| 2 | Network back | Can retry |

### 3.7 Background download (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Start download → switch to another app | Download continues in background |
| 2 | Return | Progress reflects actual state |
| 3 | [Android] Background behavior | Uses native DownloadManager. Survives app kill. Resumed via polling on foreground |
| 4 | [iOS] Background behavior | Limited — download only continues while app is in memory. Kill = interrupted |

### 3.8 [Android] Notification permission on first download (P2)

| Precondition | Android 13+, first-ever download |
|---|---|

| # | Step | Expected |
|---|------|----------|
| 1 | Tap download on first model | Permission rationale dialog appears first |
| 2 | Grant permission | Download proceeds with notification |

### 3.9 Load text model from Home (P0)

| # | Step | Expected |
|---|------|----------|
| 1 | Home → tap Text model card | Picker sheet: "Text Models", local models list, remote section (if servers configured), "Browse Models" link |
| 2 | Tap a model | Picker closes. Full-screen overlay: "Loading Text Model" + name + "Please wait..." |
| 3 | Wait | Overlay gone. Card shows model name, quant, ~RAM. "New Chat" button appears |

### 3.10 Low memory warning (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Select a model near device RAM limit | Warning with estimated usage |
| 2 | "Load Anyway" | Loads (may be slow) |
| 3 | "Cancel" | Returns to picker |

### 3.11 Unload text model (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Tap Text card → "Unload current model" (red, power icon) | Model unloads. Setup card reappears. "New Chat" gone |

### 3.12 Filter models (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Tap filter icon | Filters: parameter size, type, source, quantization |
| 2 | Select filter | List updates |
| 3 | "Clear filters" | Full list |

### 3.13 Import local .gguf file (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Models screen → "Import Local File" | File picker |
| 2 | Select .gguf | Import progress card |
| 3 | Complete | Model in downloaded list |

### 3.14 Import local .zip (image model) (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | "Import Local File" → select .zip | Unzipped. Backend auto-detected: Core ML (.mlmodelc), MNN, QNN |
| 2 | Complete | Image model in downloaded list |
| 3 | Select unsupported format (.txt) | Error: "Supported formats: .gguf (text models) and .zip (image models)." |

### 3.15 [iOS] File move during import (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Import on iOS | File moved to app Documents before processing (iOS requirement) |

---

## 4. Image Models

### 4.1 Download CPU image model (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Models → "Image Models" tab | Cards: name, author, size, compatibility |
| 2 | Find "(CPU)" model → download | Progress bar |
| 3 | Complete | "Success". Model auto-activated |

### 4.2 Incompatible model (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Find model marked incompatible | Shows reason: "Requires NPU", "Too large", etc. Download button disabled |

### 4.3 [iOS] CoreML / ANE model (P2)

| Precondition | iOS device with Apple Neural Engine |
|---|---|

| # | Step | Expected |
|---|------|----------|
| 1 | Find CoreML model | Download CoreML-specific files. Uses ANE for inference (fast) |

### 4.4 [Android] QNN / NPU model (P2)

| Precondition | Android with Snapdragon (Qualcomm NPU) |
|---|---|

| # | Step | Expected |
|---|------|----------|
| 1 | Find QNN model | Download QNN-specific files. Uses NPU for inference |

### 4.5 [Android] vs [iOS] filter differences (P2)

| Platform | Backend filter | SD version filter | Style filter |
|---|---|---|---|
| Android | Visible | Hidden | Visible |
| iOS | Hidden | Visible | Hidden |

### 4.6 Load image model from Home (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Tap Image card | Picker with "Image Models" header |
| 2 | Tap model | Overlay: "Loading Image Model". After: card shows name + style + ~RAM |

### 4.7 Unload image model (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Image card → "Unload current model" | Card shows "Tap to select" |

### 4.8 Eject All (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | "Eject All Models" button (shows when any model active) | Confirmation with count |
| 2 | Confirm | All unloaded. Both cards empty. Button disappears |

### 4.9 "Show Recommended Only" toggle (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Toggle ON | Only device-recommended models |
| 2 | Toggle OFF | Full list |

---

## 5. Download Manager

### 5.1 View downloads (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Models → downloads icon (top-right) | Active Downloads (progress bars) + Completed Downloads (name, file, size, delete button) |

### 5.2 Delete downloaded model (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Trash icon on completed model → confirm | Deleted. If active, unloaded. Storage freed |

### 5.3 Repair vision / mmproj (P2)

| Precondition | Vision model with missing/corrupt mmproj |
|---|---|

| # | Step | Expected |
|---|------|----------|
| 1 | "Repair Vision" button (eye icon, orange) | Re-downloads mmproj. Vision restored |

### 5.4 Stale downloads cleanup (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Settings → Storage → "Stale Downloads" section | Invalid/incomplete download entries shown |
| 2 | "Clear All" or individual X | Entries removed |

### 5.5 Orphaned files cleanup (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Settings → Storage → "Orphaned Files" section | Files on disk not tracked by any model (from failed downloads) |
| 2 | "Refresh" button | Re-scans for orphaned files |
| 3 | Delete all or individual | Files removed. Shows total size freed |

---

# PART C — REMOTE SERVERS

## 6. Server Management

### 6.1 Add Ollama server (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Settings → Remote Servers | Server list or empty state |
| 2 | "Add Server" | Modal: Name, Endpoint URL, Notes, API Key (optional) |
| 3 | Name: "My Ollama", URL: "http://192.168.1.100:11434" | Private IP — no warning |
| 4 | "Test Connection" | Tests /v1/models then /api/tags. "Connected — Xms" or error |
| 5 | "Save" | Server in list with green indicator |

### 6.2 Add LM Studio server (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | URL: "http://192.168.1.100:1234" | Auto-detected as LM Studio via /v1/models response (checks for gguf format) |

### 6.3 Server with API key (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Fill API key field | Key stored in device keychain (encrypted, never logged). Bearer token sent in headers |

### 6.4 Public endpoint warning (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | URL: "https://api.example.com" | Warning: not on private network |

### 6.5 Invalid endpoint (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | "not-a-url" | Validation error |
| 2 | Valid format, unreachable host | Test fails. Saved as "offline" (red) |

### 6.6 Duplicate prevention (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Add same endpoint as existing server | Warning: already exists (normalized: lowercase, trailing slashes stripped) |

### 6.7 Health monitoring (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Open Remote Servers screen | All servers auto-tested on load. Green = online, red = offline |
| 2 | "Test Connection" manually | Shows latency "Connected — 45ms" or error |

### 6.8 Edit server (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Tap existing server | Edit modal with pre-filled name, URL, notes, API key |
| 2 | Change name/URL → Save | Updated. Re-tests connection |

### 6.9 Delete server (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Swipe/delete → confirm | Removed. If active, active server cleared |

### 6.10 Scan local network (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | "Scan Network" | Progress indicator. Scans subnet (1-254) on ports 11434 (Ollama) + 1234 (LM Studio). Batch 50 concurrent, 500ms timeout per probe |
| 2 | ~5-8 seconds | Discovered servers auto-added. Existing skipped. Or "No servers found" |

### 6.11 [IPv6] Network scan fallback (P2)

| Precondition | Device has IPv6 address |
|---|---|

| # | Step | Expected |
|---|------|----------|
| 1 | Scan network | Quick-probes gateway IPs (192.168.1.1, 192.168.0.1) with 800ms timeout to find reachable subnet, then scans that |

---

## 7. Remote Model Usage

### 7.1 Select remote text model (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Home → Text card → picker | Below local models: "Remote Models" per server. Each model shows name + capabilities badges |
| 2 | Tap remote model | Card shows name + wifi badge + "Remote" label |
| 3 | "Add Server" button in picker | Navigates to Remote Servers screen |

### 7.2 Remote model capability badges (P2)

| Badge | Detected By |
|---|---|
| Vision | Name contains: -vl, vision, llava, bakllava, moondream, cogvlm, pixtral |
| Tool Calling | Name contains: gpt-4, claude, gemini, mistral, qwen, llama-3, command-r, tool, function |
| Thinking | Server-reported or name-based |

### 7.3 Chat with remote model (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Send message | Streams via SSE (/v1/chat/completions) or NDJSON (Ollama /api/chat) |
| 2 | Generation metadata | "Remote" as backend. Token count approximate (chars/4) |

### 7.4 Remote vision model (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Select vision-capable remote model | Vision support detected |
| 2 | Attach photo + send | Photo sent to server. Response describes image |

### 7.5 Remote tool calling (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Enable tools → ask "What time is it?" | Tool call in OpenAI format. Up to 5 iterations |

### 7.6 Remote thinking — Ollama (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Thinking ON → reasoning question | Ollama receives `think: true`. Reasoning in separate field. Thinking block in chat |

### 7.7 Remote thinking — LM Studio (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Thinking ON → reasoning question | `chat_template_kwargs: { enable_thinking: true }`. `<think>` tags parsed from stream |

### 7.8 Server goes offline mid-generation (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Start generating → kill server process | Error. Server marked offline. Input becomes ready |

### 7.9 Remote image model (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Image card → remote image model | Shows wifi badge + "Remote - Vision" |

### 7.10 Switch from remote to local (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Unload remote model | Active server cleared |
| 2 | Select local model | Switches seamlessly. No remote state left |

---

# PART D — CHAT & GENERATION

## 8. Text Generation

### 8.1 Send and receive (P0)

| # | Step | Expected |
|---|------|----------|
| 1 | Observe empty chat | Header: model name (▼ selector) + project name (folder icon) + settings (sliders icon). Body: "Start a Conversation" + model name + privacy notice |
| 2 | Privacy notice | Local: "Your data is stored locally". Remote: "Your messages will be sent to the remote server" |
| 3 | Type message | Pill icons (+ and gear) collapse/hide. Send button (arrow) appears |
| 4 | Dismiss keyboard → send | User bubble (right). Stop button. Assistant streams (left) |
| 5 | Complete | Timestamp + generation time below message |

### 8.2 Conversation title auto-generation (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | New chat, send first message | Title changes from "New Chat" to first 50 chars of user message (truncated with "..." if longer) |
| 2 | Send more messages | Title stays as first message. Never changes again |

### 8.3 Stop mid-stream (P0)

| # | Step | Expected |
|---|------|----------|
| 1 | Send long prompt → stop button appears | Tap stop. Generation halts. Partial response visible. Input ready |

### 8.4 Multi-turn (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Two exchanges | Both visible. Context maintained |
| 2 | Scroll up | Scroll-to-bottom button appears (chevron-down) |
| 3 | Tap scroll button | Jumps to latest |

### 8.5 Auto-scroll behavior (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Near bottom (< 100px) during generation | Auto-scrolls as new tokens arrive |
| 2 | Scroll up > 100px from bottom | Auto-scroll stops. Scroll-to-bottom button appears |
| 3 | New messages while scrolled up | Don't force scroll. Button stays |

### 8.6 Message actions — long press (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Long press assistant message (haptic: medium impact) | Action sheet: Copy, Retry, Generate Image (if image model loaded) |
| 2 | Long press user message | Copy, Edit, Retry |
| 3 | Copy | "Copied" alert. Text in clipboard (control tokens stripped) |
| 4 | Retry | Previous response replaced. New generation |
| 5 | Edit | Edit sheet with original text. Save → new response generated |
| 6 | Generate Image | Image generation with message as prompt |

### 8.7 Message queue — rapid sends (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Send while generating | Queue indicator: "1 queued" + preview text |
| 2 | First gen completes | Queued auto-sent. Count drops |
| 3 | "Clear queue" | Discarded |

### 8.8 Context compaction (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Very long conversation (50+ messages) | When context fills: "Compacting your conversation..." bar with spinner |
| 2 | Compaction runs | Old messages summarized by LLM. Summary persisted. Recent messages kept |
| 3 | Continue chatting | Responses coherent. No crash |

### 8.9 Generation metadata (P2)

| Precondition | Model Settings → "Show Generation Details" ON |
|---|---|

| # | Step | Expected |
|---|------|----------|
| 1 | Get a response | Below message: GPU info, model name, tokens/sec, time to first token, token count |
| 2 | Local model | Actual GPU info, exact counts |
| 3 | Remote model | "Remote" backend, approximate count |

### 8.10 App killed mid-generation (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Start generation → force kill app | In-flight tokens lost |
| 2 | Relaunch | Messages up to last finalized state restored. Streaming state cleared. Model may still be loaded (native state synced) |

---

## 9. Chat Entry Points

### 9.1 Different entry points, different behavior (P1)

| Entry Point | Params | Behavior |
|---|---|---|
| Home → "New Chat" | {} | Creates new conversation |
| Chats list → tap conversation | { conversationId } | Loads existing |
| Home → Recent Conversations | { conversationId } | Loads existing |
| Project Detail → "New Chat" | { conversationId, projectId } | New chat linked to project |

### 9.2 Chat with no model (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Navigate to chat with no active model | NoModelScreen: CPU icon, "No Model Selected" |
| 2 | If downloaded models > 0 | "Select a model to start..." + Select Model button |
| 3 | If no models | "Download a model from Models tab..." |

### 9.3 Model loading in chat (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Loading screen during model load | Spinner + model name + size + vision hint. Blocks chat |

### 9.4 Pending settings bar (P2)

| Precondition | Changed text gen settings that require model reload |
|---|---|

| # | Step | Expected |
|---|------|----------|
| 1 | Change context length or GPU layers in settings | "Settings changed — tap to reload model" bar in chat (local models only, not remote) |
| 2 | Tap the bar | Model reloads with new settings |

### 9.5 Switch model mid-conversation (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | In active chat → tap model name (▼) in header | ModelSelectorModal opens with local + remote models |
| 2 | Select a different model | Model loads. Chat history preserved. Next generation uses new model |
| 3 | Generation metadata | Shows new model name on subsequent messages |

### 9.6 Switch project mid-conversation (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | In chat → tap project name (folder icon) in header | ProjectSelectorSheet opens |
| 2 | Select different project | Project badge updates. System prompt changes for next generation |
| 3 | Header shows new project name | Correct |

### 9.7 Chat settings modal — stats bar (P2)

| Precondition | At least one generation completed in this chat |
|---|---|

| # | Step | Expected |
|---|------|----------|
| 1 | Tap settings (sliders icon) in chat header | Modal opens. Top section shows last gen stats: tokens/sec, token count |
| 2 | Remote model active | Notice: "Remote model — some settings only apply to local models" |

### 9.8 Chat settings modal — gallery navigation (P2)

| Precondition | Chat has generated images |
|---|---|

| # | Step | Expected |
|---|------|----------|
| 1 | Settings modal → "Gallery (N)" row | Opens gallery filtered to this conversation's images only |

### 9.9 Chat settings modal — project link (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Settings modal → "Project: {name}" row | Opens project selector to change/view project |

### 9.10 Delete conversation from chat (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | In chat → settings (sliders icon) → "Delete Conversation" (red) | Alert: "Delete? This will also delete all images generated in this chat." |
| 2 | Confirm | Conversation + images deleted. Navigates back |

---

## 10. Tools

### 10.1 Tool picker (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | In quick settings popover → "Tools" row | ToolPickerSheet opens. 6 tools with toggle switches: |

| Tool | Icon | Network Required |
|---|---|---|
| Web Search | globe | Yes (wifi icon) |
| Calculator | hash | No |
| Date & Time | clock | No |
| Device Info | smartphone | No |
| Knowledge Base | book-open | No |
| URL Reader | link | Yes (wifi icon) |

### 10.2 Tool call flow (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Enable tools → "What time is it?" | Tool call message: "Using get_current_datetime". Tool result (expandable). Assistant uses result |
| 2 | Tap tool result row | Expands to show full output (markdown) |
| 3 | Tap again | Collapses |

### 10.3 Multi-step tools (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Complex query requiring multiple tool calls | Up to 5 tool iterations. Each call + result shown sequentially |

---

## 11. Thinking / Reasoning

### 11.1 Local model thinking (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Quick settings → Thinking ON | Badge: "ON" |
| 2 | Send reasoning question | Thinking block (collapsed): "Thinking..." |
| 3 | Tap thinking block header | Expands: shows reasoning text |
| 4 | Tap again | Collapses |

---

## 12. Attachments

### 12.1 Attach document (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Tap "+" button in input pill | Popover: "Photo" (camera icon) + "Document" (file icon) |
| 2 | "Document" | Native file picker |
| 3 | Select file | Preview thumbnail above input. X to remove |
| 4 | Type message + send | Sent with document context |

### 12.2 Attach photo — with vision (P1)

| Precondition | Vision model (has mmproj) loaded |
|---|---|

| # | Step | Expected |
|---|------|----------|
| 1 | "+" → "Photo" | Image picker (camera roll) |
| 2 | Select photo → "What's in this?" → send | User message with image. Assistant describes image |

### 12.3 Attach photo — no vision (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | "+" → "Photo" (non-vision model) | Alert: "Vision Not Supported — Load a vision-capable model (with mmproj) to enable image input." |

### 12.4 Multiple attachments (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Attach doc, attach another | Both previews shown |
| 2 | Remove one → send with other | Correct |

### 12.5 Attachment survives keyboard dismiss (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Attach file + type → dismiss keyboard | Preview + text preserved |
| 2 | Re-open keyboard → send | Everything sent |

---

## 13. Voice Input

### 13.1 Download whisper model (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Settings → Voice Transcription | 5 model variants with name, size, accuracy description |
| 2 | Tap model → download | Progress bar + percentage |
| 3 | Complete | "Downloaded" green badge |

### 13.2 Whisper model validation (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | If downloaded model file < 10 MB (corrupt) | Auto-detected as invalid. File deleted. Prompts re-download |

### 13.3 Record and transcribe (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Empty input → observe circular button | Microphone icon (voice button) |
| 2 | Press and hold | Recording. Pulsing ripple animation. Haptic |
| 3 | Speak | Partial transcript in real-time (3-second streaming chunks, 30-second full buffer) |
| 4 | Release | "Transcribing..." spinner. Text appears in input |
| 5 | Send | Message sent |

### 13.4 Cancel by drag (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Press + hold → drag left > 80px | Cancel zone. Haptic warning |
| 2 | Release | Cancelled. No text added |

### 13.5 No whisper model (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Press mic with no model | Alert: voice model not downloaded |

### 13.6 Remove whisper model (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | "Remove Model" → confirm | Deleted. Voice disabled until re-download |

---

# PART E — IMAGE GENERATION

## 14. Image Gen Modes

### 14.1 Auto-detect with Pattern method (P0)

| Precondition | Text + image model loaded. Mode=Auto, Method=Pattern |
|---|---|

| # | Step | Expected |
|---|------|----------|
| 1 | Settings → IMAGE GENERATION → Auto + Pattern | Set |
| 2 | Send "Draw a picture of a cute cat" | Pattern detects keywords (draw, picture). Text response first, then image gen starts |
| 3 | Wait (up to 3 min) | Image appears as attachment on assistant message |

### 14.2 Pattern does NOT trigger on text (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | "What is machine learning?" | No image gen. Text-only response |

### 14.3 Pattern detection keywords (P2)

| Category | Example Triggers |
|---|---|
| Direct generation | draw, paint, sketch, create, generate, design, render |
| Image keywords | image, picture, art, illustration, portrait, landscape |
| "Show me" | "show me image/picture/visual" |
| Formats | wallpaper, avatar, logo, icon, banner, poster, thumbnail |
| Art styles | digital art, oil painting, watercolor, anime style |
| Photography | 35mm, 50mm, macro (with "shot"/"photo") |
| Quality | 4k, 8k, hd, photorealistic, hyperrealistic |
| SD signals | stable diffusion, midjourney, masterpiece, best quality |

### 14.4 Auto-detect with LLM method (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Method=LLM → send ambiguous request | "Understanding your request..." classifying bar. LLM answers YES/NO. If YES: image gen. If NO: text only |

### 14.5 LLM method with classifier model (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Select classifier model (e.g. SmolLM) in settings | Status: "Loading classifier model..." → "Analyzing..." → "Restoring text model..." (if Fast strategy) |
| 2 | Memory strategy selected | "Save Memory": keeps classifier, lazy-reloads text model. "Fast": swaps back immediately |

### 14.6 Intent classification caching (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Send same prompt twice | Second time: instant classification from 100-item cache |

### 14.7 Force mode (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Quick settings → "Image Gen" → cycle to "ON" | Force badge |
| 2 | Send "hello" | Image gen triggers regardless |
| 3 | Cycle to "OFF" | Disabled even for "Draw a cat" |
| 4 | Cycle to "Auto" | Back to auto-detect |

### 14.8 No image model fallback (P1)

| Precondition | Auto mode, NO image model loaded |
|---|---|

| # | Step | Expected |
|---|------|----------|
| 1 | "Draw a cat" | Pattern detects intent. System prepends: "[User wanted an image but no image model is loaded]". Text-only response |

### 14.9 No image model alert from quick settings (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Tap "Image Gen" in quick settings with no image model | Alert: "No Image Model — Download an image generation model from the Models screen" |

---

## 15. Image Gen Settings

### 15.1 Basic settings (P1)

| Setting | Range | Default | Effect |
|---|---|---|---|
| Steps | 4-50 | 8 | Higher = better quality, slower |
| Size | 128-512 px | 256x256 | Larger = more detail, more time/memory |
| Guidance Scale | 1-20 | 7.5 | Higher = follows prompt more strictly |

### 15.2 Advanced settings (P2)

| Setting | Range | Default | Notes |
|---|---|---|---|
| Threads | 1-8 | 4 | CPU threads. Takes effect on next model load |
| OpenCL (Android) | On/Off | On | GPU acceleration |
| Clear GPU Cache (Android) | Button | - | Removes cached kernels |
| Enhance Prompts | On/Off | Off | Text model enhances before generating |

### 15.3 Prompt enhancement flow (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Enable "Enhance Image Prompts" → send "a cat" | Thinking indicator. Text model adds artistic style, lighting, quality modifiers (up to 75 words, using last 10 messages for context) |
| 2 | Enhanced prompt used for image gen | Higher quality result |

### 15.4 [Android] OpenCL first-run optimization (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | First-ever image gen with OpenCL ON | "Optimizing GPU..." status. ~120 second one-time kernel compilation |
| 2 | Subsequent gens | Much faster (kernels cached) |
| 3 | "Clear GPU Cache" | Cache removed. Next gen re-optimizes |
| 4 | OpenCL OFF | CPU fallback. Slower but more compatible |

### 15.5 Image gen backend display (P2)

| Platform | Condition | Backend Shown |
|---|---|---|
| iOS | Always | Core ML (ANE) |
| Android + QNN model | QNN backend | QNN (NPU) |
| Android + MNN + OpenCL ON | MNN backend | MNN (GPU) |
| Android + MNN + OpenCL OFF | MNN backend | MNN (CPU) |

### 15.6 View/interact with generated image (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Tap generated image in chat | Fullscreen viewer |
| 2 | Back / swipe down | Returns to chat |

### 15.7 Cancel image gen (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Open Gallery during generation | Banner: preview, "Generating...", prompt, progress (step X/Y), cancel X |
| 2 | Tap X | Cancelled. Banner gone |

### 15.8 Image gen pipeline crash (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Image model crashes during gen | "Image generation failed — model encountered error and was unloaded. Please try again." |

---

# PART F — TEXT GENERATION SETTINGS

## 16. Text Gen Settings

### 16.1 Temperature (P1)

| Range | Default | Behavior |
|---|---|---|
| 0.0-2.0 | 0.7 | Low = focused. High = creative |

### 16.2 Max Tokens (P1)

| Range | Default | Step |
|---|---|---|
| 64-8192 | 1024 | 64. Shows "1.0K" for values ≥ 1024 |

### 16.3 Context Length (P1)

| Range | Default | Step | Notes |
|---|---|---|---|
| 512-32768 | 2048 | 1024 | Capped by model's max. **Warning at 8192+**: "High context uses significant RAM and may crash." **Requires model reload** |

### 16.4 Top-P / Repeat Penalty (P2)

| Setting | Range | Default |
|---|---|---|
| Top-P | 0.1-1.0 | 0.9 |
| Repeat Penalty | 1.0-2.0 | 1.1 |

### 16.5 CPU Threads / Batch Size (P2)

| Setting | Range | Default | Notes |
|---|---|---|---|
| Threads | 1-12 | 6 | Requires reload |
| Batch Size | 32-512 | 512 | Step 32. Higher = faster, more memory |

### 16.6 [Android] GPU Acceleration (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | GPU toggle ON (default) | GPU Layers slider appears (1-99, default 1) |
| 2 | Increase layers | More offloaded to GPU. Faster but more VRAM. Requires reload |
| 3 | **Constraint**: GPU ON forces f16 KV cache | Warning: "GPU acceleration on Android requires f16 KV cache". q8_0/q4_0 disabled |

### 16.7 Flash Attention (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Toggle OFF | Warning if quantized cache: "Quantized cache will auto-enable flash attention" |
| 2 | Select q8_0 or q4_0 with flash attn OFF | Flash attention auto-enabled (required) |

### 16.8 KV Cache Type (P2)

| Type | Description | Constraint |
|---|---|---|
| f16 | Full precision. Highest memory, best quality | Always available |
| q8_0 | 8-bit quantized. Good balance | Requires flash attention. Disabled on Android+GPU |
| q4_0 | 4-bit. Lowest memory, may reduce quality | Requires flash attention. Disabled on Android+GPU |

### 16.9 Model Loading Strategy (P2)

| Strategy | Behavior |
|---|---|
| "Fast" (performance) | Keep models in memory. Faster but more RAM |
| "Save Memory" | Load on demand. Slower switching |

### 16.10 Reset to Defaults (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | "Reset All to Defaults" → confirm | All: temp=0.7, maxTokens=1024, context=2048, topP=0.9, repeatPenalty=1.1, etc. |

### 16.11 Default System Prompt (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Model Settings → "System Prompt" section | Editable text area. Changes persist. Used by all new chats (not project chats) |

### 16.12 Chat settings modal vs Model Settings screen (P2)

| Feature | Chat Settings Modal | Model Settings Screen |
|---|---|---|
| Stats bar (tokens/sec) | Yes (if last gen exists) | No |
| Conversation actions (delete, gallery, project) | Yes | No |
| "Remote only" notice | Yes (if remote model active) | No |
| Reset button | "Reset to Defaults" | "Reset All to Defaults" |
| System prompt editing | No | Yes |
| Image model selector dropdown | No | Yes |

---

# PART G — PROJECTS & KNOWLEDGE BASE

## 17. Projects

### 17.1 Create project (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Projects tab → "New" | Name, Description (optional), System Prompt inputs |
| 2 | Empty name → Save | Error |
| 3 | Empty system prompt → Save | Error |
| 4 | Fill both → Save | Project in list: icon (first letter), name, chat count |

### 17.2 Edit / Delete project (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Tap project → Edit | Pre-filled fields. Save updates |
| 2 | Swipe left → delete → confirm | "Chats not deleted" warning. Project removed. Chats unlinked |

### 17.3 Chat with project system prompt (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Project → "New Chat" | Header shows project name. System prompt active |
| 2 | Send message | Response follows project's system prompt |

### 17.4 Switch project in chat (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | In chat → tap folder icon in header | Project selector sheet |
| 2 | Select different project | Header updates. System prompt switches |

---

## 18. Knowledge Base (RAG)

### 18.1 Add document (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Project → Knowledge Base → "Add Document" | File picker (multi-select) |
| 2 | Select file | Progress: extracting → chunking → indexing → embedding → done |
| 3 | Document in list | Name, size, enabled toggle (on) |

### 18.2 Supported file types (P2)

| Category | Extensions |
|---|---|
| Text | .txt, .md, .csv, .json, .xml, .html, .log |
| Code | .py, .js, .ts, .jsx, .tsx, .java, .c, .cpp, .h, .swift, .kt, .go, .rs, .rb, .php, .sql, .sh |
| Config | .yaml, .yml, .toml, .ini, .cfg, .conf |
| PDF | .pdf (native extraction) |
| **Limits** | Max 5 MB per file. Text truncated to 500 KB for RAG |

### 18.3 Chunking details (P2)

| Setting | Value |
|---|---|
| Chunk size | 500 chars |
| Overlap | 100 chars (20%) |
| Min chunk length | 20 chars |
| Split strategy | Paragraph boundaries (double newline), sliding window for large paragraphs |
| Embedding model | all-MiniLM-L6-v2 (384-dim, Q8_0, CPU-only, 2 threads) |

### 18.4 Toggle document (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Toggle OFF | Excluded from queries. Embeddings kept |
| 2 | Toggle ON | Immediately re-included |

### 18.5 Delete document (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Swipe → confirm | Document + chunks + embeddings removed from DB |

### 18.6 Preview document (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Tap document name | Full text, scrollable, name + size in header |
| 2 | If file deleted from device | Tries: exact path → filename in Documents → filename without UUID prefix → "File not found" error |

### 18.7 RAG query in chat (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Chat in project with indexed docs | Semantic search: cosine similarity finds top 5 chunks. Formatted as `<knowledge_base>` block with `[Source: filename (part N)]` per chunk |
| 2 | Response uses document info | Accurate answers from indexed content |

### 18.8 RAG without embeddings (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Embedding model failed to load | Fallback: returns first 5 chunks by position (no semantic ranking) |

### 18.9 RAG budget (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Large KB, many documents | Uses 25% of context window. Accumulates by similarity until budget exceeded. Less relevant chunks dropped |

### 18.10 Multi-document KB (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | 3+ documents indexed | Query pulls from multiple sources. Source attribution per chunk |

---

# PART H — GALLERY & NAVIGATION

## 19. Gallery

### 19.1 Image grid (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Home → Image Gallery card | Grid + count badge + "Select" button |
| 2 | Tap image | Fullscreen: Save, Delete, Share, Details |

### 19.2 Bulk select/delete (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Long press image | Select mode. Checkbox |
| 2 | Tap more images / "All" | Multi-select |
| 3 | Delete → confirm | Removed |

### 19.3 Generation banner (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Open Gallery during gen | Banner: preview, "Generating...", prompt, step X/Y, cancel X |

### 19.4 Conversation-specific gallery (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Open gallery with conversationId param | Only images from that conversation |

### 19.5 Image save (P2)

| Platform | Save Location |
|---|---|
| iOS | Documents/OffgridMobile_Images |
| Android | ExternalStorage/Pictures/OffgridMobile |

| # | Step | Expected |
|---|------|----------|
| 1 | Save from fullscreen | [Android] requests WRITE_EXTERNAL_STORAGE. Success alert shows path |

### 19.6 Image share (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Share from fullscreen viewer | Native share sheet (Photos, Messages, etc.) |

---

## 20. Tab Navigation

### 20.1 All 5 tabs (P0)

| # | Step | Expected |
|---|------|----------|
| 1 | Home | Home screen |
| 2 | Chats | Conversation list: title, preview, timestamp (time/Yesterday/weekday/date), project badge |
| 3 | Projects | Project list: icon, name, chat count |
| 4 | Models | Search, Text/Image tabs, model list |
| 5 | Settings | Theme, navigation links |
| 6 | Tap same tab repeatedly | No crash, no duplicate navigation |

### 20.2 Deep navigation and back (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Models → search → model → detail → back | Search results preserved |
| 2 | Home → New Chat → back | Returns to Home |

### 20.3 Tab switch during loading (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Start model download → switch tabs | Download continues. Not cancelled |
| 2 | Start generation → switch tabs | Generation continues in background |
| 3 | Return to Models tab | Downloads show current progress |
| 4 | Return to Chat tab | Shows streamed content |

### 20.4 Models tab focus/unfocus (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | On model detail view → switch to another tab → switch back | Detail view reset to list (selectedModel cleared on tab unfocus) |

---

## 21. Chats List

### 21.1 Conversation list (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Chats tab | List with timestamps: time (today), "Yesterday", weekday (this week), date (older) |
| 2 | Tap conversation | Chat screen with full history |
| 3 | Swipe left → delete | Alert: "Delete 'title'? This will also delete all images generated in this chat." Cancel / Delete |

### 21.2 Empty state (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | No conversations | "No Chats Yet" icon + message |
| 2 | If has models | "Start a new conversation..." + "New Chat" button |
| 3 | If no models | "Download a model..." (no button) |

### 21.3 New chat from chats list (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | "New Chat" button | If no model: alert "Please download a model first from the Models tab" |

---

# PART I — SETTINGS

## 22. Settings Screen

### 22.1 Theme (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | System / Light / Dark | App switches immediately across all screens |

### 22.2 Navigation items (P1)

| Item | Destination |
|---|---|
| Model Settings | ModelSettingsScreen |
| Remote Servers | RemoteServersScreen |
| Voice Transcription | VoiceSettingsScreen |
| Security | SecuritySettingsScreen |
| Device Information | DeviceInfoScreen |
| Storage | StorageSettingsScreen |

### 22.3 Community links (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | "Star on GitHub" | Opens external browser to GitHub repo |
| 2 | "Rate on the App Store" / "Rate on Google Play" | Opens this platform's store rating page |

### 22.4 Reset Onboarding (debug) (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | "Reset Onboarding" | Navigates back to Onboarding screen. Checklist reset |

---

## 23. Device Info

### 23.1 Device information (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Settings → Device Information | Device Model, OS + version, Total RAM, Device Tier |
| 2 | Tier cards | Three cards: Low (<4GB), Medium (4-6GB), High (6-8GB), Flagship (8GB+). Current highlighted |

### 23.2 Hardware tier classification (P2)

| RAM | Tier | NPU |
|---|---|---|
| < 4 GB | Low | - |
| 4-6 GB | Medium | - |
| 6-8 GB | High | Apple ANE (iOS) |
| 8+ GB | Flagship | ANE (iOS) / Snapdragon 8 Gen 2+ (Android) |

---

## 24. Storage

### 24.1 Storage overview (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Settings → Storage | Animated usage bar. Legend: Used / Free. Breakdown: LLM count, Image count, total storage, conversation count |
| 2 | LLM models listed | Name, quantization, size |
| 3 | Image models listed | Name, backend (Core ML / QNN / GPU), style, size |

---

# PART J — ONBOARDING SPOTLIGHT

## 25. Guided Onboarding

### 25.1 Pulsating icon (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Home screen, top-right | Red pulsating dot (scale 1→1.4, opacity 1→0.5, 500ms loop) |
| 2 | Tap it | Onboarding sheet opens: progress bar (X/6), checklist items |

### 25.2 Checklist items (P2)

| # | Step | Completion Condition |
|---|------|---------------------|
| 1 | Download a model | Any model downloaded (local or remote server exists) |
| 2 | Load a model | activeModelId or activeRemoteTextModelId set |
| 3 | Send your first message | Any conversation has messages |
| 4 | Try image generation | triedImageGen flag set |
| 5 | Explore settings | exploredSettings flag set |
| 6 | Create a project | projects.length > 4 |

### 25.3 Spotlight step chaining (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Tap "Send your first message" | Spotlight on Chats "New Chat" (step 2) → ChatInput (step 3) → VoiceRecordButton (step 12). 800ms delay between chains for element mount |

### 25.4 Reactive image gen spotlight (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | First image generated | Triggers: spotlight on Image model card (step 13) → New Chat (step 14) → ChatInput (step 15) → Settings icon (step 16) |

### 25.5 Auto-dismiss (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Complete all 6 steps | Sheet auto-dismisses after 3 seconds |

---

# PART K — SHARE PROMPT & DEBUG

## 26. Share Prompt

### 26.1 Share prompt sheet triggers (P2)

| Trigger | When |
|---|---|
| 2nd text generation | Ever |
| Every 10th text generation | Ongoing |
| Any image generation | Every time |

| # | Step | Expected |
|---|------|----------|
| 1 | Trigger met | Sheet appears: "Star on GitHub", the platform rating action, "Maybe later" |
| 2 | Tap GitHub or X | Opens link. `hasEngagedSharePrompt` flag set. Never shown again |
| 3 | "Maybe later" | Dismisses without setting flag. Will show again |

---

## 27. Debug Sheet

### 27.1 Access and view debug info (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | In chat → settings modal → access debug panel | Debug sheet opens (snap points: 35%, 65%, 90%) |
| 2 | Context Stats | Token count, max context, usage % with visual bar |
| 3 | Message Stats | Original count, post-context-management count, truncated count (warning color if truncated) |
| 4 | System Prompt | Full text (selectable for copying) |
| 5 | Last Formatted Prompt | Exact ChatML sent to LLM |
| 6 | Messages | All messages with USER/ASSISTANT badges, index, content preview |

---

# PART L — PLATFORM DIFFERENCES

## 28. iOS vs Android

### 28.1 Platform-specific behavior summary (P1)

| Feature | iOS | Android |
|---|---|---|
| GPU acceleration (text) | Not available | Toggle + GPU layers slider |
| KV cache constraint | All types available | GPU ON → f16 only |
| Image gen backend | Core ML (ANE) always | MNN (GPU/CPU) or QNN (NPU) |
| OpenCL toggle | Hidden | Visible |
| Background downloads | Active app only | Native Download Manager (API 33+) |
| Image save path | Documents/OffgridMobile_Images | Pictures/OffgridMobile |
| Storage permission | Not needed | WRITE_EXTERNAL_STORAGE |
| Notification permission | Not needed | POST_NOTIFICATIONS (API 33+) |
| FlatList clipping | removeClippedSubviews=true | removeClippedSubviews=false (avoids Android rendering bugs) |
| File import | Requires file move first | Direct path access |
| Image model filters | SD version visible, Style hidden | Backend visible, Style visible, SD version hidden |

---

# PART M — SAFETY & EDGE CASES

## 29. Safety Checks

### 29.1 Model file validation (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | App validates model before loading | Checks: file > 1KB, first 4 bytes = "GGUF" magic number |
| 2 | Invalid file | "Invalid model file" error |

### 29.2 Memory check before load (P1)

| # | Step | Expected |
|---|------|----------|
| 1 | Load model | Estimates: (fileSize × 1.2) + (contextLength / 1024 × 0.5) MB + 200MB headroom |
| 2 | Insufficient | Warning with "Load Anyway" option |

### 29.3 Native crash recovery (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | LLM inference crashes (ggml, OOM, tensor error) | safeCompletion wrapper catches. Clears cache. Returns structured error instead of app crash |

---

## 30. Empty States (All Screens)

| Screen | Empty State Content |
|---|---|
| Home — no model | Setup card: "Download/Select a text model to start chatting" |
| Home — no conversations | Recent conversations section hidden |
| Chat — empty | "Start a Conversation" + model name + privacy notice (local vs remote) |
| Chat — no model | NoModelScreen: "No Model Selected" + action button |
| Chats list — empty | "No Chats Yet" icon. Button if models available |
| Projects — empty | "Create a project to organize chats" |
| Project chats — empty | "No chats in this project" |
| Gallery — empty | "No images" |
| KB — empty | "No documents added" |
| Remote servers — empty | "Add Server" + "Scan Network" |
| Download Manager — no active | "No active downloads" |
| Download Manager — no completed | "No completed downloads" |

---

## 31. Markdown & Links

### 31.1 Tappable links in messages (P2)

| # | Step | Expected |
|---|------|----------|
| 1 | Model response contains a URL | Link rendered in markdown, tappable |
| 2 | Tap link | Opens in external browser via Linking.openURL() |

---

## 32. Accessibility (KNOWN GAP)

**No accessibilityLabel, accessibilityRole, or accessibilityHint attributes exist anywhere in the codebase.** Only testID attributes for E2E testing. This is a known gap — screen readers will have degraded experience.

---

## Summary

| Priority | Count | When to Run |
|----------|-------|-------------|
| P0 | ~18 | Every build / every PR |
| P1 | ~57 | Every release |
| P2 | ~103 | Weekly regression |
| **Total** | **~178** | |

### P0 Quick Checklist

1. First launch → onboarding
2. Skip onboarding → model download screen
3. Second launch → no onboarding
4. Download first model
5. Load text model
6. Send message → get response
7. Stop generation
8. Auto-detect image generation (pattern)
9. All 5 tabs work
10. Lock screen (if enabled)
