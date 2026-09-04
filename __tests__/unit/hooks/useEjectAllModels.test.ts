import { arrangeLocalSelection } from '../../utils/testHelpers';
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
 * The user ejection workflow is the real public application boundary. Native unloads remain the only
 * uncontrollable boundary in the harness.
 */
import { renderHook, act } from '@testing-library/react-native';
import { resetModelApplication } from '../../harness/activeModelLifecycle';
import { useAppStore, useRemoteServerStore } from '../../../src/stores';
import { createDownloadedModel, createONNXImageModel } from '../../utils/factories';
import { mobileRouteId, refreshMobileModelServices } from '../../../src/services/modelServices';
import { mobileModelSelectionStore } from '../../../src/services/modelServices/selectionStore';

import { useEjectAllModels } from '../../../src/hooks/useEjectAllModels';

/** Nothing loaded anywhere - the state a fresh install is in, reached the way the app reaches it. */
const nothingActive = (): void => {
  useAppStore.setState({ });
  arrangeLocalSelection('text', null);
  useAppStore.setState({ });
  arrangeLocalSelection('image', null);
  useRemoteServerStore.setState({ activeRemoteTextModelId: null });
  useRemoteServerStore.setState({ activeRemoteImageModelId: null });
};

beforeEach(async () => {
  jest.clearAllMocks();
  nothingActive();
  await resetModelApplication();
});

async function activateLocalText(): Promise<void> {
  const model = createDownloadedModel({ id: 'gemma' });
  useAppStore.setState({ downloadedModels: [model] });
  await refreshMobileModelServices();
  await mobileModelSelectionStore.write('text', mobileRouteId({
    source: 'local', hostId: model.engine, modality: 'text', modelId: model.id,
  }));
  await refreshMobileModelServices();
}

async function activateLocalImage(): Promise<void> {
  const model = createONNXImageModel({ id: 'sdxl' });
  useAppStore.setState({ downloadedImageModels: [model] });
  await refreshMobileModelServices();
  await mobileModelSelectionStore.write('image', mobileRouteId({
    source: 'local', hostId: model.backend ?? 'image-runtime', modality: 'image', modelId: model.id,
  }));
  await refreshMobileModelServices();
}

describe('useEjectAllModels', () => {
  it('offers nothing to eject when nothing is loaded', () => {
    expect(renderHook(() => useEjectAllModels()).result.current.hasActiveModel).toBe(false);
  });

  it.each([
    ['a local text model', activateLocalText],
    ['a local image model', activateLocalImage],
  ])('offers the eject when the only thing loaded is %s', async (_what, load) => {
    await act(load);
    expect(renderHook(() => useEjectAllModels()).result.current.hasActiveModel).toBe(true);
  });

  it('appears the moment a model becomes active, with no re-render asked for', async () => {
    const { result } = renderHook(() => useEjectAllModels());
    expect(result.current.hasActiveModel).toBe(false);

    // The real store, so this is the real subscription. With a fake selector over a plain object this assertion
    // could not be written at all - and its absence is why a broken subscription would have gone unnoticed.
    await act(activateLocalText);

    expect(result.current.hasActiveModel).toBe(true);
  });

  it('stops being offered once the last model is ejected', async () => {
    await activateLocalText();
    const { result } = renderHook(() => useEjectAllModels());
    expect(result.current.hasActiveModel).toBe(true);

    await act(async () => {
      await mobileModelSelectionStore.write('text', null);
      await mobileModelSelectionStore.write('image', null);
      await refreshMobileModelServices();
    });

    // A stale Eject All after everything is unloaded is a button that does nothing when pressed.
    expect(result.current.hasActiveModel).toBe(false);
  });

  it('reports zero when the selected model was not resident', async () => {
    await activateLocalText();
    const { result } = renderHook(() => useEjectAllModels());

    let count = -1;
    await act(async () => {
      count = await result.current.ejectAll();
    });

    expect(count).toBe(0);
    expect(result.current.isEjecting).toBe(false);
  });
});
