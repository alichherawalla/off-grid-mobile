import { mobileChatModelReadiness } from '../../../src/services/modelServices/chatModelReadinessPort';
import { ChatModelReadinessService } from '@offgrid/models';

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

  it('loads a local runtime once when the send-time application service first acquires it', async () => {
    let resident = false;
    const load = jest.fn(async () => {
      resident = true;
    });
    const service = new ChatModelReadinessService({
      inspect: () => ({
        remote: false,
        selected: true,
        resident,
        loading: false,
        expectsVision: false,
        visionReady: false,
      }),
      load,
    });

    await expect(service.ensureReady()).resolves.toEqual({
      ok: true,
      reloadedForVision: false,
    });
    await expect(service.ensureReady()).resolves.toEqual({
      ok: true,
      reloadedForVision: false,
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith({ forceReload: false, overrideMemory: false });
  });
});
