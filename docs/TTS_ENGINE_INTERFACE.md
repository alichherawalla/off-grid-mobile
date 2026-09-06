# Mobile TTS engine boundary

## Current runtime

Kokoro through `react-native-executorch` is the only registered and supported Mobile
text-to-speech runtime.

Shared voice selection, generation, download, and residency policy belongs to
`@offgrid/models`. Mobile Pro owns the native Kokoro/ExecuTorch adapter and the React bridge that
connects the hook-based runtime to the shared ports.

## Architecture

```text
@offgrid/models voice services
  -> Mobile Pro voice ports
    -> EngineRegistry<TTSEngine>
      -> KokoroEngine
        -> KokoroTTSBridge
          -> react-native-executorch
```

The shared layer owns decisions and state transitions. The Mobile layer performs native work and
projects state to the UI. A screen, hook, or store must not select a voice runtime, calculate a
residency action, or implement a download fallback.

## Native engine lifecycle

```text
register -> activate -> initialize -> speak/stop/pause -> release
```

- `EngineRegistry<TTSEngine>` owns the native engine instance.
- `KokoroTTSBridge` mounts `useTextToSpeech` and supplies the imperative native handle.
- The voice application service uses the shared control plane and calls the injected native port.
- Engine events are projected to the Mobile store and UI.
- Release frees the native runtime and its residency lease.

## Key files

- `pro/audio/engine/types.ts` — native engine contracts
- `pro/audio/engine/index.ts` — Kokoro registration and native registry
- `pro/audio/engine/tts/engines/kokoro/` — Kokoro adapter and bridge
- `pro/audio/ttsControlService.ts` — shared voice control-plane composition
- `pro/audio/voiceGenerationPort.ts` — native generation port
- `pro/audio/ttsDownloadProvider.ts` — native download port
- `pro/audio/ttsResidency.ts` — native residency port

## Adding a runtime

Add a new runtime only when it is a real supported product path. Implement the existing native
engine and shared port contracts. Do not add a new caller-side policy, store authority, or parallel
state machine. Add shared contract tests and native adapter tests before registration.
