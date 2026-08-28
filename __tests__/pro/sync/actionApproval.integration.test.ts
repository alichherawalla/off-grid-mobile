import { useActionApprovalStore } from '../../../pro/mcp/actionApprovalStore';
import { projectNotificationCenter } from '../../../pro/sync/notificationCenter';
import { MobileStateMaterializer } from '../../../pro/sync/mobileStateMaterializer';

const pending = {
  version: 1 as const,
  actionId: 'action-1',
  executionChatId: 'chat-action-1',
  title: 'Publish the report',
  detail: 'Use the selected source folder.',
  args: { sourceFolder: '/private/source' },
  risk: 'mutate',
  status: 'pending' as const,
  createdAt: 10,
  updatedAt: 10,
};

const origin = {
  originDeviceId: 'desktop-origin',
  originDeviceName: 'Off Grid AI Desktop',
};

describe('durable non-task Action approval projection', () => {
  beforeEach(() => {
    useActionApprovalStore.getState().remove(pending.actionId);
  });

  it('keeps a non-task Action approval in its general owner', () => {
    const materializer = new MobileStateMaterializer();
    materializer.put('action_approval', pending.actionId, pending, origin);

    expect(useActionApprovalStore.getState().pending).toEqual([
      expect.objectContaining({
        actionId: pending.actionId,
        title: pending.title,
        deviceId: origin.originDeviceId,
        synced: expect.objectContaining({
          executionChatId: pending.executionChatId,
        }),
      }),
    ]);
    expect(projectNotificationCenter([], 'all').items).not.toContainEqual(
      expect.objectContaining({ type: 'task-approval' }),
    );
  });
});
