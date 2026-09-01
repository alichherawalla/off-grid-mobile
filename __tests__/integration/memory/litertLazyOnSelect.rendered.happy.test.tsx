/**
 * T020 (HAPPY/GUARD, UI integration, HEAVY entry point) — selecting a LiteRT model marks it active WITHOUT
 * loading it into RAM; opening a new chat then prepares it before the first send.
 *
 * The T020 device note ("eager warm on select") is STALE: the app deliberately removed eager-load-on-select
 * (useModelLoading.ts:27-31 — "Selecting a model only MARKS it active … Loading eagerly here used to race
 * that path and leave both a text and an image model resident at the same time") in favour of the lazy load
 * the user asked for (DEVICE_TEST_FINDINGS: "Lazy model loading — model loads on first send, not on select
 * ('exactly the lazy model loading I wanted')"). This guard protects that decision from regressing back to
 * eager warm on selection (which re-introduces the co-residency race). A new chat is an explicit request
 * to use the selected model, so its preparation is allowed to begin when ChatScreen mounts.
 *
 * Residency is validated through the model selector's real "In Memory" section (same as T111–T117), not
 * getResidents(). Falsify: if select eager-loaded, models-row-text-ram would be present BEFORE any send.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T020 (rendered) — LiteRT selection is lazy and new chat prepares it', () => {
  it('is NOT in memory after selection, then IS in memory when the new chat opens', async () => {
    // deferInitialLoad: leave the model in the real select-but-not-loaded state (no forced pre-load).
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', deferInitialLoad: true });
    const React = require('react');
    const { ModelsManagerSheet } = require('../../../src/components/models/ModelsManagerSheet');
     
    const openSelector = () => h.rtl.render(React.createElement(ModelsManagerSheet, {
      visible: true, onClose: () => {}, labels: { text: '—', image: '—', voice: '—', speech: '—' },
      loadingState: { isLoading: false }, isEjecting: false, hasActiveModel: false,
      onOpenRow: () => {}, onEject: () => {},
    }));

    // The LiteRT model was SELECTED via the real Home picker (setupChatScreen) but never sent to — so it is
    // NOT eager-warmed. The In Memory section shows no text model. (Poll a beat: the section polls residents.)
    const before = openSelector();
    await h.settle(400);
    expect(before.queryByTestId('models-row-text-ram')).toBeNull();
    before.unmount();

    // Opening the new chat is the first explicit request to use this model. The real ChatScreen
    // preparation path loads it before the first message.
    h.render();
    const prepared = openSelector();
    await h.rtl.waitFor(() => {
      expect(prepared.queryByTestId('models-row-text-ram')).not.toBeNull();
    }, { timeout: 4000 });
    prepared.unmount();

    // The prepared model serves the first send through the real generation path.
    await h.send('hello', { content: 'Hi there.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi there\./)).not.toBeNull(); });
  });
});
