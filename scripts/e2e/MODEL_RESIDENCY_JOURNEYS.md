# Model residency journeys (real device)

Three E2E journeys that answer what the jest suite cannot: on a real phone, **which models are
actually in memory, what do they really cost, and what happens when the next one needs the room.**

The jest suite proves the accounting with faked RAM. Only a device can say whether the numbers the
app predicts match the memory it then uses.

| Script | What it drives | Answers |
|---|---|---|
| `model-residency-journey.mjs` | Types "draw …" in a chat | Does an image request load the image model, and behind what? |
| `voice-image-intent-journey.mjs` | **Speaks** "draw …" out loud | The same, with the microphone and STT included |
| `model-eviction-journey.mjs` | Typed turn → spoken turn → image request | What co-resides, and what leaves when contention arrives |

```bash
node scripts/e2e/model-residency-journey.mjs     --ios http://192.168.1.14:8100
node scripts/e2e/voice-image-intent-journey.mjs  --ios http://192.168.1.14:8100 --say "draw a red bicycle"
node scripts/e2e/model-eviction-journey.mjs      --ios http://192.168.1.14:8100
```

Evidence lands in `.artifacts/e2e-flows/<journey>/<runId>/*.json` — every residency reading, with the
RAM the app attributed to each model.

## Speaking to the phone

A physical phone's microphone is hardware. WDA taps and types, devicectl copies files, and neither
can inject audio. So the Mac **says the words out loud** (`say` → `afplay`) and the phone hears them
across the desk. That is not a simulation of the STT path — it is the STT path, microphone included.

Confirmed working end to end: spoken "draw a simple green square robot" → whisper → image intent →
prompt enhancement → a rendered picture, synced to macOS, Windows and Android.

Two requirements: the phone within earshot with the volume up, and the microphone permission already
granted — the first run after a fresh install raises a system prompt that swallows the turn.

## Reading residency

All four rows (`models-row-text|image|voice|speech`) **always render** — a row is the model slot, not
the model. What marks a model as resident is its `-ram` row, which exists only once something is
actually in memory. Reading the rows instead would report every device as fully loaded.

Two device details cost real time and are worth keeping written down:

- The row's composed label starts with an **icon-font glyph** (U+F185 …), not a comma. Anchoring a
  match to `", IMAGE,"` silently never fires, and every reading comes back with no costs in it.
- `tapWhenReady('model-selector')` does **not** open this sheet on iOS; `tapLabel` does. The failure
  looks exactly like an empty residency rather than like a control that was never pressed.

## What the first runs found

On the iPhone, 16 Aug 2026:

```
in memory: image + voice + speech
  text    Qwythos-9B-v2-GGUF                       (selected, NOT resident)
* image   3.6 GB  SD 1.5 Palettized (Core ML)
* voice   0.3 GB  Kokoro TTS · Warm
* speech  0.1 GB  Base

never resident at any stage: text
```

Three models co-reside and hold 4.0 GB. The **selected text model never becomes resident at any
stage** — not for a typed turn, not for a spoken one, not for the image request — while the app still
returns replies and pictures. The matching in-chat message is real and was captured on device:

> Prompt enhancement skipped — Generating from your original prompt — Not enough free memory to load
> this model. Close other apps or choose a smaller model.

That is the memory-estimate work in `docs/GAPS_BACKLOG.md` showing up on a real device, and it is why
these journeys report the resident set rather than only "did a picture appear".
