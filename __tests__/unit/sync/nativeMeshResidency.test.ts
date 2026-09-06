import { NativeModules } from 'react-native';
import { nativeMeshResidencyBoundary } from '../../../src/services/sync/nativeMeshResidency';

interface ResidencyFake {
  begin: jest.Mock<Promise<unknown>, []>;
  end: jest.Mock<Promise<void>, []>;
  state: jest.Mock<Promise<unknown>, []>;
  getConstants: jest.Mock<unknown, []>;
}

/**
 * What the phone can honestly promise about staying reachable in a pocket.
 *
 * Discovery, the listener and in-flight transfers all die when the OS suspends the app, so a "Connected"
 * row is a lie the moment the screen goes off - unless something holds the app awake. Android can hold a
 * dataSync service indefinitely; iOS grants a short grace period and then takes it away.
 *
 * That difference is DATA, reported by each platform, precisely so no screen has to branch on Platform.OS
 * to write honest copy. The failures worth a test are all about the phone over-promising: a missing native
 * module, a module that throws, or a value that is merely truthy rather than true, must all come back as
 * "this device cannot stay reachable" - never as unbounded background.
 */
describe('what the phone promises about staying reachable in the background', () => {
  const native = NativeModules as { MeshResidencyModule?: ResidencyFake };

  const install = (constants: unknown): ResidencyFake => {
    const fake: ResidencyFake = {
      begin: jest.fn(async () => ({ status: 'background' })),
      end: jest.fn(async () => undefined),
      state: jest.fn(async () => ({ status: 'background' })),
      getConstants: jest.fn(() => constants),
    };
    native.MeshResidencyModule = fake;
    return fake;
  };

  afterEach(() => {
    delete native.MeshResidencyModule;
  });

  it('reports unbounded reachability with a visible indicator on the platform that can hold it', () => {
    install({
      survivesBackground: true,
      backgroundGraceSeconds: null,
      showsOngoingIndicator: true,
    });

    expect(nativeMeshResidencyBoundary.capabilities()).toEqual({
      survivesBackground: true,
      // null, not a number: the copy above this reads "stays reachable" rather than counting down.
      backgroundGraceSeconds: null,
      // The user is told, by the OS, that something is running. Claiming otherwise while a notification sits
      // in their shade is the kind of surprise this product does not do.
      showsOngoingIndicator: true,
    });
  });

  it('reports the finite grace the platform actually grants', () => {
    install({
      survivesBackground: false,
      backgroundGraceSeconds: 30,
      showsOngoingIndicator: false,
    });

    // A number the UI can say out loud: reachable for about 30 seconds, then not.
    expect(nativeMeshResidencyBoundary.capabilities()).toEqual({
      survivesBackground: false,
      backgroundGraceSeconds: 30,
      showsOngoingIndicator: false,
    });
  });

  it('reports a platform that grants no grace at all', () => {
    install({
      survivesBackground: false,
      backgroundGraceSeconds: 0,
      showsOngoingIndicator: false,
    });

    // Zero is a real answer and must survive: it means the mesh drops the instant the app leaves the
    // foreground, which is different from an unbounded null.
    expect(
      nativeMeshResidencyBoundary.capabilities().backgroundGraceSeconds,
    ).toBe(0);
  });

  it('promises nothing on a build with no residency module compiled in', () => {
    expect(nativeMeshResidencyBoundary.capabilities()).toEqual({
      survivesBackground: false,
      backgroundGraceSeconds: 0,
      showsOngoingIndicator: false,
    });
  });

  it('promises nothing when asking the platform throws', () => {
    const fake = install(undefined);
    fake.getConstants.mockImplementation(() => {
      throw new Error('the module was not initialised');
    });

    // Reported, not thrown: the mesh still works in the foreground, so a failure here must degrade the
    // promise rather than take the screen down.
    expect(nativeMeshResidencyBoundary.capabilities()).toEqual({
      survivesBackground: false,
      backgroundGraceSeconds: 0,
      showsOngoingIndicator: false,
    });
  });

  it('promises nothing when the platform answers with no constants', () => {
    install(undefined);

    expect(nativeMeshResidencyBoundary.capabilities().survivesBackground).toBe(
      false,
    );
  });

  it.each([
    ['a string', 'true'],
    ['a number', 1],
    ['an object', {}],
  ])(
    'does not treat %s as a promise to survive backgrounding',
    (_label, value) => {
      install({
        survivesBackground: value,
        backgroundGraceSeconds: null,
        showsOngoingIndicator: value,
      });

      // Only a real `true` counts. A bridge that coerced a string would have the UI promise indefinite
      // reachability on a platform that cannot deliver it.
      const capabilities = nativeMeshResidencyBoundary.capabilities();
      expect(capabilities.survivesBackground).toBe(false);
      expect(capabilities.showsOngoingIndicator).toBe(false);
    },
  );

  it.each([
    ['a negative number', -5],
    ['not a number at all', 'thirty'],
    ['infinity', Number.POSITIVE_INFINITY],
    ['not a number', Number.NaN],
    ['missing', undefined],
  ])(
    'treats a grace period of %s as unbounded rather than as a countdown',
    (_label, grace) => {
      install({
        survivesBackground: true,
        backgroundGraceSeconds: grace,
        showsOngoingIndicator: true,
      });

      // Unbounded is the honest reading of a value that cannot be counted down: the UI says "while the
      // service holds" instead of showing a nonsense timer.
      expect(
        nativeMeshResidencyBoundary.capabilities().backgroundGraceSeconds,
      ).toBeNull();
    },
  );

  it('holds and releases reachability through the platform', async () => {
    const fake = install({
      survivesBackground: true,
      backgroundGraceSeconds: null,
      showsOngoingIndicator: true,
    });

    await expect(nativeMeshResidencyBoundary.begin()).resolves.toEqual({
      status: 'background',
    });
    await expect(nativeMeshResidencyBoundary.state()).resolves.toEqual({
      status: 'background',
    });
    await nativeMeshResidencyBoundary.end();

    expect(fake.begin).toHaveBeenCalledTimes(1);
    expect(fake.state).toHaveBeenCalledTimes(1);
    expect(fake.end).toHaveBeenCalledTimes(1);
  });

  it('is safe to hold and release on a build that cannot do either', async () => {
    // No module. Releasing residency that was never held happens on every app close, and a throw there
    // would surface as a crash on backgrounding.
    await expect(nativeMeshResidencyBoundary.begin()).resolves.toEqual({
      status: 'foreground_only',
      reason: 'unavailable',
    });
    await expect(nativeMeshResidencyBoundary.end()).resolves.toBeUndefined();
  });

  it('surfaces a platform refusal to hold reachability', async () => {
    const fake = install({
      survivesBackground: true,
      backgroundGraceSeconds: null,
      showsOngoingIndicator: true,
    });
    fake.begin.mockRejectedValueOnce(
      new Error('Notifications are disabled for this app.'),
    );

    // The caller decides what to tell the user - on Android a dataSync service cannot start without the
    // notification permission, and silently swallowing that would leave the mesh promising reachability it
    // never acquired.
    await expect(nativeMeshResidencyBoundary.begin()).rejects.toThrow(
      'Notifications are disabled for this app.',
    );
  });
});
