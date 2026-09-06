import { selectedLocalModelId } from '../../utils/testHelpers';
/**
 * RED-FLOW (integration → UI): model selection and runtime residency are separate
 * canonical states. A failed on-demand load keeps the user's selection, but must not
 * project the model as currently loaded.
 *
 * Drives the REAL load path (activeModelService.loadTextModel) over a llama boundary scripted to fail every
 * init attempt, then asserts both the selected identity and the runtime UI outcome.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('load failure preserves selection but clears runtime residency (rendered)', () => {
  it('a text model that fails to load stays selected while the selector shows no loaded model', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' }); // model 'm' loaded, active
     
    const React = require('react');
    const { activeModelService } = require('../../harness/activeModelLifecycle');
    const { llmService } = require('../../../src/services/llm');
    const { ModelSelectorModal } = require('../../../src/components/ModelSelectorModal');
     

    // Pre-condition: 'm' is the active loaded model.
    expect(selectedLocalModelId('text')).toBe('m');

    // Now a reload FAILS on every backend (corrupt file / unsupported arch).
    await activeModelService.unloadTextModel(true);
    h.boundary.llama!.scriptInitFailure();
    await activeModelService.loadTextModel('m').catch(() => {}); // real load path throws → caught

    // Selection remains stable; only runtime residency failed.
    expect(selectedLocalModelId('text')).toBe('m');

    // UI outcome: the selector shows NO currently-loaded model (the user sees no active model).
    const v = h.rtl.render(React.createElement(ModelSelectorModal, {
      visible: true, onClose: () => {}, onSelectModel: () => {}, onUnloadModel: () => {},
      isLoading: false, currentModelPath: llmService.getLoadedModelPath(),
    }));
    await h.rtl.waitFor(() => { expect(v.queryAllByTestId('model-item').length).toBeGreaterThanOrEqual(0); });
    expect(v.queryByTestId('currently-loaded-model')).toBeNull();
  }, 30000);
});
