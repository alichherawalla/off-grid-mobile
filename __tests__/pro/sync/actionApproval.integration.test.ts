import { useComputerApprovalStore } from '../../../pro/mcp/computerApprovalStore';
import { projectNotificationCenter } from '../../../pro/sync/notificationCenter';

const pending = {
  version: 1 as const,
  actionId: 'action-1',
  executionChatId: 'chat-action-1',
  title: 'Generate the proposal deck',
  detail: 'Use the selected source folder.',
  args: { sourceFolder: '/private/source' },
  risk: 'mutate',
  status: 'pending' as const,
  createdAt: 10,
  updatedAt: 10,
};

describe('durable Action approval projection', () => {
  beforeEach(() => useComputerApprovalStore.setState({ pending: [] }));

  it('keeps one request per Action and removes it after the origin publishes the outcome', () => {
    const store = useComputerApprovalStore.getState();
    store.applySynced(pending, 'desktop-origin');
    store.applySynced({ ...pending, title: 'Generate the final proposal deck' }, 'desktop-origin');

    expect(useComputerApprovalStore.getState().pending).toEqual([
      expect.objectContaining({
        actionId: 'action-1',
        title: 'Generate the final proposal deck',
        deviceId: 'desktop-origin',
        synced: expect.objectContaining({ executionChatId: 'chat-action-1' }),
      }),
    ]);
    const notifications = projectNotificationCenter(
      [],
      'all',
      useComputerApprovalStore.getState().pending,
    );
    expect(notifications.badgeCount).toBe(1);
    expect(notifications.items).toContainEqual(
      expect.objectContaining({
        id: 'action-approval:action-1',
        type: 'action-approval',
      }),
    );

    store.applySynced(
      {
        ...pending,
        status: 'executed',
        result: 'Deck created',
        updatedAt: 30,
      },
      'desktop-origin',
    );
    expect(useComputerApprovalStore.getState().pending).toEqual([]);
  });
});
