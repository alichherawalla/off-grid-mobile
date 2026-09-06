import type { DeviceInfo } from '@offgrid/sync';
import { EntitlementHostBootstrap } from '../../../pro/sync/entitlementHostBootstrap';

const localDevice: DeviceInfo = {
  id: 'phone-1',
  name: 'Phone',
  platform: 'ios',
  version: '1',
  host: '192.168.1.20',
  port: 37878,
};

function options(overrides: {
  createLocalDevice?: () => Promise<DeviceInfo>;
  registerOwner?: jest.Mock;
} = {}) {
  let published: DeviceInfo | null = null;
  const registerOwner = overrides.registerOwner ?? jest.fn(() => jest.fn());
  return {
    registerOwner,
    published: () => published,
    value: {
      localDevice: () => published,
      createLocalDevice:
        overrides.createLocalDevice ??
        jest.fn(async () => ({ ...localDevice })),
      publishLocalDevice: (device: DeviceInfo) => {
        published = device;
      },
      membershipOwner: () => null,
      registerOwner,
      onReconciliationChanged: () => undefined,
      onLocalAdmissionChanged: () => undefined,
      onRegistryChanged: async () => undefined,
    },
  };
}

describe('EntitlementHostBootstrap', () => {
  it('registers the activation owner before full Sync starts', async () => {
    const boundary = options();
    const bootstrap = new EntitlementHostBootstrap(boundary.value);

    await bootstrap.prepare();

    expect(boundary.registerOwner).toHaveBeenCalledTimes(1);
    expect(boundary.published()).toEqual(localDevice);
    expect(bootstrap.current()).toBeTruthy();
  });

  it('shares one owner across concurrent activation and Sync preparation', async () => {
    let finish!: (device: DeviceInfo) => void;
    const createLocalDevice = jest.fn(
      () => new Promise<DeviceInfo>(resolve => (finish = resolve)),
    );
    const boundary = options({ createLocalDevice });
    const bootstrap = new EntitlementHostBootstrap(boundary.value);

    const activationPrepare = bootstrap.prepare();
    const syncStartPrepare = bootstrap.prepare();
    finish({ ...localDevice });

    const [activation, sync] = await Promise.all([
      activationPrepare,
      syncStartPrepare,
    ]);
    expect(activation.host).toBe(sync.host);
    expect(createLocalDevice).toHaveBeenCalledTimes(1);
    expect(boundary.registerOwner).toHaveBeenCalledTimes(1);
  });

  it('does not register an owner after release cancels in-flight preparation', async () => {
    let finish!: (device: DeviceInfo) => void;
    const boundary = options({
      createLocalDevice: () =>
        new Promise<DeviceInfo>(resolve => {
          finish = resolve;
        }),
    });
    const bootstrap = new EntitlementHostBootstrap(boundary.value);

    const preparation = bootstrap.prepare();
    bootstrap.release();
    finish({ ...localDevice });

    await expect(preparation).rejects.toThrow('cancelled');
    expect(boundary.registerOwner).not.toHaveBeenCalled();
    expect(bootstrap.current()).toBeNull();
  });

  it('can retry after local-device preparation fails', async () => {
    const createLocalDevice = jest
      .fn<Promise<DeviceInfo>, []>()
      .mockRejectedValueOnce(new Error('Keychain unavailable'))
      .mockResolvedValueOnce({ ...localDevice });
    const boundary = options({ createLocalDevice });
    const bootstrap = new EntitlementHostBootstrap(boundary.value);

    await expect(bootstrap.prepare()).rejects.toThrow('Keychain unavailable');
    await expect(bootstrap.prepare()).resolves.toMatchObject({
      localDevice,
    });
    expect(createLocalDevice).toHaveBeenCalledTimes(2);
    expect(boundary.registerOwner).toHaveBeenCalledTimes(1);
  });
});
