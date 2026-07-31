/**
 * RED-FLOW — an iOS memory warning must NOT reclaim the whisper model while it is transcribing.
 *
 * DEVICE EVIDENCE (iPhone XS, /tmp/offgrid-debug.log, 2026-07-30):
 *   04:34:35.460  [Whisper] dispatching native transcribe
 *   04:34:35.460  [mem] transcribe:chunk@0s used=331MB total=3780MB (9%)
 *   04:34:36.349  [ModelResidency] memory warning -> reclaiming idle whisper (whisper)
 *   04:34:36.349  [WhisperService] Stopping in-flight file transcription before unloading model
 *   04:35:28.456  [Whisper] transcribeFile FAILED after 53.0s Error: Code: -999
 * Twice in a row, 0.9s and 0.5s after the transcribe started, at 9% and 5% memory use. The user
 * sees "Failed to transcribe the file. Code: -999" on a clip that never had a chance to run.
 *
 * ROOT: `whisperStore.loadModel` registered the resident with no `canEvict`, so residency's
 * "in use - owner vetoes" branch could never fire for whisper and treated an actively
 * transcribing model as idle. `unloadModel` then cancels the native job to avoid a
 * use-after-free, and whisper.rn reports that cancellation as -999. TTS has had this veto all
 * along; whisper never did.
 *
 * Real stack over the native fakes: the REAL whisperStore -> REAL whisperService -> REAL
 * modelResidencyManager, with only whisper.rn and the filesystem faked. The transcribe is held
 * open (the device-shaped in-flight window) and the REAL AppState memoryWarning is emitted
 * underneath it.
 *
 * Falsify: drop `canEvict` from the register() call in whisperStore and this goes red on the
 * still-resident assertion.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

describe('memory warning during a file transcription', () => {
  it('does not reclaim whisper mid-transcribe (no -999)', async () => {
    const GB = 1024 * 1024 * 1024;
    const boundary = installNativeBoundary({ whisper: true, fs: true });
    boundary.setRam({ platform: 'ios', totalBytes: 4 * GB, availBytes: 3 * GB });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { useWhisperStore } = require('../../../src/stores/whisperStore');
    const { whisperService } = require('../../../src/services/whisperService');
    const { modelResidencyManager } = require('../../../src/services/modelResidency');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // The model is on disk and resident, because the user is about to transcribe with it.
    boundary.fs!.seedDir('/docs/whisper-models');
    // Just over validateModelFile's 10 MB floor, NOT the model's real 487 MB: seedFile does
    // Buffer.alloc(size), so seeding the true size allocates it for real inside the jest worker
    // and starves sibling suites into timing out. Residency sizes the resident from
    // WHISPER_MODELS, not from the file, so only clearing the corruption floor matters here.
    boundary.fs!.seedFile('/docs/whisper-models/ggml-small.en.bin', 11 * 1024 * 1024);
    modelResidencyManager.setBudgetOverrideMB(2000);
    useWhisperStore.setState({ downloadedModelId: 'small.en' });
    const load = await useWhisperStore.getState().loadModel();
    expect(load).toBe('loaded');
    expect(modelResidencyManager.isResident('whisper')).toBe(true);

    // A whole-file transcribe is now in flight and stays in flight, as on device.
    boundary.whisper!.holdNextTranscribe();
    const inFlight = whisperService.transcribeFile('/tmp/clip.wav');
    await Promise.resolve();
    expect(boundary.whisper!.transcribeInFlight()).toBe(true);
    expect(whisperService.isFileTranscribing()).toBe(true);

    // iOS fires a memory warning underneath it - the exact device sequence.
    await boundary.emitMemoryWarning();
    await new Promise((r) => setTimeout(r, 0));

    // The model the job is running on must survive, so the transcription can finish.
    expect(modelResidencyManager.isResident('whisper')).toBe(true);
    expect(boundary.whisper!.transcribeInFlight()).toBe(true);

    // And it does finish, with a real transcript rather than an abort.
    boundary.whisper!.releaseTranscribe();
    await expect(inFlight).resolves.toBeTruthy();
  });
});
