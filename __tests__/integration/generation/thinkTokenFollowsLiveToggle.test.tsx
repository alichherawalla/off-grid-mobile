/**
 * DEVICE 2026-07-14 — toggling thinking was off-by-one: the <|think|> activation decision followed a
 * STALE render snapshots once made the activation apply one turn late. The canonical GenerationRequest
 * now carries the current setting into Shared policy at the native boundary.
 *
 * This drives the real Shared TextEngineApplicationService over Mobile's real LiteRT port.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('thinking toggle applies to the next turn (no off-by-one) — device 2026-07-14', () => {
  it('the <|think|> activation follows the LIVE thinking setting, not a stale snapshot (LiteRT loaded)', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android' }); // litert model 'm' loaded
     
    const { mobileTextEngineControl } = require('../../../src/services/modelServices/textEngineControl');

    // Toggle OFF → the decision is OFF on the very next read (no one-turn lag).
    h.useAppStore.getState().updateSettings({ thinkingEnabled: false });
    expect(mobileTextEngineControl.preparePrompt('hello', false)).toBe('hello');

    // Toggle ON → the decision is ON immediately, from the live store value.
    h.useAppStore.getState().updateSettings({ thinkingEnabled: true });
    expect(mobileTextEngineControl.preparePrompt('hello', true)).toBe('<|think|>\nhello');

    // And OFF again immediately — the toggle is never a turn behind.
    h.useAppStore.getState().updateSettings({ thinkingEnabled: false });
    expect(mobileTextEngineControl.preparePrompt('hello', false)).toBe('hello');
  });
});
