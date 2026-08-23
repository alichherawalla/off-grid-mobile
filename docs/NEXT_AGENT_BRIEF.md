# Brief for the next agent — Off Grid, open concerns

You are picking up work in `/Users/user/wednesday/off-grid-ai`, a workspace of five separate git
repos: `desktop` (OGAD), `mobile` (OGAM), `sync` (OGAS), `shared` (the `@offgrid/*` packages) and
`website`. `desktop`, `mobile` and `shared` are all on branch `release/sync-feedback`.

Read `mobile/rules.md` in full before touching that repo. For device E2E work, read
`mobile/docs/IOS_E2E_HANDOFF.md` — it has the device table, WebDriverAgent bring-up and the
device-driving traps, and is not repeated here.

## Ground rules

- **Never reset, stash, revert, force-push or delete anything.** Every repo holds unrelated
  in-progress work. Commit only files you changed yourself.
- **Do not write tests unless explicitly asked.** The standard is: finish the source change, have it
  verified by hand on a real device, and write tests only when asked. A test written against
  unverified behaviour encodes the bug.
- **Report status as a gate — code / wired / verified.** A premature "done" is a defect. If you did
  not watch it work, say so.
- Verify on the real surfaces. Typecheck and unit tests do not catch build, route or device errors.

## Background

Three read-only research agents compared the released tag `v0.0.103` (2026-07-16) against
`release/sync-feedback` (554 commits, 874 files). Everything below is their evidence, unverified on
device. **Nothing in this list has been reproduced on hardware yet — your first job on any item is to
confirm it is real before fixing it.**

Note `pro/` is a git submodule in both `mobile` and `desktop`; the Pro sync implementation is NOT in
that 874-file diff, only a pointer move (`ff0d8742` → `8883ae51`).

---

## Priority 1 — memory and crash risk (worst on iOS)

Two protections the user cares about most were checked and are **intact**; do not "fix" them:
- Android memory-reclaim credit — `mobile/src/services/memoryBudget.ts:86-95`, zero commits since the tag.
- iOS jetsam guard refusing a clean sidecar on a dirty image — `mobile/src/services/modelResidency/index.ts:197-236`.

What WAS removed, in commits `2fa3b967` and `43f520a0` (both 2026-08-15):

1. **`getMaxContextForDevice` deleted** — the RAM-tier `n_ctx` ceiling (≤6GB→2048, ≤8GB→4096,
   else 8192), along with its 7 unit tests. `llm.ts` now reads *"Do not impose a second RAM-tier
   ceiling here."* On iOS a memory breach is an **uncatchable jetsam SIGKILL**, so the engine's
   GPU→CPU→CPU@2048 fallback ladder cannot catch it. The deleted comment cited real evidence:
   *2098MB on a 4GB iPhone 12, mid-generation*.
2. **`n_predict` app-owned ceiling deleted** — this REVERTS an Aug-13 fix (`58581c7c`) that added
   `CONTEXT_OUTPUT_BUDGET_RATIO = 0.40` for *"a requested output equal to the full context leaves
   zero prompt space and llama.cpp rejects the turn"*. Now `mobile/src/services/llmHelpers.ts:419-422`
   passes `n_predict: requestedMaxTokens` raw.
3. **8192 max-tokens cap and the LiteRT RAM-tier ceiling deleted.**

And simultaneously these became **writable by a paired desktop** — `contextLength`, `maxTokens`,
`gpuLayers`, `nThreads`, `nBatch`, `kvCacheType`, `flashAttn` — validated for type and range only,
with **no device-fit check**: `mobile/src/services/sync/mutation.ts:55-113` →
`mobile/pro/sync/mobileStateMaterializer.ts:73-77` → `mobile/src/stores/appStore.ts:310-324`.

**The sharpest instance.** The `maxTokens ≤ contextLength` invariant is enforced ONLY in the UI hook's
`onChange` (`mobile/src/hooks/useTextGenerationSettings.ts:99,104-107`). The sync path writes the
store directly and bypasses it. Desktop offers maxTokens up to 32768 and ctxSize up to 131072, and the
mutations are per-key — so a desktop-side maxTokens change alone lands on a phone still at 4096,
giving `n_predict 32768 > n_ctx 4096`: llama.cpp rejects the turn before inference, while the settings
screen still displays "4096". A silent UI/engine divergence.

There is in-repo precedent for this failure class: `mobile/src/stores/appStoreMigrations.ts:30-33`
documents a removed MCP auto-boost that pinned context to 32768 and *"never restored it, causing OOM
crashes and tanked tok/s on flagship devices"*, needing a one-time repair migration. Sync can now
reproduce that state from a peer, with no migration to undo it.

**Suggested direction (confirm before building):** the clamp belongs at the store boundary, not the
UI, so every writer — local and synced — passes through it. Also consider whether a synced value
should be capped to what the receiving device can actually fit.

**Device tests that settle it:**
- 4GB iPhone (12 / SE3), small GGUF, set Context Length to the model's max, send a long prompt.
  Old builds capped to 2048. Fear: hard termination, no JS error, no crash dialog.
- Pair a 4GB iPhone with desktop, set desktop Context window to 131072, watch what mobile becomes.
- Mobile Context 4096 + desktop Max output 32768 → send. Expect "Not enough context space", and a
  settings screen still reading 4096.
- Regression checks the fix must NOT break: 12GB Android, Aggressive, load the largest GGUF that used
  to load — expect it to load. iOS: generate an image, then trigger a whisper/TTS sidecar mid-render —
  expect an overridable refusal card, NOT a jetsam kill.

---

## Priority 2 — cross-device voice arrives broken

Phone→Mac audio-attachment sync is **newly enabled** in this delta and is half-built.

- The Mac classifies any non-image attachment as text:
  `desktop/pro/main/sync/shared-file-sync-service.ts:1236` —
  `kind: control.mimeType.startsWith('image/') ? 'image' : 'text'`.
  A `.wav` therefore renders through the generic file-chip branch
  (`desktop/src/renderer/src/components/MemoryChat.tsx:770-795`) as a paperclip, the filename, and the
  literal word **"text"**. No player, no duration.
- Clicking it opens a **blank** modal: `openAttachment`
  (`MemoryChat.tsx:4054-4067`) routes non-images to a text viewer, and the materializer wrote
  `text: ''`. The `<pre>` at `MemoryChat.tsx:5648-5656` renders nothing. Download is the only way to
  hear the audio.
- **Duration and audio format are carried and then dropped.** The descriptor has them
  (`shared/packages/sync/src/transfer/shared-file.ts:44-56`); the writer at
  `shared-file-sync-service.ts:1233-1243` writes neither.
- The transfer is **always-on and invisible** — `send: "always"`, `receive: "always"`,
  `activity: "hidden"` in `shared/packages/sync/src/sync-sharing-catalog.ts:32-39`. No opt-in, and no
  visible row if it stalls.
- A silent voice note (STT yields nothing) still sends — `mobile/src/components/ChatInput/voiceNoteSend.ts:119-124` —
  producing an empty user bubble plus the chip.
- Mac→phone audio is simply not implemented (desktop only publishes generated images). That is an
  asymmetry, not a bug.

Confirmed NOT a problem: TTS voice is not syncable on either side.

**Test:** record a voice note on the phone in Voice/Audio mode; on the Mac expect the transcript as
message text and a chip reading `<name>.wav  text`; click it and expect a blank viewer.

---

## Priority 3 — things that could break everything, unverifiable by reading

- **`llama.rn` bumped `^0.12.5` → `0.13.0-rc.0`** (a release candidate) in `mobile/package.json`.
  Every test fakes the native module, so nothing catches this. If it is bad, replies fail everywhere
  and voice merely *looks* broken. **Test first: send one typed message on a real iPhone and a real
  Android.**
- **A new Pro admission gate can withhold the entire audio bundle.**
  `mobile/src/bootstrap/loadProFeatures.ts` computes `admitted` and returns before `pro.activate()`
  when false; all audio lives in `activateAudio()` inside `activate()`. Symptom: the Voice
  quick-settings row is gone and nothing is ever spoken. The rule only denies on a positive
  "inactive", so cold/offline start is safe — but `proEntitlementLifecycle.start()` is new at boot.
  No test asserts that `'inactive'` withholds audio while `'unknown'` grants it.
- **STT model detection changed** — `mobile/src/stores/whisperStore.ts:227` now lists downloaded
  models, applying a 10 MB floor (`whisperModelFiles.ts:58`) and deriving the id from the filename.
  Symptom: the mic shows the download prompt although the model is on disk.

---

## Priority 4 — behaviour changes worth a decision

- **Tool step limit 3/5 → configurable, default 25** (`mobile/src/stores/appStore.ts:207`). At the cap
  it no longer forces a final answer: it discards streamed content and emits a notice
  (`generationToolLoop.ts:1130-1141`). `forceFinalTextResponse` was deleted. Because `maxToolCalls`
  is synced, a peer set to `1` turns any single-tool request into that notice. 25 rounds of on-device
  tool calls is also ~8× the old ceiling — a latency and context-growth exposure the old cap hid.
- **Model resolution falls back to filename** when the id misses
  (`mobile/src/services/activeModelService/resolveModel.ts:24-40`). Deliberate — it fixed a "live
  model, refused send" bug — but two models sharing a GGUF filename now resolve to whichever is first.
  `resolveDownloadedModel` and `selectedTextModelIdOf` have **no test files at all**.
- Unchanged and safe, so do not re-audit: the image-vs-text decision function, the intent classifier,
  the auto/force/disabled badge cycle, tool-schema selection, and the `<|think|>` prepend.

---

## Priority 5 — mesh defects seen live tonight

- **macOS takes longer than 90s to surface a chat synced from iOS.** In one run the same conversation
  passed when `verify-normal` was re-run immediately after, and it was visibly in the macOS sidebar
  with a completed reply. **Do not just raise the timeout** — if macOS really is that slow, the
  latency is the bug and the timeout is the symptom.
- **Windows never received an iOS-originated conversation at all**, while iOS, Android and macOS all
  had it. Its Devices panel read `7 nearby / 3 connected`, so it is on the mesh. Unexplained.

## Machine state as of this handoff

- **iPhone** — WebDriverAgent up. It serves on the phone's own IP; read it from the launcher log. The
  launcher process IS the server, and after any WDA restart you must create a session before the
  rig's `attach()` works. See the E2E handoff doc.
- **macOS** — up on CDP `127.0.0.1:9222`.
- **Windows — BROKEN, unresolved.** The app restarts fine (4 electron processes) and
  `Test-NetConnection 127.0.0.1:9224` reports open, but nothing serves HTTP on 9224 — not through the
  SSH tunnel and not from the box itself (`Invoke-WebRequest` fails locally). The documented start is
  `npm run dev -- --remoteDebuggingPort 9224` from `C:\Users\oga\ogad-git` (see
  `mobile/scripts/e2e/GENERATED_IMAGE_SYNC.md`); the originally-working process had the Chromium form
  `electron . --remote-debugging-port=9224` on its command line. Reach the box with
  `ssh oga@192.168.1.26`; the tunnel is
  `ssh -N -L 9224:127.0.0.1:9224 oga@192.168.1.26`. **Suspect `Test-NetConnection` is a false
  positive and the flag never reaches Chromium.**
- **Android** — dropped off `adb` entirely (`adb devices` empty after a server restart). Needs a
  physical reconnect before any mesh run can include it.

## Already done this session — do not redo

- `run-normal` in `attended-thinking-sync.mjs` now honours `--primary`; it previously found the
  surface named `android` and dispatched through Appium regardless, so every "iOS" run went out from
  the Android phone.
- A `--mesh` flag that genuinely excludes unavailable devices (it used to print the exclusion and run
  them anyway).
- iOS quick-settings accessibility: the popover merged all five rows into one element, so
  `quick-thinking-toggle` did not exist as a control. Fixed with `accessible={false}`; verified on
  device. This was a real VoiceOver defect.
- Desktop attachment images now fill their bubble and crop (WhatsApp-style), with the bubble capped to
  a column.
- Each desktop is now resolved against several addresses (macOS `127.0.0.1`/`.25`/`.64`, Windows
  `127.0.0.1`/`.94`/`.26`), first to answer wins.

## Still to build (requested, not started)

- An E2E for multiple attachments in one turn — pdf + text + image on a single message. This is the
  **composer** path, distinct from the project Knowledge Base path already covered by
  `prepare-project`.
- An E2E using camera capture instead of a photo-library pick.
- iOS file staging for `prepare-project`: `stageProjectFixtures` throws for any non-Android device
  because it uses `adb push`. The UI journey is already platform-agnostic; only staging is not. iOS
  needs a real path (the app's Documents container via `devicectl`, or the Files app).
- `generated-image-sync`, `vision-image-sync` and `vision-answer-sync` are still Android-hardcoded and
  need the same `--primary` treatment `run-normal` received.
