/**
 * UI boundary tests only. Shared package coverage owns modality selection,
 * send/replay/edit invalidation, queueing, cancellation, and tool lifecycle:
 * shared/packages/models/test/image-runtime-policy.test.mjs
 * shared/packages/models/test/chat-session.test.mjs
 */
import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';
import {installNativeBoundary} from '../../harness/nativeBoundary';

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

function deps(overrides: Record<string, unknown> = {}): any {
  return {
    hasActiveModel: false,
    setAlertState: jest.fn(),
    ...overrides,
  };
}

describe('chat action UI boundary', () => {
  it('shows model selection when send has no active route', async () => {
    installNativeBoundary({download: true, fs: true});
    const {startMobileApplicationFixture} = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture();
    const {handleSendFn} = require('../../../src/screens/ChatScreen/useChatGenerationActions') as typeof import('../../../src/screens/ChatScreen/useChatGenerationActions');
    const input = deps({
      hasActiveModel: Boolean(fixture.application.models.snapshot().active.text?.model),
    });
    await handleSendFn(input, { text: 'hello', setDebugInfo: jest.fn() });
    expect(input.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'No Model Selected', visible: true }),
    );
  });

  it('projects a project selection and closes the selector', () => {
    const {handleSelectProjectFn} = require('../../../src/screens/ChatScreen/useChatGenerationActions') as typeof import('../../../src/screens/ChatScreen/useChatGenerationActions');
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
