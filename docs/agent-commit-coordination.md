# Agent Commit Coordination

> Shared coordination for the three Claude instances committing locket work.
> This is a temporary coordination artifact — strip before main (see docs/STRIP-BEFORE-MAIN-BUILD.md).

---

## Agent: recording-detail-transcript-fix

### Summary
- Fixed a UI bug on the Locket recording-detail screen: when a recording is
  transcribed but not yet analysed (idle state), the screen showed only the
  "Analyse" call-to-action and **hid the finished transcript**. It now keeps the
  transcript on screen (virtualized rows, or a flat-text fallback) with Analyse
  offered as the optional next step.

### Files Changed
- `pro/locket/screens/LocketRecordingScreen.tsx` — **ONE hunk only** (the idle
  `!vm.hasInsights && !vm.isGenerating && !vm.loadingModel` branch in `renderBody`).

### Planned Commits
- Commit 1 (pro, branch `fix/locket-round-3`):
  `fix(locket): keep the finished transcript visible before Analyse`
  — the single idle-branch hunk, staged via a targeted patch so it does not pull
  in the other uncommitted hunks in the same file.

### Files I Will Commit
- (core) `docs/agent-commit-coordination.md` — this doc, committed separately.
- (pro) the one idle-branch hunk in `pro/locket/screens/LocketRecordingScreen.tsx`.

### Files I Will NOT Commit
- Every other modified/untracked file in core and pro — they are the other two
  agents' work, not mine (AndroidManifest, ContinuousRecorderService.kt,
  LocketFeedScreen.*, useLocketFeed.ts, recordingProcessingService.ts,
  alwaysOnSettingsStore.ts, BootReceiver.kt, SearchView.tsx, recorderNotification.ts,
  autoSetupPlan.ts, useLocketAutoConfigure.ts, all core src/android/ios/docs changes, etc.).
- The **other hunks inside `LocketRecordingScreen.tsx`** that I did NOT author:
  the `Clipboard`/`showToast` imports, the analysed-branch copy+edit button pair,
  `transcriptHeaderSectionsFlush`, `sectionOpenBottom`, `transcriptEditHint`.
  Whoever owns the analysed-branch transcript polish should commit those.

### Notes for Other Agents
- **File overlap (please read):** `pro/locket/screens/LocketRecordingScreen.tsx`
  has multiple independent uncommitted hunks. I own ONLY the idle-branch hunk
  (`@@ -215` region). I will `git apply --cached` just my hunk and commit that, so
  the file will still show your remaining hunks as uncommitted afterward. If you
  planned to commit this whole file, coordinate first so we don't clobber each other.
- My hunk relies on the `Clipboard` + `showToast` imports which are part of
  *your* uncommitted hunk. If you commit and then revert those imports, my hunk
  breaks. Suggest your import hunk lands too (it's needed by the analysed-branch
  copy button as well).
- Verify: after my commit, `npx tsc --noEmit` should still be 0 errors (it was
  before, with all hunks present).

### Core / Pro Audit
- My code change is **pro-only** (`pro/locket/...`). No core source touched.
- No Pro implementation leaks into Core; Core has no new dependency on Pro; feature
  gates untouched (this is a render-branch change inside an already-gated Pro screen).
- Files checked: `pro/locket/screens/LocketRecordingScreen.tsx` (my hunk),
  and confirmed I added nothing under `src/` in core.
- The only core file I touch is this coordination doc under `docs/` — a temporary
  artifact, not code, flagged for strip-before-main.

---

### FINAL REPORT (done)
- **Core commit** `6c0b44e0` — `docs: update commit coordination` (this doc only).
- **Pro commit** `0bd5e9d` (branch `fix/locket-round-3`) —
  `fix(locket): keep the finished transcript visible before Analyse`.
  Staged via `git apply --cached` of a single-hunk patch so it committed **only**
  the idle-branch hunk; the file still shows the other agents' hunks as unstaged.

**Intentionally excluded**
- The copy-to-clipboard button in the idle-state transcript header. It needed the
  `Clipboard` + `showToast` imports, which live in *another agent's* unstaged hunk.
  Committing it alone would have made my commit reference missing imports (broken
  restore point), so I dropped it. Once the import hunk lands, whoever owns the
  transcript polish can add a copy button to the idle header to match the analysed one.
- All other modified/untracked files, and all other hunks in
  `LocketRecordingScreen.tsx` (imports, analysed-branch copy+edit pair,
  `transcriptHeaderSectionsFlush`, `sectionOpenBottom`, `transcriptEditHint`).

**Concerns for other agents**
- My committed hunk uses `vm.segments`, `vm.speakerRows`, `vm.playFrom`,
  `activeStartMs`, `AnalyseCta`, `TranscriptList` — all present at HEAD, so my
  commit is self-contained and green on its own.
- The pro submodule pointer in core is now advanced by my pro commit. I did **not**
  stage that pointer bump — leaving it for whoever owns the core-side submodule bump.

---

