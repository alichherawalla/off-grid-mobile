/**
 * RED-FLOW (integration) — V4: deleting a TTS model leaves residency accounting stale.
 *
 * Deleting native voice assets must also unload the canonical Shared residency entry.
 * Otherwise a phantom voice resident can wrongly refuse or evict a later text/image load.
 * This runs the real deleteModels and residency manager; a minimal fake TTS engine
 * stands in for the native model boundary.
 */
import { modelResidencyManager } from '@offgrid/core/services/modelServices/residencyBootstrap';
import { ttsRegistry } from '../../../pro/audio/engine';
import { deleteModels } from '../../../pro/audio/ttsDownloadActions';
import { voiceResidentSpec } from '../../../pro/audio/ttsResidency';

const fakeEngine = {
  id: 'faketts',
  release: async () => {},
  deleteAssets: async () => {},
  checkAssetStatus: async () => [],
  getRequiredAssets: () => [],
  capabilities: { peakRamMB: 320 },
} as unknown as never;

describe('V4 — deleting TTS leaves residency stale (red-flow)', () => {
  it('releases the TTS residency when the TTS model is deleted', async () => {
    modelResidencyManager._reset();
    ttsRegistry.register('faketts', () => fakeEngine);
    await ttsRegistry.setActiveEngine('faketts');

    // TTS is loaded → registered as a resident (~320MB), as pro/audio/index.ts does on init.
    const spec = voiceResidentSpec(fakeEngine);
    const lease = await modelResidencyManager.acquire(spec, { load: async () => {}, unload: async () => {} });
    await lease.release();
    expect(modelResidencyManager.isResident(spec.key)).toBe(true); // precondition

    // User deletes the TTS model in the Download Manager.
    await deleteModels({ set: () => {}, get: () => ({}) } as unknown as never);

    // The residency is unloaded, so its RAM stops counting against later loads.
    expect(modelResidencyManager.isResident(spec.key)).toBe(false);
  });
});
