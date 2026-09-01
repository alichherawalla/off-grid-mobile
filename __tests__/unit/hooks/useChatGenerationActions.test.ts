/**
 * UI boundary tests only. Shared package coverage owns modality selection,
 * send/replay/edit invalidation, queueing, cancellation, and tool lifecycle:
 * shared/packages/models/test/image-runtime-policy.test.mjs
 * shared/packages/models/test/chat-session.test.mjs
 */
import {
  handleSelectProjectFn,
  handleSendFn,
} from '../../../src/screens/ChatScreen/useChatGenerationActions';

jest.mock('../../../src/services/huggingface', () => ({ huggingFaceService: {} }));
jest.mock('../../../src/services/modelServices/bootstrap/modelLibraryBootstrap', () => ({ modelLibrary: {} }));
jest.mock('../../../src/services/modelServices/coordinatedDownloadBridge', () => ({
  coordinatedDownloads: { isAvailable: jest.fn(() => false) },
}));

function deps(overrides: Record<string, unknown> = {}): any {
  return {
    hasActiveModel: false,
    setAlertState: jest.fn(),
    ...overrides,
  };
}

describe('chat action UI boundary', () => {
  it('shows model selection when send has no active route', async () => {
    const input = deps();
    await handleSendFn(input, { text: 'hello', setDebugInfo: jest.fn() });
    expect(input.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'No Model Selected', visible: true }),
    );
  });

  it('projects a project selection and closes the selector', () => {
    const setConversationProject = jest.fn();
    const setShowProjectSelector = jest.fn();
    handleSelectProjectFn(
      {
        activeConversationId: 'conversation-1',
        setConversationProject,
        setShowProjectSelector,
      },
      { id: 'project-1' } as any,
    );
    expect(setConversationProject).toHaveBeenCalledWith('conversation-1', 'project-1');
    expect(setShowProjectSelector).toHaveBeenCalledWith(false);
  });
});
