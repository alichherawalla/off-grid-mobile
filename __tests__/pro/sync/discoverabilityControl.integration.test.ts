import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeSync } from '../../../src/services/sync/nativeSync';
import { discoverabilityControl } from '../../../pro/sync/discoverabilityControl';
import { DiscoverabilityPreference } from '../../../pro/sync/discoverabilityPreference';
import { useSyncStore } from '../../../pro/sync/syncStore';

class DiscoverabilityRuntimeBoundary {
  readonly calls: boolean[] = [];
  current = true;
  failure: Error | undefined;

  async setDiscoverable(next: boolean): Promise<boolean> {
    this.calls.push(next);
    if (this.failure) throw this.failure;
    this.current = next;
    return this.current;
  }

  isDiscoverable(): boolean {
    return this.current;
  }
}

describe('discoverability state follows the native result', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await discoverabilityControl.hydrate(true);
    discoverabilityControl.bind(() => null);
  });

  afterEach(() => jest.restoreAllMocks());

  it('keeps UI and storage on the last true state when native stop fails, then retries', async () => {
    const runtime = new DiscoverabilityRuntimeBoundary();
    await new DiscoverabilityPreference().set(true);
    await discoverabilityControl.hydrate(true);
    discoverabilityControl.bind(() => runtime as unknown as NativeSync);
    runtime.failure = new Error('iOS is still advertising.');

    await expect(discoverabilityControl.set(false)).rejects.toThrow(
      'iOS is still advertising.',
    );

    expect(runtime.current).toBe(true);
    expect(useSyncStore.getState()).toMatchObject({
      discoverable: true,
      discoverablePending: false,
    });
    await expect(
      new DiscoverabilityPreference().load(),
    ).resolves.toBe(true);

    runtime.failure = undefined;
    await expect(discoverabilityControl.set(false)).resolves.toBe(false);
    expect(runtime.current).toBe(false);
    expect(useSyncStore.getState()).toMatchObject({
      discoverable: false,
      discoverablePending: false,
    });
    await expect(
      new DiscoverabilityPreference().load(),
    ).resolves.toBe(false);
    expect(runtime.calls).toEqual([false, false]);
  });

  it('rolls native back when persistence fails, then applies the next retry', async () => {
    const runtime = new DiscoverabilityRuntimeBoundary();
    await new DiscoverabilityPreference().set(true);
    await discoverabilityControl.hydrate(true);
    discoverabilityControl.bind(() => runtime as unknown as NativeSync);
    jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('Storage is unavailable.'));

    await expect(discoverabilityControl.set(false)).rejects.toThrow(
      'Storage is unavailable.',
    );

    expect(runtime.current).toBe(true);
    expect(runtime.calls).toEqual([false, true]);
    expect(useSyncStore.getState()).toMatchObject({
      discoverable: true,
      discoverablePending: false,
    });
    await expect(
      new DiscoverabilityPreference().load(),
    ).resolves.toBe(true);

    await expect(discoverabilityControl.set(false)).resolves.toBe(false);
    expect(runtime.current).toBe(false);
    expect(runtime.calls).toEqual([false, true, false]);
  });
});
