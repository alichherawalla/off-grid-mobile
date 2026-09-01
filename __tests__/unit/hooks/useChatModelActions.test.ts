import { mobileChatModelReadiness } from '../../../src/services/modelServices/chatModelReadinessPort';

describe('Mobile chat readiness adapter', () => {
  it('passes a missing selection to the real Shared service without touching a native engine', async () => {
    const service = mobileChatModelReadiness({
      activeModel: null,
      activeModelId: null,
      remote: false,
    });
    await expect(service.ensureReady()).resolves.toEqual({
      ok: false,
      reason: 'no-model-selected',
      forceLoadAllowed: false,
    });
  });

  it('passes an active remote route to the real Shared service as ready', async () => {
    const service = mobileChatModelReadiness({
      activeModel: null,
      activeModelId: 'remote-model',
      remote: true,
    });
    await expect(service.ensureReady()).resolves.toEqual({
      ok: true,
      reloadedForVision: false,
    });
  });
});
