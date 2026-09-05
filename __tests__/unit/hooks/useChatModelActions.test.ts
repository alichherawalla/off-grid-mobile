import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';
import {installNativeBoundary} from '../../harness/nativeBoundary';

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

async function startApplication(): Promise<void> {
  installNativeBoundary({download: true, fs: true});
  const {startMobileApplicationFixture} = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  fixture = await startMobileApplicationFixture();
}

describe('Mobile chat readiness adapter', () => {
  it('passes a missing selection to the real Shared service without touching a native engine', async () => {
    await startApplication();
    const {mobileChatModelReadiness} = require('../../../src/services/modelServices/chatModelReadinessPort') as typeof import('../../../src/services/modelServices/chatModelReadinessPort');
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
    await startApplication();
    const {mobileChatModelReadiness} = require('../../../src/services/modelServices/chatModelReadinessPort') as typeof import('../../../src/services/modelServices/chatModelReadinessPort');
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
    const {ChatModelReadinessService} = require('@offgrid/models') as typeof import('@offgrid/models');
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
