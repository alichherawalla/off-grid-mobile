# Sync Feedback Release Repair Plan

Date: 2026-08-13  
Status: In progress  
Source acceptance plan: [MANUAL_TEST_2026-08-12.md](./MANUAL_TEST_2026-08-12.md)

## Objective

Repair the release branches against `main`, remove the known failure paths, and verify the complete
Desktop and Mobile journeys. Work is sequential. A later phase does not start until the prior phase
has a green focused gate.

The release repositories are:

- `shared`
- `desktop/pro`
- `desktop`
- `mobile/pro`
- `mobile`

Top-level `sync` is separate EasyShare work. `website` has no tracked release delta. Neither is part
of this release train.

## Completion language

Each item has three independent states:

- **Code**: the implementation exists.
- **Wired**: every consumer uses the canonical owner and the replaced path is gone.
- **Verified**: automated gates and the real user journey pass.

An item is complete only when all three states are true.

## Engineering rules

1. Give each fact, identity, rule, state machine, and resource one canonical owner.
2. Make UI and host representations read-only projections of that owner.
3. Keep business rules in services and pure shared policy. UI sends intent only.
4. Depend on typed contracts at filesystem, native, persistence, network, and model boundaries.
5. Reuse an existing abstraction when it is the correct owner. Do not add parallel helpers.
6. Remove the replaced path after migration. Compatibility aliases can exist only at input
   boundaries.
7. Fake only uncontrollable external boundaries. Do not mock Off Grid services, stores, hooks, or
   components.
8. Land one coherent, green commit per owning seam. Do not mix unrelated fixes.
9. Use merge commits. Do not squash.
10. Record evidence in this document after every completed gate.

## Canonical owners

| Fact                                          | Canonical owner                        |
| --------------------------------------------- | -------------------------------------- |
| File existence and metadata                   | Mobile filesystem adapter              |
| Receive categories and legacy aliases         | `@offgrid/sync` receive policy         |
| Transfer state, visibility, and actions       | `@offgrid/sync` transfer service       |
| Persisted transfer order                      | Transfer-history contract              |
| Device actions                                | Shared device-capability projection    |
| Model origin                                  | Validated transfer manifest            |
| Current network endpoint                      | Desktop discovery service              |
| Pending chat attachments                      | Desktop shared-file service            |
| Chat edit and regeneration                    | Desktop conversation service           |
| Clipboard consent and copy classification     | Native clipboard service               |
| Live reply phase and wire shape               | `@offgrid/sync` chat-stream contract   |
| Busy-state visuals                            | Shared design-system loader primitive  |
| User Eject All lifecycle                      | Mobile user-model-ejection coordinator |
| Shared-file backlog and active receive window | `@offgrid/sync` `SharedFileDelivery`   |
| Concurrent knowledge-document offers          | `@offgrid/sync` transfer reservations  |
| Per-destination outbound transfer order        | `@offgrid/sync` `FileTransferManager`  |

### Typed transfer queue end state

- One logical outbound queue lives in `@offgrid/sync` and is partitioned by destination.
- Every queued job has one stable activity ID and one category derived from the canonical transfer
  classifier. Models, shared files, screenshots, downloads, generated media, attachments, direct
  files, and knowledge documents use the same job contract.
- A job may provide a feature-owned preparation callback, such as publishing a shared-file control.
  The shared queue invokes it only when that job reaches the front. Feature services do not schedule
  transport work themselves.
- `FileTransferManager` moves only the active job. It emits queue and transfer state through one
  progress contract.
- Completed history persists state transitions from that contract. Activity and Files are read-only
  projections; they never schedule or own transfer state.
- Feature-level queues, concurrency gates, and duplicate outgoing-history writers are removed.
- Per-record reconciliation and single-flight deduplication remain separate state-machine concerns;
  they cannot decide transfer order.

## Sequential work plan

### Phase 0 - Freeze and record the baseline

- [x] Identify the five release repositories.
- [x] Record the current release branch heads.
- [x] Confirm that top-level `sync` and `website` are outside this release.
- [x] Make every release worktree clean, including the final Mobile Pro submodule pointer.
- [ ] Record the exact full-suite baseline after the filesystem test boundary is repaired.

Baseline heads at plan creation:

| Repository    | Branch                  | Head           |
| ------------- | ----------------------- | -------------- |
| `desktop`     | `release/sync-feedback` | `79bb06ffd833` |
| `desktop/pro` | `release/sync-feedback` | `bfca9bdf07d7` |
| `mobile`      | `release/sync-feedback` | `10e357f82849` |
| `mobile/pro`  | `release/sync-feedback` | `5a4769caa8d5` |
| `shared`      | `release/sync-feedback` | `966dd99ce0bd` |

### Phase 1 - Close the Mobile filesystem crash class

Decision: Option A. Production must not call `RNFS.stat`.

- [x] Remove executable production `RNFS.stat` calls.
- [ ] Confirm all file readers use the one filesystem adapter.
- [x] Add one faithful native-filesystem fake under the test harness.
- [ ] Make tests declare a directory tree once and derive parent listings from it.
- [ ] Replace test-local RNFS fakes with the shared boundary fake.
- [ ] Add an architecture rule that rejects future production `RNFS.stat` calls.
- [ ] Align `llama.rn` and the CocoaPods graph on version 0.13.
- [ ] Run Mobile lint and TypeScript.
- [ ] Run the complete Mobile test suite.
- [ ] Run the iOS simulator build.
- [ ] Verify startup model scan and debug-log flush on a physical iPhone.
- [ ] Verify the same filesystem journeys on a physical Android device.

Exit condition: zero executable production `RNFS.stat` calls, all Mobile suites pass, native builds
pass, and both physical-device journeys pass.

### Phase 2 - Make mesh sharing policy one contract

- [x] Define one canonical send and receive mode for each workspace category.
- [x] Make Chats, Projects, and Model settings send without optional controls.
- [x] Make Generated media and Message attachments send without optional controls.
- [x] Make Chats, Projects, Model settings, Generated media, and Message attachments required mesh data.
- [x] Generate configurable UI rows and admission decisions from the same catalog.
- [x] Remove the five required mesh categories from Receiving settings on Mobile and Desktop.
- [x] Migrate the old receive master to optional data and discard stored refusals for required data.
- [x] Merge Mobile automatic file rules into Sending and remove the Ambient sharing section.
- [x] Remove the Ambient sharing heading from Desktop and keep one Sending surface.
- [x] Store repeated Sending and Receiving copy in the shared package.
- [x] Use one Mobile drop-down component for Sending destinations and Receiving sources.
- [x] Use drop-down scope selection for both Desktop Sending and Receiving.
- [x] Move detailed Mobile Sending and Receiving rules into bottom sheets.
- [x] Use one reusable policy matrix for Off/Ask/Auto and Refuse/Accept decisions.
- [x] Verify the final settings hierarchy and controls on Mobile and Desktop.
- [x] Default Downloads to all eight supported automatic-sharing file types from one shared policy.
- [x] Save Desktop file-type edits once on Done so rapid choices cannot overwrite each other.
- [x] Persist one opt-in watermark per Desktop folder and baseline existing configured folders on upgrade.
- [x] Keep folder arrival time separate from file modification time so copied downloads remain new.
- [x] Coalesce Desktop sync invalidations at the main-process boundary during transfer bursts.
- [x] Keep the durable shared-file backlog only on the sender.
- [x] Publish shared-file controls only when the bounded delivery window admits the file.
- [x] Prevent State Sync anti-entropy from announcing queued controls outside that window.
- [x] Use the same active-control rule for normal delivery and repair on Desktop and Mobile.
- [ ] Remove receiver-side file controls with no local or staged bytes before startup replay.
- [x] Clear stale nonterminal receive offers from the connected iPhone and Android device.
- [x] Join identical concurrent knowledge-document offers behind one receiver-side writer.
- [x] Accept reconnect offers for an existing matching knowledge document without sending its bytes again.
- [x] Make Project and Knowledge document transfer independent of legacy optional-sharing preferences.
- [x] Enforce one active outbound transfer per destination in the shared transfer manager.
- [x] Route models, direct files, knowledge documents, generated media, attachments, screenshots, and downloads through that manager queue.
- [x] Remove the Desktop host queue, Mobile knowledge-document queue, shared-file concurrency gate, and repair scheduler.
- [x] Publish shared-file controls only when their typed transfer job reaches the front of the manager queue.
- [x] Stop exporting queue primitives to Desktop and Mobile hosts.
- [ ] Verify that enabling Screenshots and Downloads sends only files created after enablement.
- [ ] Verify all eight Download types can be selected on Desktop and Mobile.
- [ ] Move Copied text into the Automatic sharing matrix on Mobile and Desktop.
- [ ] Verify always-sync behavior for generated media and message attachments across devices.

Exit condition: required mesh data has no switch and always moves; every remaining switch controls
one optional content type; both hosts use only Sending and Receiving language.

Focused evidence, 2026-08-13:

- Shared ambient-directory build and all 31 source-contract tests pass, including the existing-grant
  watermark migration.
- Desktop ambient-folder and coalesced-invalidation suites pass: 22 tests.
- Desktop main-process TypeScript passes.
- The accidental local outgoing backlog was backed up, then cleared without changing pairings,
  local files, completed history, or incoming transfers. The deliberate logo-PDF test remains queued.
- The shared 20-file backlog test passes: submitting the backlog publishes no controls. The first
  control publishes only when the manager activates the first typed transfer job.
- Desktop shared-file and State Bridge suites pass: 87 tests. Desktop node TypeScript passes.
- Mobile shared-file unit tests, explicit-share tests, and the real ambient-share integration journey
  pass: 20 tests. The ambient journey proves that a staged control is absent before approval and is
  published when its transfer becomes active.
- The connected iPhone backup is retained at
  `/tmp/offgrid-ios-asyncstorage-backup-20260813.kNt0wF`. Cleanup removed 2,066 nonterminal receive
  rows and 2,062 matching shared-file ops. It preserved 100 completed-history rows. A read-back from
  the phone confirms zero nonterminal receive rows.
- The connected Android backup is retained at
  `/tmp/offgrid-android-RKStorage-backup-20260813.sqlite`. Cleanup removed 1,136 nonterminal receive
  rows and 1,135 matching shared-file ops. It preserved 103 other history rows. A read-back from the
  phone confirms zero nonterminal receive rows and a valid SQLite integrity check.
- A full mesh can offer one replicated knowledge document from two peers at the same time. Shared
  Sync now gives matching bytes one staging-path owner and makes later offers wait for that result.
  Shared typecheck, build, and 12 focused contract tests pass. Desktop node TypeScript and 47
  knowledge-document tests pass. The Mobile knowledge-document integration and refusal suites pass:
  5 tests. Mobile TypeScript and the updated Receiving policy tests pass.
- Reconnect backfill now compares an existing knowledge document at the receiver and resumes at the
  end when size and checksum match. The Mobile integration test proves the repeated offer performs
  zero source reads and does not re-index the document. Project transfer progress also keeps its
  hidden category before, during, and after live progress, including legacy rows without a stored
  category. Shared focused tests pass: 12. Desktop
  knowledge-document tests pass: 48. Mobile knowledge-document tests pass: 5.
- A later Android restart proved that the first cleanup removed symptoms only: 955 remote controls
  rebuilt 107 new 0% receiver rows before the app was stopped. The shared op-log now owns a
  provenance-aware cleanup rule. Mobile and Desktop provide only the IDs whose bytes exist locally
  or are fully staged. Local sender records remain. Shared typecheck and all 470 Sync tests pass,
  including remote-history cleanup before replay. Desktop typecheck and 63 focused sync tests pass.
  Real restart verification is pending.
- The second device cleanup is backed up at
  `/tmp/offgrid-mobile-cleanup-3ll5bs/android-RKStorage.before-cleanup.sqlite` and
  `/tmp/offgrid-ios-cleanup-8dFR2k-before-cleanup`. Android removed 955 remote shared-file ops and
  107 ghost receiver rows. iOS Debug removed four ghost receiver rows, including the dead
  `log_list.json` row. Completed history, staged bytes, and sender-owned rows remain.
- Physical Android restart verification: Sync Activity reopened with 78 rows instead of rebuilding
  the previous 1,033-row ghost backlog. The one-minute no-growth observation is still pending, then
  the same restart check moves to iOS.
- Project and Knowledge document state was already marked required, but Mobile still consulted an
  old raw `projects` preference before sending document bytes. That duplicate gate is removed from
  both hosts. Mobile now normalizes every required category from the shared send-mode contract. The
  focused Desktop knowledge-document suite passes: 23 tests, plus one real SQLite integration test.
  The focused Mobile integration journey passes and includes a stored legacy `projects: false`
  preference.
- Android then proved that one Mac could still offer several files at the same time. Feature-local
  queues did not cover every transfer path. `FileTransferManager` now owns one serial outbound queue
  per destination for every model, shared file, attachment, and knowledge-document sender. The full
  transfer-manager contract passes: 11 tests, including serial order, active cancellation, and
  cancellation before a queued item is offered. The shared package no longer exports its queue
  primitive to hosts. Shared typecheck and all 472 Sync tests pass. Desktop typecheck and 129 focused
  transfer-owner tests pass. Mobile TypeScript, 29 receive-policy tests, 8 Activity tests, and the
  real knowledge-document integration journey pass. Physical four-host verification is pending.
- Physical explicit-file verification used a 163,626,750-byte DMG from macOS. Windows and Android
  each received one active delivery in their own destination lane. iOS correctly refused Files, but
  its Activity row stayed at Receiving 0% after macOS received the refusal. The shared transfer
  manager now emits the same terminal failed state on the receiver for policy, peer-limit, and
  missing-sink refusals. The real encrypted manager suite passes 12 tests, including this policy
  refusal journey.
- Direct inspection of the iPhone store found two IDs for each refused DMG. The durable control row
  used the sender ID, while the transfer manager used the receiver ID. Incoming and outgoing rows
  now derive the same destination-scoped ID in `@offgrid/sync`; host code supplies only the local
  receiver ID and peer display facts. The shared build and 37 focused transfer and receive-policy
  tests pass, including a real history projection that settles one queued row into one Failed row.
  Mobile TypeScript and its knowledge-document integration pass. Desktop TypeScript and 86 focused
  shared-file and knowledge-document tests pass. Commits `a93008a`, `72061eea`, `979cc32c`, and
  `0fad9d1` are pushed. The Windows Shared bundle and all changed Desktop Pro files match the Mac by
  MD5. Physical restart verification is pending.
- macOS now keeps the Share file action pending while it copies the selected file into owned
  storage, blocks duplicate clicks, and opens Activity after queue admission. The focused rendered
  control test passes. Physical macOS verification is pending.
- Generated media and message attachments now read one `hidden` visibility rule from the shared
  sharing catalog. Durable rows, live progress, Desktop delivery rows, and file notifications all
  use that rule. Desktop startup backfill also stops when an attachment's stable `syncId` already
  exists, so it cannot change a completed delivery from `sent` back to `granted`. Shared Sync builds,
  49 focused shared tests pass, 65 Desktop shared-file tests pass, and Desktop node TypeScript passes.
  Commits `5007235` and `ef82adc` are pushed. The five delivery rows reopened by the old build were
  restored to `sent` after a database backup and integrity check. The Windows Shared bundle and
  Desktop Pro service match the Mac by MD5. Physical restart verification is pending.
- The first iOS restart exposed one remaining restored-row path: nonterminal history was projected
  as live progress with the correct hidden `kind`, but Activity ignored that field and guessed from
  `image/png`. The shared projector now uses the transfer's canonical kind before MIME fallback.
  The exact no-separate-durable-row regression is covered for generated media and message
  attachments. Shared Sync builds and 51 focused tests pass. Commit `31983fa` is pushed. Physical
  iOS verification is pending.

### Phase 3 - Make transfer history authoritative

- [x] Preserve transfer `kind` during all live and in-memory history updates.
- [x] Keep hidden project transfers hidden when live progress exists.
- [ ] Persist `kind` in Desktop SQLite.
- [ ] Derive Retry, Cancel, and Dismiss from executable service commands.
- [ ] Make restored Mobile Cancel update durable history without a live manager.
- [x] Render Mobile Notifications, Activity, and Files with one virtualized list adapter.
- [ ] Use the shared List mode as the initial and reset view on Mobile and Desktop.
- [ ] Remove Retry when its source is not durably available.
- [x] Persist every state transition without writing durable history on each byte update.
- [ ] Define one stable order for memory, adapters, SQLite, retention, and restart.
- [ ] Verify manual tests 9.3, 9.4, 9.6, and 9.7 through real stores and restarts.

Exit condition: history, live progress, available actions, and restart projection agree.

Current gate, 2026-08-13:

- Code and wiring are present for durable Mobile Cancel. A live transfer still cancels through the
  manager; a restored row falls back to `CompletedTransferHistory.cancel`. Physical iOS and Android
  verification is pending.
- Mobile Notifications, Activity, and Files use one `FlatList` adapter with bounded initial render,
  batch size, and window size. Notifications no longer mounts every card in a `ScrollView`.
  Activity and Files now index completed deliveries once instead of scanning the complete delivery
  set for every file. Live device review reports that all three screens open much faster.
- Mobile Activity uses the existing small-button action row with the shared 8-point gap token, so
  adjacent Open, Retry, Cancel, and Dismiss actions do not touch. Physical iOS and Android review is
  pending.
- `DEFAULT_SYNC_FILE_VIEW_MODE` in `@offgrid/sync` is `list`. Shared projections, Mobile Activity,
  Mobile Files, Desktop Activity, Desktop Files, and Desktop file notifications use it. Desktop
  typecheck passes. Physical UI verification is pending.

### Phase 4 - Fix the remaining Shared contracts

- [ ] Validate model-origin `repoId`, `revision`, and `path` at the manifest boundary.
- [ ] Keep compatibility with senders that omit origin.
- [ ] Reject malformed origin values before persistence.
- [ ] Base Reconnect and Rename on a real pairing credential.
- [ ] Keep Evict available for license-only rows.

Exit condition: every displayed action is executable and every stored model origin is valid.

### Phase 5 - Fix Desktop discovery

- [ ] Make the discovery service own one current endpoint object.
- [ ] Update it when the network interface changes.
- [ ] Build both the listening socket and Bonjour TXT record from it.
- [ ] Test the re-advertised TXT address, not only the watcher callback.
- [ ] Verify Wi-Fi to Ethernet and Ethernet to Wi-Fi without app restart.

Exit condition: peers always dial the current Desktop address.

### Phase 6 - Fix Desktop pending attachments and chat edits

- [ ] Make the shared-file service own a replayable pending-file snapshot.
- [ ] Deliver the current snapshot to every new subscriber before later updates.
- [ ] Preserve attachment identity and metadata during edit.
- [ ] Put edit, persistence, history construction, and regeneration behind one conversation command.
- [ ] Remove model-history construction from stale React state.
- [ ] Verify late Chat mount, edit plus attachment sync, reopen, and regeneration.

Exit condition: loaders survive late mount, edited attachments sync, and the model receives only the
edited prompt.

### Phase 7 - Fix Desktop thinking capability

- [ ] Reset model capability state on every reload.
- [ ] Make the active model session own its thinking dialect.
- [ ] Bound `/props` with a timeout and explicit failure state.
- [ ] Never reuse a previous model's dialect after probe failure.
- [ ] Verify Muse to Qwen and Qwen to Muse for success, failure, and timeout.

Exit condition: the Thinking control always sends the active model's supported option.

### Phase 8 - Fix Android clipboard consent and classification

- [ ] Put Clipboard Sync enabled state in the native clipboard service.
- [ ] Check consent before the accessibility service reads selected text.
- [ ] Clear selection memory when sync is disabled.
- [ ] Require verified text metadata before selection fallback.
- [ ] Ignore image, file, and unknown clipboard events.
- [ ] Add native tests for Off, non-text, stale selection, and valid text fallback.
- [ ] Verify manual test 3.6 on a physical Android device.

Exit condition: non-text copies stay quiet and selected text is not read or sent while Off.

### Phase 9 - Fix vision-repair provenance

- [ ] Pass repository, revision, and path through the provider contract.
- [ ] Use the recorded revision for tree listing and download URLs.
- [ ] Do not default a pinned transferred model to `main`.
- [ ] Capture one real Hugging Face boundary response and replay it offline.
- [ ] Verify a tag or commit receives its matching projector.

Exit condition: repair preserves the transferred model's exact provenance.

### Phase 10 - Unify loading states

- [x] Define one ephemeral live-turn contract: Waiting, Thinking, Answering, and Generating image.
- [x] Make Desktop text, reasoning, direct image, and tool-deferred image paths publish that contract.
- [x] Make Mobile text, reasoning, and image-generation services publish that contract.
- [x] Render the same remote phases on Desktop and Mobile without device-attribution banners.
- [x] Use one Desktop Thinking block for local, saved, and remote reasoning.
- [ ] Verify Desktop-to-Desktop, Desktop-to-Mobile, Mobile-to-Desktop, and Mobile-to-Mobile.
- [x] Keep one Desktop remote-reply placeholder alive from tool streaming through deferred image
      generation, and replace it only when the durable image message arrives.
- [x] Remove the separate `Off Grid AI - answering on <device>` label from Desktop remote replies.
- [ ] Keep Mobile `LoadingDots` as the one Mobile implementation.
- [ ] Add a production-ready web `LoadingDots` primitive to the component library.
- [ ] Include tokens, ARIA, and reduced-motion behavior.
- [ ] Consume it through one thin Desktop adapter.
- [ ] Replace rotating rings and local dot implementations in the manual-test scope.
- [ ] Add a real pending state to Share and disable duplicate intent while pending.
- [ ] Verify all manual-test C states by screenshot and interaction.

Exit condition: every target surface uses the same three-dot behavior and no pending action can be
submitted twice.

### Phase 11 - Full verification

- [ ] Build and test `shared`.
- [ ] Build and test `desktop/pro`.
- [ ] Build, test, and package `desktop`.
- [ ] Build and test `mobile/pro`.
- [ ] Lint, typecheck, test, and build Android and iOS in `mobile`.
- [ ] Run physical iOS and Android journeys.
- [ ] Run the complete manual test document from a clean install.
- [ ] Run the restart, reconnect, and network-change cases again.
- [ ] Inspect every required screenshot and interaction recording.

### Phase 12 - PR and review train

- [ ] Push `shared` and finish its review loop.
- [ ] Push `desktop/pro` and finish its review loop.
- [ ] Push `mobile/pro` and finish its review loop.
- [ ] Push `desktop` and finish its review loop.
- [ ] Update the Mobile Pro pointer, push `mobile`, and finish its review loop.
- [ ] Merge in dependency order with merge commits.

## Progress log

### 2026-08-13 - Mobile Sync list performance

- Code: the Notifications feed now projects one typed heterogeneous row list and renders it through
  the same `SyncVirtualizedList` adapter used by Activity and Files.
- Code: the Mobile file projection indexes completed deliveries by `syncId` in one pass. Activity
  and Files no longer do file-count times delivery-count work before the list appears.
- Wired: Notifications uses one All, Approvals, File transfers, or Recent drop-down. Clear recent is
  one accessible icon on its right. The shared drop-down renders its options as an overlay, so it
  does not move the list below it. Live transfer progress remains in Activity only.
- Gate: Mobile TypeScript and focused Pro lint pass. The standalone Pro TypeScript command remains
  blocked by three pre-existing `audio/services/ttsService.ts` errors against the installed
  `llama.rn` types.
- Verified: live device review confirms that Notifications, Activity, and Files are much faster.
  Commits `48d6ca64`, `e84e6f72`, and `ac934761` record the projection, list, and overlay changes.

### 2026-08-13 - Plan created

- Created this progress source of truth.
- Confirmed the five release repository heads shown above.
- Confirmed that Mobile has no executable production `RNFS.stat` call. One explanatory comment still
  names the old call.
- Current Mobile worktree change is the `pro` submodule pointer.
- Phase 1 remains in progress because the full test boundary migration and gates are not yet green.

### 2026-08-13 - Download file-type policy

- Code: `@offgrid/sync` now owns the eight-type default for Desktop and Mobile.
- Code: the previous six-type default resolves to the new eight-type default without changing a
  user's custom subset.
- Code: Desktop file-type choices now use a local draft and one save on Done. This removes the
  concurrent last-write-wins failure seen with Presentations, Audio, and Video.
- Wired: Desktop and Mobile read the same shared default. Their reset actions now mean all supported
  types.
- Gate: Shared build, Shared TypeScript, focused Shared policy tests, Desktop renderer TypeScript,
  and focused Mobile/desktop lint passed with no errors.
- Gate: Mobile full TypeScript remains blocked only by the previously recorded stale Receiving test
  contracts. This change added no Mobile source error.
- Verified: physical UI verification is pending. The new Desktop dialog is identifiable by the
  `Select all` action; the old build says `Documents and images`.

### 2026-08-13 - Draft PRs published

- Published the exact local release branch heads as draft PRs so the complete deltas can be reviewed.
- Skipped the pre-push hooks for this publication at the owner's explicit direction. The skipped or
  failed gates remain open work. No PR is merge-ready.
- Uploaded the Desktop branch's 88 referenced Git LFS objects before GitHub accepted the branch.

| Repository    | Draft PR                                                                         |
| ------------- | -------------------------------------------------------------------------------- |
| `shared`      | [off-grid-ai/shared#3](https://github.com/off-grid-ai/shared/pull/3)             |
| `desktop/pro` | [off-grid-ai/desktop-pro#41](https://github.com/off-grid-ai/desktop-pro/pull/41) |
| `desktop`     | [off-grid-ai/OGAD#80](https://github.com/off-grid-ai/OGAD/pull/80)               |
| `mobile/pro`  | [off-grid-ai/mobile-pro#50](https://github.com/off-grid-ai/mobile-pro/pull/50)   |
| `mobile`      | [off-grid-ai/OGAM#628](https://github.com/off-grid-ai/OGAM/pull/628)             |

### 2026-08-13 - Mobile filesystem boundary, incremental verification

- Added one stateful, directory-based native filesystem boundary in
  `__tests__/harness/nativeFileSystem.ts`.
- Updated file-sharing validation and the Oute/Qwen audio asset suites to use that boundary.
- Pushed commits `f093c65f`, `3379b68b`, and `783dc27f` to Mobile draft PR #628.
- Switched to one defect, one focused gate, one commit, and one push so each change can be verified
  manually before the next defect starts.
- Repaired the debug-log rotation suite. It now uses real stored bytes and parent directory entries;
  all 12 tests pass, including rotation after the 5 MB limit.

### 2026-08-13 - One Receiving switch per content type

- Removed the second Generated media and Message attachments definitions from the shared receive
  policy. The ambient source catalog is now their only owner.
- Proved the original failure before the fix: the policy projected two Generated media rows.
- Proved the complete policy path after the fix: one row, one category ID, Off in the projection, and
  refused incoming bytes.
- Proved that stored `generated_media` and `message_attachment` refusals remain effective after an
  upgrade.
- The full `@offgrid/sync` suite passes: 468 tests. Its build and TypeScript gate pass.
- The rendered Mobile Receiving section passes 11 tests and shows one switch for each category.
- Manual iPhone verification confirms that the Receiving section shows exactly one Generated media
  switch and one Message attachments switch.
- Manual Desktop-to-iPhone verification confirms the default Generated media path end to end: the
  Desktop loading state appeared, generation completed, sync transferred the image, and Mobile
  rendered the image in the correct chat.
- Manual Desktop-to-iPhone verification also confirms policy independence: with Files Off and
  Generated media On on iOS, the generated image still transferred and rendered in the correct
  chat.
- Windows showed the image loading component and then replaced it with the generated image. Treat
  this as supporting UI evidence only because the installed Windows build version was not confirmed.
- Product decision changed after that verification: Chats, Projects, Model settings, Generated media,
  and Message attachments are required mesh data. Shared now gives every category one `always` or
  `configurable` receive mode. The same field drives admission, normalization, and both host
  projections.
- Shared builds with the new contract. A direct production-contract probe shows that the four
  required categories still arrive with optional receiving Off, while direct Files are refused.
- An iPhone screenshot confirms that Chats, Projects, Generated media, and Message attachments are
  absent from Receiving. Model settings was removed after the next review. The remaining rows come
  from the shared configurable projection.
- Shortened the Receiving hint to one sentence and added token-based spacing above the scope
  description after device review.
- Product decision also changed Sending: Chats, Projects, and Model settings now send as required
  mesh state. Shared send modes enforce this even if an older stored preference disabled a row.
- Generated media and Message attachments are also required send data. They are absent from the
  Automatic sharing matrix, ignore old stored Off/Ask rules, and queue while a peer is offline.
- A direct shared-package probe confirms that the configurable projection now contains only
  Screenshots and Downloads, while Generated media queues even with optional sending and offline
  queueing turned off.
- Mobile now has only Sending and Receiving accordions. Automatic file rules and direct file sharing
  are inside Sending. Desktop uses the same model and no longer shows an Ambient sharing heading.
- Sending and Receiving explanations now come from one shared copy object used by both hosts.
- Replaced the device chip rows with one selected-device drop-down. Mobile Sending and Receiving use
  the same reusable control. Desktop Receiving now matches its existing Sending destination select
  and supports per-device category rules through the shared policy.
- Replaced the long Mobile rule lists with progressive disclosure. The main screen now shows compact
  Automatic sharing and Receiving rules summaries. Each Configure action opens a bottom sheet using
  the same policy-matrix primitive, with Off/Ask/Auto for sending and Refuse/Accept for receiving.
- Added token-based space below the Automatic sharing sheet header after physical iPhone review.
- Corrected the Desktop hierarchy after screenshot review: Sending and Receiving are now separate,
  equal top-level panels. Receiving is no longer nested inside the Sending surface.
- Fixed the receive-master migration precedence. A stored legacy `enabled: false` value can no longer
  override a new `optionalEnabled: true` selection. The same normalization rule handles global and
  per-device receive masters.
- Removed Model settings from Receiving. Its shared catalog entry is now required in both directions,
  so admission and both settings surfaces use the same rule.
- The shared build passes. A direct production-package probe confirms that legacy global and
  per-device receive masters can be enabled and that the configurable receive catalog contains only
  Copied text, Screenshots, Downloads, Files, and Models.
- Manual review confirms that the final Mobile and Desktop settings hierarchy and controls are
  correct. Policy behavior remains a separate device gate.
- Repaired the Windows development mirror address from `192.168.1.28` to `192.168.1.97` and restarted
  its LaunchAgent. A download-based full comparison found zero differences across 1,202 mirrored
  Desktop files and 467 mirrored Shared files. The Shared Sync production bundle also matches by MD5.
- Manual Mac image generation produced a complete image, and Windows received the final image. The
  Windows pending-image loader did not appear. This is now the next UI defect after runtime-message
  filtering.
- A synced Mobile runtime notice was rewritten without its `notice` context and rendered on the Mac
  as a normal assistant reply with Speak, Copy, and Regenerate actions. Shared now owns one
  `isRuntimeOnlyMessage` rule for current marked notices and legacy `Model loaded` or `Model unloaded`
  rows. The shared receive projection and both host outbound adapters use that rule, so runtime state
  neither enters the mesh nor renders from old received rows.
- The shared build passes. A direct production-package check drops both current and legacy runtime
  notices while preserving an ordinary assistant sentence that contains the words `model loaded`.
- Shared builds with the final send and receive contract. Focused lint and diff checks pass. Host
  screenshots and final physical-device behavior remain to be verified.
- Physical-device verification of the final copy, spacing, and stored-policy migration is still
  required.
- The separate Desktop chat defect remains open: with Tools or Connectors enabled, an explicit
  `draw` request can return false success text without calling the image-generation tool.
- Fixed the Windows remote-image loading gap. Desktop now treats text-tool execution and deferred
  image generation as two phases of one live turn, under one message ID. Native image progress keeps
  the same preview alive; success, failure, or cancellation closes it through the image-job owner.
- Removed the Desktop-only `Off Grid AI - answering on <device>` banner. Normal replies now stream as
  the standard assistant bubble, and the image phase uses the shared Desktop three-dot chat loader.
- Added a replayable live-stream snapshot for a Chat view that mounts after generation starts.
- Shared live-stream integration tests pass (24 tests), Desktop lifecycle tests pass (11 tests),
  Desktop node and web TypeScript checks pass, and the production build passes. The Windows mirror
  matches the Mac by MD5 for the Shared bundle and all changed loader-path files. Physical Windows
  replacement behavior is ready for manual verification.
- Replaced the image-only live activity flag with one shared four-phase live-turn contract. The
  transfer queue remains the durable file-transfer owner and does not carry ephemeral chat state.
- Desktop direct image mode now starts a live turn even when no text stream came first. Desktop
  reasoning uses one collapsible Thinking component for local and received replies.
- Mobile Sync now observes the image-generation service as well as the chat store. It sends the same
  stable message ID in the live preview and the durable image message, and it closes the preview
  before the durable mutation leaves the phone.
- Mobile received previews now use the normal chat renderer for Waiting, Thinking, Answering, and
  Generating image. Remote rows are marked as streaming, so actions stay hidden until the durable
  message arrives.
- Current gate: Shared Sync build and 24 live-stream tests pass. Desktop lifecycle tests, node and web
  type checks, and production build pass. Mobile lint has zero errors in the changed source. Mobile
  TypeScript is blocked only by stale Receiving-policy tests from Phase 2; per the Mobile rule, those
  tests wait until physical verification is complete and the owner asks for test work.
- Windows `.97` matches the Mac by MD5 for the rebuilt Shared Sync bundle, Desktop live-stream owner,
  and Desktop remote-preview renderer. The mirror error log still contains old `.28` failures, but
  direct `.97` hashes prove the files used for this test are current.
- Physical iPhone vision verification passes. A phone image request reached the model and rendered
  the complete result correctly in Chat.
- Found two remaining Mobile-to-Desktop image defects during that run. Desktop rendered a received
  image attachment as a file chip, and Mobile prompt enhancement included a local model-load notice
  in model context. Desktop now routes received image attachments through its existing image preview
  and lightbox. Mobile now filters enhancement context and final output through the shared
  `isRuntimeOnlyMessage` contract.
- Focused evidence is green: the Shared Sync build and runtime-notice contract pass; the rendered
  Desktop image journey passes 14 tests; Desktop web TypeScript passes; changed Mobile source lint
  passes. Full Mobile TypeScript remains blocked by the already-recorded stale Phase 2 policy tests.
- Windows `.97` now matches the Mac by MD5 for both the rebuilt Shared Sync bundle and the changed
  Desktop Chat renderer. The mirror daemon is running; its last error lines are old `.28` records.
- Published Shared `ea2d8e8`, Desktop `8e05797`, and Mobile `7e012023` to the existing draft PR
  branches. Publication used `--no-verify` under the owner's standing instruction; focused gates are
  recorded above and the full Mobile gate remains open.
- Android device logs confirmed that Eject All unloaded three resident models and released about
  2.1 GB. The missing answer was a separate context-budget defect: an 8K-context llama model received
  `n_predict: 8192`, which left no prompt space and caused native `Not enough context space` before
  inference. Mobile now derives the effective output cap from the loaded context through one shared
  budget policy. Conversation compaction reads the same prompt-budget constant. Changed source lint
  passes. Physical Android verification is pending.
- User Eject All now has one coordinator for Home and Chat. It cancels text generation, image
  generation, and an in-progress compaction retry before it releases model memory. Stop now marks a
  turn cancelled even between native attempts, and the compaction owner checks that state before it
  retries. The text-residency check also uses the active engine contract, so LiteRT is no longer
  omitted. Changed source lint has zero errors, and TypeScript has no new errors beyond the recorded
  stale Phase 2 Receiving-policy tests. Physical Android verification is pending.

## Current status

| Phase                  | Code    | Wired   | Verified | State                         |
| ---------------------- | ------- | ------- | -------- | ----------------------------- |
| 0. Baseline            | Partial | Partial | No       | In progress                   |
| 1. Filesystem boundary | Partial | No      | No       | In progress                   |
| 2. Mesh sharing policy | Yes     | Yes     | Partial  | Device verification           |
| 3. Transfer history    | No      | No      | No       | Pending                       |
| 4. Shared contracts    | No      | No      | No       | Pending                       |
| 5. Desktop discovery   | No      | No      | No       | Pending                       |
| 6. Desktop chat        | No      | No      | No       | Pending                       |
| 7. Thinking capability | No      | No      | No       | Pending                       |
| 8. Android clipboard   | No      | No      | No       | Pending                       |
| 9. Vision repair       | No      | No      | No       | Pending                       |
| 10. Loading states     | Yes     | Yes     | Partial  | Four-path device verification |
| 11. Full verification  | No      | No      | No       | Pending                       |
| 12. PR train           | No      | No      | No       | Pending                       |
