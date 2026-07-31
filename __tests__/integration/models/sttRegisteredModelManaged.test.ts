/**
 * A registered (non-whisper) STT model is a FULLY MANAGED model — the root-cause fix.
 *
 * `ModelDownloadType` is a closed union with one provider per type, and `sttProvider` was
 * hardwired to whisperService. So a speech model from anywhere else was unmanageable: once
 * downloaded it appeared nowhere, and retry/remove routed to whisper and silently did
 * nothing. Every symptom the user hit ("not in the model list", "not in the Download
 * Manager", "can't delete/retry") traces to that one fact.
 *
 * This drives the REAL `sttProvider` through the REAL `modelDownloadService` and the REAL
 * `downloadStore`. The only thing standing in is the registrant itself — a fake registered
 * exactly the way pro registers Parakeet, so the test proves the SEAM rather than pro's
 * implementation of it. Deliberately core-only: it imports no pro, so it runs in a public
 * clone and adds nothing to the pro-coupling that already burdens __tests__/pro.
 *
 * Falsification: each assertion is paired with the pre-fix behaviour it would have shown
 * (absent from list / whisper called instead of the model).
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

describe('a registered STT model is managed like any other model', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  /** Build a fake registrant that records which of its hooks were invoked. */
  function makeFakeModel(present: boolean) {
    const calls = { download: 0, remove: 0, cancel: 0 };
    return {
      calls,
      spec: {
        id: 'fake-parakeet',
        displayName: 'Fake Parakeet',
        sizeBytes: 661_190_513,
        filesPresent: async () => present,
        download: async () => { calls.download += 1; },
        remove: async () => { calls.remove += 1; },
        cancel: async () => { calls.cancel += 1; },
        attribution: 'Fake model, CC-BY-4.0.',
      },
    };
  }

  it('appears in the STT list once on disk, with its size and remove/cancel capability', async () => {
    installNativeBoundary({ fs: true });
    const { registerSttModel, _clearSttModelsForTesting } =
      require('../../../src/services/modelDownloadService/providers/sttModelRegistry');
    const { sttProvider } = require('../../../src/services/modelDownloadService/providers/sttProvider');
    _clearSttModelsForTesting();

    const fake = makeFakeModel(true);
    registerSttModel(fake.spec);

    const list = await sttProvider.list();
    const row = list.find((d: { id: string }) => d.id === 'stt:fake-parakeet');

    // Pre-fix this was undefined: a completed non-whisper model was neither in-flight nor in
    // whisper's on-disk catalogue, so it existed nowhere the UI could see.
    expect(row).toBeDefined();
    expect(row.name).toBe('Fake Parakeet');
    expect(row.status).toBe('completed');
    expect(row.sizeBytes).toBe(661_190_513);
    // Capabilities come from the hooks actually supplied, so the UI can't render a dead button.
    expect(row.capabilities.remove).toBe(true);
    expect(row.capabilities.cancel).toBe(true);
  });

  it('is absent from the list while its files are not on disk', async () => {
    installNativeBoundary({ fs: true });
    const { registerSttModel, _clearSttModelsForTesting } =
      require('../../../src/services/modelDownloadService/providers/sttModelRegistry');
    const { sttProvider } = require('../../../src/services/modelDownloadService/providers/sttProvider');
    _clearSttModelsForTesting();

    registerSttModel(makeFakeModel(false).spec);
    const list = await sttProvider.list();
    expect(list.find((d: { id: string }) => d.id === 'stt:fake-parakeet')).toBeUndefined();
  });

  it('routes retry to the model, not to whisper', async () => {
    installNativeBoundary({ fs: true });
    const { registerSttModel, _clearSttModelsForTesting } =
      require('../../../src/services/modelDownloadService/providers/sttModelRegistry');
    const { sttProvider } = require('../../../src/services/modelDownloadService/providers/sttProvider');
    const { whisperService } = require('../../../src/services/whisperService');
    _clearSttModelsForTesting();

    const fake = makeFakeModel(false);
    registerSttModel(fake.spec);
    const whisperDownload = jest.spyOn(whisperService, 'downloadModel').mockResolvedValue(undefined);

    await sttProvider.retry('stt:fake-parakeet');
    // retry() fires the re-download without awaiting it (mirroring the whisper path), so let
    // the microtask queue drain before asserting.
    await Promise.resolve();

    expect(fake.calls.download).toBe(1);
    // The bug: this used to be whisperService.downloadModel('fake-parakeet'), which is not a
    // whisper model id — so retry appeared to do nothing at all.
    expect(whisperDownload).not.toHaveBeenCalled();
    whisperDownload.mockRestore();
  });

  it('routes remove to the model (cancelling first), not to whisper', async () => {
    installNativeBoundary({ fs: true });
    const { registerSttModel, _clearSttModelsForTesting } =
      require('../../../src/services/modelDownloadService/providers/sttModelRegistry');
    const { sttProvider } = require('../../../src/services/modelDownloadService/providers/sttProvider');
    const { whisperService } = require('../../../src/services/whisperService');
    _clearSttModelsForTesting();

    const fake = makeFakeModel(true);
    registerSttModel(fake.spec);
    const whisperDelete = jest.spyOn(whisperService, 'deleteModel').mockResolvedValue(undefined);

    await sttProvider.remove('stt:fake-parakeet');

    expect(fake.calls.remove).toBe(1);
    // Cancel runs first so a delete mid-download can't leave the loop writing files back
    // into the directory that was just wiped.
    expect(fake.calls.cancel).toBe(1);
    expect(whisperDelete).not.toHaveBeenCalled();
    whisperDelete.mockRestore();
  });

  it('leaves whisper models on the whisper path', async () => {
    installNativeBoundary({ fs: true });
    const { registerSttModel, _clearSttModelsForTesting } =
      require('../../../src/services/modelDownloadService/providers/sttModelRegistry');
    const { sttProvider } = require('../../../src/services/modelDownloadService/providers/sttProvider');
    const { whisperService } = require('../../../src/services/whisperService');
    _clearSttModelsForTesting();

    const fake = makeFakeModel(true);
    registerSttModel(fake.spec);
    const whisperDelete = jest.spyOn(whisperService, 'deleteModel').mockResolvedValue(undefined);

    // An id that is NOT registered must still reach whisper — the extension must not
    // hijack the existing behaviour.
    await sttProvider.remove('stt:base.en');

    expect(whisperDelete).toHaveBeenCalledWith('base.en');
    expect(fake.calls.remove).toBe(0);
    whisperDelete.mockRestore();
  });
});
