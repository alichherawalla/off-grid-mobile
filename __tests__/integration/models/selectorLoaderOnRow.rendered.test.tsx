import { arrangeLocalSelection } from '../../utils/testHelpers';
/**
 * UI (rendered) — where the load spinner sits in the model sheet.
 *
 * Two device bugs shaped this, in order, and the rule has to satisfy both at once:
 *
 *   2026-07-14: model A was loaded, the user tapped B, and the spinner appeared on A. Keying it off
 *   "is this row the active model" put it on the row that was NOT being loaded.
 *
 *   2026-07-31: keying it off the row the user TAPPED span for ever. Tapping a row deliberately does
 *   not start a load - it only marks a model, and the load is deferred to the first message - so the
 *   parent's isLoading never turned true and the row went on claiming to load something nothing was
 *   loading.
 *
 * So the spinner is derived from the model service: it appears only while something is actually being
 * loaded, and it appears on the model being loaded. This suite drives the real ModelSelectorModal over
 * the real store, with only the native boundary faked.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

let applicationFixture: import('../../harness/mobileApplicationFixture').MobileApplicationFixture | undefined;
afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = undefined;
});

describe('model selector loader — the spinner follows what is being loaded', () => {
   
  const load = () => {
    installNativeBoundary({
      llama: true,
      fs: true,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    });
    const React = require('react');
    const rtl = requireRTL();
    const { useAppStore } = require('../../../src/stores');
    const { ModelSelectorModal } = require('../../../src/components/ModelSelectorModal');
    const { loadingTextRowId } = require('../../../src/components/ModelSelectorModal/rowState');
    const A = createDownloadedModel({
      id: 'a',
      name: 'Model A',
      engine: 'llama',
      filePath: '/models/a.gguf',
      fileName: 'a.gguf',
    });
    const B = createDownloadedModel({
      id: 'b',
      name: 'Model B',
      engine: 'llama',
      filePath: '/models/b.gguf',
      fileName: 'b.gguf',
    });
    useAppStore.setState({ downloadedModels: [A, B] });
    arrangeLocalSelection('text', 'a');
    return { React, rtl, useAppStore, ModelSelectorModal, loadingTextRowId, A, B };
  };
   

  const props = {
    visible: true,
    onClose: () => {},
    onUnloadModel: () => {},
    isLoading: false,
    currentModelPath: '/models/a.gguf',
  };

  const spinnerIn = (
    rtl: ReturnType<typeof requireRTL>,
    view: { getByTestId: (id: string) => unknown },
    row: string,
  ): unknown =>
    rtl
      .within(view.getByTestId(row) as never)
      .queryByTestId('model-row-loading');

  it('shows no spinner when the user taps a row, because tapping starts no load', async () => {
    const { React, rtl, ModelSelectorModal } = load();
    const { startMobileApplicationFixture } = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    applicationFixture = await startMobileApplicationFixture();
    const onSelectModel = jest.fn();
    const view = rtl.render(
      React.createElement(ModelSelectorModal, { ...props, onSelectModel }),
    );

    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('text-model-row-b')));

    // The tap is recorded - the sheet's job is to mark a model...
    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    // ...and nothing spins, because nothing is loading. A spinner here is the 2026-07-31 bug: the load
    // is deferred to the first message, so a row that started spinning on tap never stopped.
    await rtl.waitFor(() => expect(view.getByTestId('text-model-row-b')).toBeTruthy());
    expect(spinnerIn(rtl, view, 'text-model-row-b')).toBeNull();
    expect(spinnerIn(rtl, view, 'text-model-row-a')).toBeNull();
  });

  it('puts the spinner on the model being loaded, not on the one still resident', () => {
    const { loadingTextRowId } = load();

    // The service is loading B while A is still the resident model - the exact state of the 2026-07-14
    // bug, where the spinner appeared on A because A was the "active" row.
    expect(
      loadingTextRowId(
        { text: { isLoading: true, model: { id: 'b' } } },
        false,
        'a',
      ),
    ).toBe('b');
  });

  it('falls back to the selected model while the service has not named one yet', () => {
    const { loadingTextRowId } = load();

    // A load the parent has begun but the service has not yet attributed to a model. The row the user
    // chose is the best answer available, and it is only used while something really is loading.
    expect(loadingTextRowId({ text: { isLoading: false, model: null } }, true, 'b')).toBe('b');
  });

  it('spins nothing at all while no load is under way', () => {
    const { loadingTextRowId } = load();

    // Both halves must be false. This is the guard that stops a row spinning for ever: no load, no
    // spinner, whatever the user last tapped.
    expect(loadingTextRowId({ text: { isLoading: false, model: { id: 'b' } } }, false, 'b')).toBeNull();
    expect(loadingTextRowId({ text: { isLoading: false, model: null } }, false, null)).toBeNull();
  });

  it('spins the active row when the user reloads the model that is already resident', () => {
    const { loadingTextRowId } = load();

    // Re-loading A: the spinner belongs on A here, which is why the rule cannot simply be "never the
    // active row" - it is "the row being loaded", and sometimes that is the active one.
    expect(loadingTextRowId({ text: { isLoading: true, model: { id: 'a' } } }, false, 'a')).toBe('a');
  });
});
