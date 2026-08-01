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

## Agent: auto-configure + settings-polish + analyse-error (Agent A)

### Summary
All my work is in the `pro/` submodule (branch `fix/locket-round-3`). No Core source changes.
- One-tap **Auto configure** for the recommended models (Whisper + LLM), reusing the guided
  flow's own cards (deleted the separate progress panel).
- **Recorder settings** typography aligned with the app's other settings screens.
- **Recorder** entry added to the app-wide Settings screen via the Pro section registry.
- **Match count** above transcript search results.
- **Copy transcript** CTA in the transcript header (paired side-by-side with Edit).
- 3-dot actions: hide **Compress** when auto-compress is on; **dev-gate** "Check speech".
- Analyse-error fix: classify **out-of-memory** vs **no-model**; replaced the native
  "Could not analyse" alert with a toast + route to setup.

### Files Changed
New (mine, whole): `pro/locket/utils/autoSetupPlan.ts`, `pro/locket/screens/setup/useLocketAutoConfigure.ts`
Mine (whole file): `pro/locket/navigation.ts`, `pro/locket/screens/setup/TranscriptionSetup.tsx`,
`pro/locket/screens/LocketTranscriptionSetupScreen.tsx`, `pro/locket/screens/LocketSettingsScreen.tsx`,
`pro/locket/ui/CollapsibleGroup.tsx`, `pro/locket/ui/PermissionsSection.tsx`, `pro/locket/index.ts`,
`pro/locket/components/RecordingActionsSheet.tsx`, `pro/locket/screens/recording/useRecordingDetail.ts`
Mine but CO-MINGLED (stage my hunks only, `git add -p`): `pro/locket/screens/LocketFeedScreen.tsx`,
`pro/locket/screens/LocketFeedScreen.styles.ts`, `pro/locket/screens/LocketRecordingScreen.tsx`,
`pro/locket/services/recordingProcessingService.ts`, `pro/locket/screens/feed/useLocketFeed.ts`,
`pro/locket/stores/recordingsStore.ts`, `pro/locket/screens/feed/SearchView.tsx`

### Planned Commits (pro, `fix/locket-round-3`)
1. `feat(locket): one-tap auto-configure for the recommended models`
2. `style(locket): align recorder settings typography with the app's settings screens`
3. `feat(locket): add a Recorder entry to the app Settings screen`
4. `feat(locket): copy the transcript from its header`
5. `fix(locket): 3-dot actions - hide Compress under auto-compress, dev-gate Check speech`
6. `fix(locket): classify out-of-memory analyse failures; route model-missing to setup`
7. (blocked) `feat(locket): result count above transcript search` — see notes

### Files I Will Commit
- Only the "mine" files/hunks above, staged with `git add -p` so co-mingled files carry ONLY my hunks.

### Files I Will NOT Commit
- This coordination doc (Agent `recording-detail-transcript-fix` owns committing it — I avoid duplicating).
- `COMMIT-LEDGER.md`.
- B's held work: `AudioPlayerCard.tsx`, `InsightsMiniPlayer.tsx`, `LocketRecordingScreen.styles.ts`,
  `TranscriptList.tsx`, `RecorderHomeCard.tsx`, `UpcomingMeetings.tsx`, `alwaysOnSettingsStore.ts`,
  and B's hunks inside co-mingled files (incl. `sectionOpenBottom`, `transcriptEditHint`, `DiarizeButton`).
- Third agent's recorder/native/notification/search: `AndroidManifest.xml`, `ContinuousRecorderModule.kt`,
  `ContinuousRecorderService.kt`, `BootReceiver.kt`, `continuousRecorderService.ts`, `recorderNotification.ts`,
  `SearchBar.tsx`, `SearchView.tsx` (new file), `FloatingSearch.tsx` (deletion).
- The other agent's idle-branch hunk in `LocketRecordingScreen.tsx`.
- All Core `docs/plans/*.md`, `whisper-npu-poc/`, `whispernpu/`, `__tests__/pro/*`, `browserstcklog.txt`.
- No debug logs / commented code / formatting-only / unrelated refactors.

### Notes for Other Agents
- **`LocketRecordingScreen.tsx` overlap (confirming with `recording-detail-transcript-fix`):**
  I OWN the **copy+edit button pair AND the `Clipboard`/`showToast` imports** (your note asked who owns
  them — that's me). You own the idle-branch hunk. B owns `sectionOpenBottom`/`transcriptEditHint`/
  `DiarizeButton`. My commit #4 stages ONLY the imports + the copy/edit pair; your idle hunk and B's
  polish remain uncommitted afterward. Since my imports hunk is what your idle hunk depends on, order
  is fine either way (both land).
- **`SearchView.tsx` is NOT mine** (third agent's new file). My search match-count is one `<Text>`
  inside it, so I can't hunk-split it. Commit #7 is BLOCKED until the SearchView owner commits the file;
  then I add the count line (or they include it). My `searchCount` style in `LocketFeedScreen.styles.ts`
  is separable and I can commit it, but I'll hold the whole search-count concern to avoid a half-landed feature.
- I removed the native "Could not analyse - Download a text model" alert in `useLocketFeed` (now toast + route to `LocketTranscriptionSetup`).

### Core / Pro Audit
- **No Pro leaked into Core.** All my changes are under `pro/`. Zero edits to `src/` or core `android/`.
- "Recorder in Settings" uses the existing `registerSettingsSection` seam: Pro registers, Core renders
  the registered section. Core gains no dependency on Pro; the section registers only inside
  `activateLocket` (Pro-only, entitlement-gated) so it is absent in free builds. Feature gate intact.
- Files checked: `src/screens/SettingsScreen.tsx` (unchanged by me), `pro/locket/index.ts`,
  `pro/locket/ui/LocketSettingsSection.tsx`.

### FINAL REPORT (Agent A — done)
Landed 5 commits on pro `fix/locket-round-4` (each ESLint-gated; co-mingled files staged with
`git add -p` and `git diff --cached` verified to my hunks only):
- `86409ce` feat(locket): one-tap auto-configure for the recommended models
- `173f64a` style(locket): align recorder settings typography with the app's settings screens
- `2b987cd` feat(locket): add a Recorder entry to the app Settings screen
- `b34fc81` fix(locket): tidy the 3-dot actions - hide Compress under auto-compress, dev-gate Check speech
- `c15d163` fix(locket): classify out-of-memory analyse failures; route model-missing to setup

**Deferred (entangled with other agents' UNCOMMITTED hunks — cannot cleanly isolate mine yet):**
- **Copy transcript** (`LocketRecordingScreen.tsx`): my copy/edit pair + `Clipboard`/`showToast`
  imports sit in the SAME hunk as B's `sectionOpenBottom`/`transcriptEditHint` (+ a separate B
  `transcriptHeaderSectionsFlush` hunk). A modification can't be split out cleanly, and committing
  just the imports would leave them unused (ESLint fail). **Needs B to land the transcript polish
  first, then I add copy/edit — or B includes my copy/edit block.**
- **Feed "Auto configure" nudge** (`LocketFeedScreen.tsx`): my imports are intermixed with the
  third agent's `FloatingSearch`->`SearchView` swap in one hunk; my nudge also lives here. **Needs the
  third agent to land their search rework first, then my nudge goes in cleanly.**
- **Search match count** (`LocketFeedScreen.styles.ts` + `SearchView.tsx`): `SearchView.tsx` is the
  third agent's NEW file; my count `<Text>` lives inside it, so it can't ship until they commit it.

**Concerns for other agents:**
- I did NOT stage the core submodule-pointer bump (`M pro`) — whoever owns the core-side bump does it.
- Verify after your commits: the deferred items above are still uncommitted in the working tree.
- Core/Pro: all 5 commits are pro-only; no Core source touched by me; feature gate intact.

### ACTION NEEDED so Agent A can finish (re-checked — still blocked)
My 3 remaining commits are entangled inside YOUR uncommitted hunks. Please land yours, then I finish:
- **B (transcript polish owner):** commit your `LocketRecordingScreen.tsx` hunks
  (`sectionOpenBottom`, `transcriptEditHint`, `transcriptHeaderSectionsFlush`). Once they're in,
  the ONLY remaining hunks in that file are my `Clipboard`/`showToast` imports + the copy/edit
  side-by-side block — I'll `add -p` and commit `feat(locket): copy the transcript from its header`.
  (Alternatively, if you include my copy/edit `<View>` block in your commit, ping me and I'll drop it.)
- **3rd agent (search-rework owner):** commit `SearchView.tsx` (new) + the `FloatingSearch`->`SearchView`
  swap in `LocketFeedScreen.tsx` + `SearchBar.tsx`. Then my two feed items land cleanly:
  the auto-configure nudge hunks in `LocketFeedScreen.tsx`, and the match-count line in `SearchView.tsx`
  + `searchCount` style in `LocketFeedScreen.styles.ts`.
- I'm holding (not committing) those 3 until you land — committing now would either fragment my change
  or reference your uncommitted `SearchView.tsx` (broken build).

---

## Agent: recorder-notification + Upcoming-collapse + row-align (Agent N / "third agent")

> ⚠️ **BRANCH RENAME (per user instruction):** the working branches were bumped up one.
> **Core: `fix/locket-round-2` → `fix/locket-round-3`. Pro: `fix/locket-round-3` → `fix/locket-round-4`.**
> Commits ride along automatically (in-place `git branch -m`). All "round-3" pro references
> in the other sections above are now "round-4"; the user is notifying the other agents.

### Summary
All my work is in `pro/` (branch `fix/locket-round-4`). Only core change is this doc.
- **Persistent Android recorder notification** with Start/Stop actions from the shade:
  idle = non-dismissible "Not recording / Start"; recording = "Recording / Stop"; a
  boot receiver re-posts the idle notification after a reboot. iOS is a declared no-op.
- **Collapsible "Upcoming" calendar section** on the feed (persisted chevron collapse).
- **Meeting-row height fix**: `upcomingRow` top-aligned so the title lines up with the time.

### Files Changed (all `pro/`)
Entirely mine (whole file):
- `pro/android/src/main/java/ai/offgridmobile/alwayson/ContinuousRecorderService.kt`
- `pro/android/src/main/java/ai/offgridmobile/alwayson/ContinuousRecorderModule.kt`
- `pro/android/src/main/java/ai/offgridmobile/alwayson/BootReceiver.kt` (new)
- `pro/android/src/main/AndroidManifest.xml`
- `pro/locket/services/recorderNotification.ts` (new)
- `pro/locket/screens/feed/UpcomingMeetings.tsx` (100% my collapsible change — see attribution note)

Co-mingled (I stage ONLY my hunks):
- `pro/locket/index.ts` — mine: `refreshRecorderNotification` import + boot/foreground wiring
- `pro/locket/stores/alwaysOnSettingsStore.ts` — mine: `upcomingCollapsed` field/default/setter
- `pro/locket/screens/feed/useLocketFeed.ts` — mine: `upcomingCollapsed` read + toggle + return
- `pro/locket/screens/LocketFeedScreen.tsx` — mine: pass `collapsed`/`onToggleCollapsed`
- `pro/locket/screens/LocketFeedScreen.styles.ts` — mine: `upcomingRow` → `alignItems: 'flex-start'`

### Planned Commits (pro, `fix/locket-round-4`) — ALL DONE ✅
1. ✅ DONE (`ae7b8aa`) `feat(locket): persistent Android recorder notification with Start/Stop from the shade`
2. ✅ DONE (`736a9a3`) `feat(locket): collapsible Upcoming calendar section on the feed`
3. ✅ DONE (`0dc0ea5`) `fix(locket): top-align the Upcoming meeting row with the time`

Each commit was verified to contain EXACTLY my files (6 / 4 / 1); no foreign hunks
swept in. All other agents' hunks (autoCompress, registerSettingsSection,
analyseError, and every file I never touched) remain unstaged/uncommitted.

> ⚠️ **SHARED-INDEX WARNING to other agents:** all three of us share ONE working
> tree + index. A bare `git commit` (no pathspec) commits whatever is staged in the
> shared index right now — which may include ANOTHER agent's just-staged files. I
> observed Agent A's files (`navigation.ts`, `useLocketAutoConfigure.ts`,
> `autoSetupPlan.ts`, `TranscriptionSetup.tsx`, `LocketTranscriptionSetupScreen.tsx`)
> staged in the index after my commits. **Please `git add` your exact paths/hunks
> immediately before committing, and prefer `git commit <pathspec>` or verify
> `git diff --cached --name-only` right before each commit.** My commits are done, so
> I will not touch the index further.

### Files I Will Commit
- The 6 entirely-mine files (whole) + ONLY my hunks in the 5 co-mingled files
  (targeted `git apply --cached --recount`). This doc, separately, in core.

### Files I Will NOT Commit
- Any other agent's hunks in co-mingled files: `autoCompress` default+comment and the
  rest of Agent A's / B's work in `alwaysOnSettingsStore.ts`; `registerSettingsSection`
  re-enable in `index.ts` (Agent A); `analyseError` refactor in `useLocketFeed.ts`
  (Agent A); the other `LocketFeedScreen(.styles)` hunks (Agent A).
- All files I never touched (B's held work, Agent A's whole files, Agent 1's
  `LocketRecordingScreen` hunk, core `docs/plans/*`, tests, whisper-npu, etc.).

### Notes for Other Agents  ⚠️ COLLISION + ATTRIBUTION FIXES
- **@Agent A — `pro/locket/index.ts` is CO-MINGLED, not "whole file yours".** I have
  two hunks in it (the `refreshRecorderNotification` import line, and the
  `refreshNotification` boot/foreground block). Please stage your `registerSettingsSection`
  hunks with `git add -p`, NOT `git add pro/locket/index.ts`, or you will commit my
  notification wiring. I am staging only my two hunks.
- **Attribution fix — `UpcomingMeetings.tsx` and the `upcomingCollapsed` hunks in
  `alwaysOnSettingsStore.ts` are MINE, not "B's".** Agent A's section lists them under
  "B's held work". The collapsible-Upcoming feature is mine; please don't commit those.
  The `autoCompress` default flip in the same store file is NOT mine (B's/baseline).
- After my commits, `git diff` in `pro/` must still show everyone else's hunks intact
  (autoCompress, registerSettingsSection, analyseError, all non-collapse feed hunks).
  Please verify none of yours were swept in.
- `continuousRecorderService.ts` modified state is NOT mine — I reverted my edit there.
  (Agent A's section lists it under "third agent's" — it is effectively no-one's now.)

### Core / Pro Audit
- **No Pro leaks into Core.** Entire implementation under `pro/`. Core imports nothing
  from it; the notification runs only inside `activateLocket()` (Pro-only, entitlement-gated
  via `loadProFeatures`). Zero edits to `src/` or core `android/`.
- `pro/AndroidManifest.xml` (`RECEIVE_BOOT_COMPLETED` + `<receiver>`) merges via
  autolinking — core's `android/app/src/main/AndroidManifest.xml` was NOT edited.
- The only core file I touch is this coordination doc — transient, strip-before-main.
- Files checked: `pro/locket/index.ts`, `src/bootstrap/loadProFeatures.ts` (unchanged by me),
  core `android/app/src/main/AndroidManifest.xml` (unchanged by me).

### Watcher log (Agent N observing the shared repo)
- ✅ Agent A commits `86409ce`,`173f64a`,`2b987cd`,`b34fc81`,`c15d163` — audited, each
  single-owner, no cross-contamination. The `index.ts` / `useLocketFeed.ts` collisions
  I flagged resolved cleanly because my hunks were committed first (they're ancestors,
  so A's later commits took only their own remaining hunks).
- ⚠️ **`75c2ecc` `feat(locket): connect the transcript and player UI on the recording screen`
  SWEPT IN Agent A's pending copy-transcript hunk (planned commit #4).** The
  recording-screen commit staged the whole `LocketRecordingScreen.tsx`, which included
  A's `Clipboard`/`showToast` imports + the "Copy transcript" button. This is the
  shared-index hazard the warning above described.
  - **@Agent A: DO NOT commit your #4 "copy the transcript from its header" — it is
    already in `75c2ecc`.** Your copy-transcript hunk is gone from the working tree
    because it was committed there. Nothing is lost; it's just bundled under a
    different message and no longer attributed to you.
  - Code is intact and not broken; I am NOT rewriting history (would disrupt the shared
    branch and was not requested). Flagging only.

---

## Coordinator sweep (by `recording-detail-transcript-fix`, at user request)

With A and N done, I committed the remaining green, uncommitted work so nothing is lost
and the tree is clean. All on pro `fix/locket-round-4`; tree now clean, `tsc` 0 errors.
Each commit staged an exact pathspec and was ESLint-gated.

- `75c2ecc` feat(locket): connect the transcript and player UI on the recording screen
  — B's compact transport + connected-transcript polish (AudioPlayerCard, InsightsMiniPlayer,
  TranscriptList, LocketRecordingScreen.styles) plus the entangled transcript-header hunk in
  `LocketRecordingScreen.tsx`, which unavoidably carried A's Copy-transcript button and
  `Clipboard`/`showToast` imports (they shared one hunk). So A's planned #4 is landed here.
- `41159db` feat(locket): show a Saving state while a stopped clip finalizes
  — the complete `finalizing` feature across 3 files (recordingsStore state, continuousRecorderService
  wiring, RecorderHomeCard display + stop-confirm sheet). `continuousRecorderService.ts` was NOT
  orphaned — its hunk is the `setFinalizing` wiring.
- `ebe8983` feat(locket): auto-compress recordings by default, skip clips that fail
  — autoCompress default ON (alwaysOnSettingsStore) + per-session failure skip (recordingProcessingService).
- `edc262b` feat(locket): full-screen feed search with match count and auto-configure nudge
  — the FloatingSearch to SearchView redesign plus A's feed nudge and match count, which were
  intermixed in the same `LocketFeedScreen.tsx` hunks and could not be split.

**Notes / concerns**
- Two commits bundle more than one agent's work because the hunks were physically inseparable
  (`75c2ecc`: B polish + A copy button; `edc262b`: search redesign + A nudge). Attribution is via the
  shared `Co-Authored-By: Dishit Karia` line, not per-agent. No history rewritten.
- Ownership was inferred (no Agent B section exists). If any of the above was WIP not meant to land,
  it's one `git revert` away — flag it.
- Core/Pro: every sweep commit is pro-only; no Core source touched.
- Not device-verified — these preserve green progress; on-device checks are a separate gate.
