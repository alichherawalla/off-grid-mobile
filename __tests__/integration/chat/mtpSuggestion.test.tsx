/**
 * UI integration — the in-chat offer to turn on MTP speculative decoding.
 *
 * Real card + real store + real detection service + real rule. Only llama.rn's GGUF header read is
 * faked, at the native line, and it serves metadata read off REAL model files: the negative case is
 * the actual key set dumped from the Qwen3.5-0.8B Q4_K_M on the test device, so "no card" is a
 * verdict about a real model rather than an empty object standing in for one.
 *
 * The product rule this pins: the offer appears only for a model that can actually use MTP, says it
 * will reload before you tap, and both enables the setting AND performs the reload when you do.
 * Advertising a speed-up a model cannot deliver is worse than staying quiet.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

/** Verbatim from the device: adb → the GGUF header of Qwen3.5-0.8B-Q4_K_M.gguf. A hybrid
 *  attention/SSM model whose conversion carries NO draft layers. */
const QWEN35_NO_MTP = {
  'general.architecture': 'qwen35',
  'qwen35.block_count': 24,
  'qwen35.context_length': 262144,
  'qwen35.attention.head_count': 8,
  'qwen35.ssm.conv_kernel': 4,
  'qwen35.ssm.state_size': 128,
  'qwen35.full_attention_interval': 4,
};

/** The same model built WITH its multi-token-prediction module: the draft layers are declared. */
const QWEN35_WITH_MTP = { ...QWEN35_NO_MTP, 'qwen35.nextn_predict_layers': 1 };

/** A model that names the concept but ships zero draft layers — nothing to run. */
const QWEN35_ZERO_MTP = { ...QWEN35_NO_MTP, 'qwen35.nextn_predict_layers': 0 };

/** The probe caches its answer per FILE, as it does in the app — a file's metadata cannot change
 *  under us. So each case installs its own model file rather than re-reading one path with
 *  different answers, which no real device would ever do. */
let modelSeq = 0;
/** Enter chat through the real Home selection journey, then let the native GGUF-header boundary
 * answer for that immutable file. All selection, settings, reload, and rendering remain real. */
async function openChatWith(metadata: Record<string, unknown>) {
  const h = await setupChatScreen({
    engine: 'llama',
    modelName: 'Qwen 3.5 0.8B',
    modelFileName: `Qwen3.5-0.8B-Q4_K_M-${++modelSeq}.gguf`,
  });
  h.boundary.llama!.scriptModelInfo(metadata);
  const { loadLlamaModelInfo } = require('llama.rn') as {
    loadLlamaModelInfo: jest.Mock;
  };
  const view = h.render();
  return { h, view, loadLlamaModelInfo };
}

describe('the in-chat MTP offer', () => {
  it('stays silent for a model whose build carries no draft layers', async () => {
    const { h, view, loadLlamaModelInfo } = await openChatWith(QWEN35_NO_MTP);

    // Give the probe a turn to answer, then confirm it answered NO by staying hidden.
    await h.rtl.waitFor(() => {
      expect(loadLlamaModelInfo).toHaveBeenCalled();
    });
    expect(view.queryByTestId('mtp-advice')).toBeNull();
  });

  it('stays silent when the model declares the module but zero layers', async () => {
    const { h, view, loadLlamaModelInfo } = await openChatWith(QWEN35_ZERO_MTP);
    await h.rtl.waitFor(() => {
      expect(loadLlamaModelInfo).toHaveBeenCalled();
    });
    expect(view.queryByTestId('mtp-advice')).toBeNull();
  });

  it('offers it for a model that can use it, and says the model will reload', async () => {
    const { h, view } = await openChatWith(QWEN35_WITH_MTP);

    await h.rtl.waitFor(() => {
      expect(view.queryByTestId('mtp-advice')).not.toBeNull();
    });
    // The reload is stated BEFORE the tap — an unannounced reload mid-conversation reads as a hang.
    expect(view.queryByText(/reload the model/i)).not.toBeNull();
  });

  it('turning it on enables the setting AND reloads, then the offer goes away', async () => {
    const { h, view } = await openChatWith(QWEN35_WITH_MTP);
    const initialLoads = h.boundary.llama!.module.initLlama.mock.calls.length;
    const enable = await h.rtl.waitFor(() =>
      view.getByTestId('mtp-advice-enable'),
    );
    const { useAppStore } =
      require('../../../src/stores') as typeof import('../../../src/stores');

    // BEFORE: the setting is off, so the card is genuinely offering something.
    expect(useAppStore.getState().settings.speculativeDecoding).toBe(false);

    h.rtl.fireEvent.press(enable);

    // The setting the engine reads on its next load...
    await h.rtl.waitFor(() => {
      expect(useAppStore.getState().settings.speculativeDecoding).toBe(true);
    });
    // ...and the reload that makes it take effect, since it is fixed at context creation.
    await h.rtl.waitFor(() => {
      expect(
        h.boundary.llama!.module.initLlama.mock.calls.length,
      ).toBeGreaterThan(initialLoads);
    });
    // Nothing left to offer.
    await h.rtl.waitFor(() => {
      expect(view.queryByTestId('mtp-advice')).toBeNull();
    });
  });

  it('can be dismissed without changing anything', async () => {
    const { h, view } = await openChatWith(QWEN35_WITH_MTP);
    const initialLoads = h.boundary.llama!.module.initLlama.mock.calls.length;
    const dismiss = await h.rtl.waitFor(() =>
      view.getByTestId('mtp-advice-dismiss'),
    );
    const { useAppStore } =
      require('../../../src/stores') as typeof import('../../../src/stores');

    h.rtl.fireEvent.press(dismiss);

    await h.rtl.waitFor(() => {
      expect(view.queryByTestId('mtp-advice')).toBeNull();
    });
    // Dismissing is not consent: the setting is untouched and no reload happened.
    expect(useAppStore.getState().settings.speculativeDecoding).toBe(false);
    expect(h.boundary.llama!.module.initLlama.mock.calls).toHaveLength(
      initialLoads,
    );
  });
});
