/**
 * Holding the mesh awake is best-effort, and sync must start either way.
 *
 * Android can refuse a foreground-service start outright when the app is in a restricted state (a user who
 * force-stopped it, battery optimisation, a background start the OS declines). A build without the native
 * module can offer nothing at all. Neither is a reason for SYNC to fail: the mesh still works while the app is
 * in the foreground, and the capability the Devices screen renders already tells the user what backgrounding
 * will and will not do.
 *
 * So the behaviour under test is a refusal to propagate: if `holdMeshResidency` rethrows, sync start dies and
 * the user gets no mesh at all - having asked for reachability, they lose the thing that worked.
 *
 * Releasing is the same in reverse. It runs just before the transport is torn down so the ongoing notification
 * never outlives the reachability it promises; by then the process is going away regardless, so a failure there
 * must not stop the teardown half-finished.
 *
 * Faked at the NATIVE module (NativeModules.MeshResidencyModule), the same boundary the existing
 * nativeMeshResidency test uses - the Kotlin/Swift foreground service is the one thing jest cannot run.
 */
import { NativeModules } from 'react-native';

const residency = {
  begin: jest.fn<Promise<unknown>, []>(),
  end: jest.fn<Promise<void>, []>(),
  state: jest.fn<Promise<unknown>, []>(),
  getConstants: jest.fn(() => ({
    survivesBackground: true,
    backgroundGraceSeconds: null,
    showsOngoingIndicator: true,
  })),
};

beforeEach(() => {
  jest.resetModules();
  residency.begin.mockReset().mockResolvedValue({ status: 'background' });
  residency.end.mockReset().mockResolvedValue(undefined);
  residency.state.mockReset().mockResolvedValue({ status: 'background' });
  (NativeModules as unknown as Record<string, unknown>).MeshResidencyModule =
    residency;
});

const policy = (): typeof import('../../../pro/sync/meshResidency') =>
  require('../../../pro/sync/meshResidency');

afterEach(async () => {
  await policy().releaseMeshResidency();
});

describe('holding the mesh awake in the background', () => {
  it('asks the platform to hold it', async () => {
    await policy().holdMeshResidency();

    expect(residency.begin).toHaveBeenCalledTimes(1);
  });

  it('does not fail sync start when the platform refuses to hold it', async () => {
    // Exactly what Android returns from a restricted state - the foreground service is simply not allowed.
    residency.begin.mockRejectedValue(
      new Error('ForegroundServiceStartNotAllowedException'),
    );

    // Resolves. If this rejected, syncService.start would unwind and the user would have NO mesh, foreground
    // included, because the OS declined an optimisation.
    await expect(policy().holdMeshResidency()).resolves.toEqual({
      status: 'foreground_only',
      reason: 'promotion_denied',
    });
  });

  it('does not fail sync start when the native module is missing entirely', async () => {
    delete (NativeModules as unknown as Record<string, unknown>)
      .MeshResidencyModule;

    // An older build, or a platform where nothing implements it. Sync still has to come up.
    await expect(policy().holdMeshResidency()).resolves.toEqual({
      status: 'foreground_only',
      reason: 'unavailable',
    });
  });
});

describe('releasing it again', () => {
  it('asks the platform to release it', async () => {
    await policy().releaseMeshResidency();

    expect(residency.end).toHaveBeenCalledTimes(1);
  });

  it('completes the teardown even when releasing fails', async () => {
    residency.end.mockRejectedValue(new Error('service already stopped'));

    // Teardown continues: the process is going away regardless, and stopping half-way would leave the
    // transport up with the indicator gone - the exact inversion of the promise the indicator makes.
    await expect(policy().releaseMeshResidency()).resolves.toBeUndefined();
  });
});
