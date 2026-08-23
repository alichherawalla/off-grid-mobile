# Model memory & residency — test matrix

What is covered, what is NOT, in one place. Scope: everything that decides whether a model loads,
co-resides, is evicted, or is refused — text, image, STT, TTS, embedding, classifier.

Source of truth for "covered": a test in `__tests__/integration/` that drives the real stack over
device-boundary fakes and asserts on a rendered surface. Unit tests of the planner are deliberately
NOT counted as coverage here.

Counts as of 16 Aug 2026: **28 integration tests** in `__tests__/integration/memory/`.

---

## 1. Lifecycle, per model type

| Capability | text | image | STT (whisper) | TTS | embedding | classifier |
|---|---|---|---|---|---|---|
| Loads when it fits | ✅ `litertLazyOnSelect`, `pickerRamMatchesResidencyChip` | ✅ `imageMemoryCard.guard` | ✅ `whisperResidentOnDownload` | ✅ `ttsCoresidentInVoiceTurn` | ❌ | ❌ |
| Refused gracefully when it does not fit | ✅ `loadAnywayCardRendered` | ✅ `imageMemoryCard.guard` | ✅ `whisperBlockedFreeRetry` | ❌ | ❌ | ❌ |
| Override ("Load Anyway") | ✅ `overrideFloor`, `loadAnywayCardRendered` | ✅ `imageMemoryCard.guard` | ❌ | ❌ | ❌ | ❌ |
| Ejected by the user | ✅ `modelSelectorEjectResident`, `lazyReloadAfterEject` | ⚠️ via `ejectAllUnloadsEveryType` only | ✅ `ejectAllLeavesWhisper` | ⚠️ via eject-all only | ❌ | ❌ |
| Lazy-reloads after eject | ✅ `lazyReloadAfterEject` | ❌ | ❌ | ❌ | ❌ | ❌ |
| Reclaimed when memory is tight | ✅ `textPreloadGateReclaimAware` | ❌ | ✅ `sttReclaimedOnSend`, `voiceNoteReclaimsStt` | ✅ `memoryWarningEvictsSidecars` | ❌ | ❌ |

## 2. Co-residency pairs

| Pair | Covered |
|---|---|
| text + STT | ✅ `textWhisperCoresident` (T116) |
| text + TTS | ✅ `ttsCoresidentInVoiceTurn` (T120) |
| text + image | ✅ `resendAfterImageGen` (M11) — clean text pages in around dirty image |
| text + LiteRT text (swap, never both) | ✅ `residencySwap.happy` |
| image + STT | ⚠️ present in the same files but not the asserted subject |
| image + TTS | ❌ |
| STT + TTS (a full voice turn) | ⚠️ `ttsCoresidentInVoiceTurn` covers TTS; the pair is not the subject |
| anything + embedding | ❌ **not covered at all** |
| anything + classifier | ❌ **not covered at all** |
| three heavy at once | ❌ |

## 3. Eviction

| Trigger | Covered |
|---|---|
| OS memory-warning evicts sidecars, keeps active heavy | ✅ `memoryWarningEvictsSidecars` (T117) |
| Loading a heavy model evicts another heavy | ✅ `residencySwap.happy`, `residencyMatrix.modes` |
| Eject All frees every type | ✅ `ejectAllUnloadsEveryType`, `ejectAllLeavesWhisper` |
| Policy change ejects residents | ✅ `policyChangeEjectsResidents` |
| A failed unload is not counted as freed | ✅ `failedUnloadOverCommits`, `sttReclaimFailedUnload` |
| Eviction ordering across all 3 modes | ✅ `residencyMatrix.modes` (scenario-as-data) |
| The model mid-generation is never evicted | ❌ |
| TTS not evicted while speech is playing | ❌ (`canEvict` exists in code, untested) |
| Embedding not evicted mid-RAG | ❌ |

## 4. The estimate itself

| Question | Covered |
|---|---|
| Advisory check and load gate size the SAME model | ✅ `imageEstimatorDivergence` (Q14) — **image only** |
| Same, for TEXT (`modelPreloader` 1.5x vs `activeModelService` 2.2x) | ❌ **not covered — and they currently disagree** |
| Pre-load gate reads the same reclaim-aware RAM as the loader | ✅ `textPreloadGateReclaimAware` |
| **Context length changes whether a model fits** | ❌ **not covered anywhere** — no test mentions contextLength / n_ctx |
| Predicted cost matches actual footprint after load | ❌ (needs a device) |
| KV cache quantisation changes the requirement | ❌ |
| Estimate is right for a vision model (mmproj added) | ❌ |

## 5. Policy modes

| Case | Covered |
|---|---|
| Balanced co-residency | ✅ `residencyMatrix.modes`, `loadingModes` |
| Aggressive commits more RAM | ✅ `aggressiveDirtyOverCommit` (M6) |
| Lean/conservative | ✅ `loadingModes`, `residencyMatrix.modes` |
| Switching mode with residents loaded | ✅ `policyChangeEjectsResidents` |
| "Aggressive would fit this" recommendation | ❌ **feature does not exist** |

## 6. What the user is told

| Case | Covered |
|---|---|
| Refusal shows a card, not a crash | ✅ `imageMemoryCard.guard`, `loadAnywayCardRendered` |
| RAM shown agrees across surfaces | ✅ `pickerRamMatchesResidencyChip`, `modelSelectorShowsLoadedRam` |
| Over-budget-but-warnable model warns | ✅ `curatedLiteRTOverBudgetWarning` |
| The refusal NAMES the numbers (needs X, device has Y) | ❌ **feature does not exist** |
| The refusal offers a way out (lower context / smaller model) | ❌ **feature does not exist** |
| A silent preload failure is surfaced | ❌ **`modelPreloader` returns bare — no signal at all** |
| Eviction is visible to the user | ⚠️ implied by the selector tests, never the subject |
| Download screen shows total (not available) memory | ❌ (changed 16 Aug, untested) |

## 7. Axes that are thin or absent

| Axis | State |
|---|---|
| Platform | android 25 files / ios 6 — **iOS is the jetsam platform and is the thinner half** |
| Engine | litert appears in 12 of 28; llama/gguf is the default elsewhere |
| Relaunch / restart | n/a **by design** — nothing is resident after a relaunch, so there is no state to cover |
| Backend (CPU vs GPU/NPU) | ❌ nothing pins that the backend changes the estimate |
| Device tier (4 / 8 / 12 / 24 GB) | partially, via seeded RAM in individual tests; not a named axis |
| Cross-device (a peer pushing settings this device cannot honour) | ❌ |

---

## The shortlist — genuinely uncovered, testable today, no new feature needed

1. **Context length decides the fit.** The Qwythos case: refused at a large context, loads at a small
   one. Zero tests mention context length, and the current estimator cannot express it.
2. **Text advisory vs authoritative estimate agreement.** `imageEstimatorDivergence` pins exactly this
   for image; the text path has the same divergence (1.5x vs 2.2x) and no test.
3. **The embedding model as a resident** — it registers and takes `runExclusive`, and nothing covers it.
4. **The classifier swap** — the tool-routing model swapping the text model out and back mid-turn.
5. **The active model is never evicted mid-generation**, and TTS is not evicted mid-playback.

## Blocked on a feature that does not exist yet

- A refusal that names its numbers
- A recommendation to lower context, switch policy, or free memory
- Any signal at all from a failed background preload
