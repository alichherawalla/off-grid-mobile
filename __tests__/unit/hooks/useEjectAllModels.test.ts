/**
 * useEjectAllModels — the Eject All affordance on Home and in Chat.
 *
 * Two things matter to a user. Whether the button is offered at all, which is a derivation over FOUR independent
 * pieces of state (a local text model, a local image model, and the same two on a remote server) - someone whose
 * only loaded model is a remote image model still has something to eject. And that pressing it delegates to the
 * one owner of the unload, so the count they are shown is the count actually ejected.
 *
 * The REAL stores are used, and reached through their own ACTIONS rather than by writing fields into them. That
 * distinction matters: setActiveModelId is the production write path - activeModelService calls exactly it
 * (index.ts:143,162,227 and loaders.ts:166), as does remoteServerManagerUtils for the remote pair - so a test
 * that calls the action exercises the same transition the app performs. Writing the field with setState would
 * only prove this hook can read a field somebody set, which is a weaker claim and the one an earlier version of
 * this file made.
 *
 * One layer further up is out of reach here and belongs on a device: the gesture that really loads a model runs
 * through the native engine. The line is drawn at the action, which is the last point that is still ours.
 *
 * They were previously stood in for with plain objects behind a fake selector, which cost two things: the
 * derivation ran against invented state, and the fake selector was NOT reactive - so nothing could prove the
 * button appears the moment a model becomes active, which is the entire point of a reactive derivation. Zustand
 * needs no native module (its persistence goes through AsyncStorage, stood in for at the boundary already).
 *
 * The user ejection coordinator is still stood in for: it owns the stop-and-unload journey, and this hook's
 * contract is that it DELEGATES there. Performing native unloads is outside this hook fixture.
 */
import { renderHook, act } from '@testing-library/react-native';
import { useAppStore, useRemoteServerStore } from '../../../src/stores';

const mockEjectAll = jest.fn(async () => ({ count: 2 }));
jest.mock('../../../src/services/userModelEjection', () => ({
  ejectAllModelsForUser: () => mockEjectAll(),
}));

import { useEjectAllModels } from '../../../src/hooks/useEjectAllModels';

/** Nothing loaded anywhere - the state a fresh install is in, reached the way the app reaches it. */
const nothingActive = (): void => {
  const app = useAppStore.getState();
  app.setActiveModelId(null);
  app.setActiveImageModelId(null);
  const remote = useRemoteServerStore.getState();
  remote.setActiveRemoteTextModelId(null);
  remote.setActiveRemoteImageModel(null, null);
};

beforeEach(() => {
  jest.clearAllMocks();
  nothingActive();
});

describe('useEjectAllModels', () => {
  it('offers nothing to eject when nothing is loaded', () => {
    expect(renderHook(() => useEjectAllModels()).result.current.hasActiveModel).toBe(false);
  });

  it.each([
    ['a local text model', (): void => useAppStore.getState().setActiveModelId('gemma')],
    ['a local image model', (): void => useAppStore.getState().setActiveImageModelId('sdxl')],
    [
      'a remote text model',
      (): void => useRemoteServerStore.getState().setActiveRemoteTextModelId('r1'),
    ],
    [
      'a remote image model',
      (): void => useRemoteServerStore.getState().setActiveRemoteImageModel('srv-1', 'r2'),
    ],
  ])('offers the eject when the only thing loaded is %s', (_what, load) => {
    // Each of the four enables it independently. An `||` chain that dropped one would silently strand the user
    // whose only loaded model is that one.
    load();

    expect(renderHook(() => useEjectAllModels()).result.current.hasActiveModel).toBe(true);
  });

  it('appears the moment a model becomes active, with no re-render asked for', () => {
    const { result } = renderHook(() => useEjectAllModels());
    expect(result.current.hasActiveModel).toBe(false);

    // The real store, so this is the real subscription. With a fake selector over a plain object this assertion
    // could not be written at all - and its absence is why a broken subscription would have gone unnoticed.
    act(() => {
      useAppStore.getState().setActiveModelId('gemma');
    });

    expect(result.current.hasActiveModel).toBe(true);
  });

  it('stops being offered once the last model is ejected', () => {
    useAppStore.getState().setActiveModelId('gemma');
    const { result } = renderHook(() => useEjectAllModels());
    expect(result.current.hasActiveModel).toBe(true);

    act(() => {
      nothingActive();
    });

    // A stale Eject All after everything is unloaded is a button that does nothing when pressed.
    expect(result.current.hasActiveModel).toBe(false);
  });

  it('delegates the unload and reports how many were ejected', async () => {
    useAppStore.getState().setActiveModelId('gemma');
    const { result } = renderHook(() => useEjectAllModels());

    let count = -1;
    await act(async () => {
      count = await result.current.ejectAll();
    });

    // Delegated, not reimplemented: the service owns the unload sequence, and the count shown to the user has to
    // be the one it reports rather than a guess made here.
    expect(mockEjectAll).toHaveBeenCalled();
    expect(count).toBe(2);
  });
});
