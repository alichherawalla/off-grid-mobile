import { useActionApprovalStore } from '../../../pro/mcp/actionApprovalStore';
import { projectNotificationCenter } from '../../../pro/sync/notificationCenter';
import { MobileStateMaterializer } from '../../../pro/sync/mobileStateMaterializer';
import { ComputerApprovalCard } from '../../../pro/ui/ComputerApprovalCard';
import { useChatStore } from '../../../src/stores/chatStore';
import React from 'react';
import { act, render } from '@testing-library/react-native';

const pending = {
  version: 1 as const,
  actionId: 'action-1',
  executionChatId: 'chat-action-1',
  taskKind: 'computer_use' as const,
  title: 'Generate the proposal deck',
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

describe('durable Action approval projection', () => {
  beforeEach(() => {
    useChatStore.getState().clearAllConversations();
    useActionApprovalStore
      .getState()
      .applySynced(
        { ...pending, status: 'executed', updatedAt: 1 },
        'desktop-origin',
      );
  });

  it('keeps one request in its exact synced chat with no separate notification or badge', () => {
    const materializer = new MobileStateMaterializer();
    materializer.put(
      'conversation',
      pending.executionChatId,
      {
        title: pending.title,
        created_at: new Date(10).toISOString(),
        updated_at: new Date(10).toISOString(),
        project_id: null,
      },
      origin,
    );
    materializer.put('action_approval', pending.actionId, pending, origin);
    materializer.put(
      'action_approval',
      pending.actionId,
      { ...pending, title: 'Generate the final proposal deck' },
      origin,
    );

    expect(useActionApprovalStore.getState().pending).toEqual([
      expect.objectContaining({
        actionId: 'action-1',
        title: 'Generate the final proposal deck',
        deviceId: 'desktop-origin',
        synced: expect.objectContaining({ executionChatId: 'chat-action-1' }),
      }),
    ]);
    const notifications = projectNotificationCenter([], 'all');
    expect(notifications.badgeCount).toBe(0);
    expect(notifications.items).not.toContainEqual(
      expect.objectContaining({ type: 'action-approval' }),
    );

    act(() => useChatStore.getState().setActiveConversation('another-chat'));
    const card = render(React.createElement(ComputerApprovalCard));
    expect(card.queryByTestId('computer-approval-card')).toBeNull();

    act(() =>
      useChatStore.getState().setActiveConversation(pending.executionChatId),
    );
    expect(card.getByTestId('computer-approval-card')).toBeTruthy();
    expect(card.getByText('Generate the final proposal deck')).toBeTruthy();
    expect(card.getByText('/private/source')).toBeTruthy();
    expect(card.getByText('Approve')).toBeTruthy();
    expect(card.getByText('Decline')).toBeTruthy();
    expect(card.queryByText('Open chat')).toBeNull();

    act(() =>
      materializer.put(
        'action_approval',
        pending.actionId,
        {
          ...pending,
          status: 'executed',
          result: 'Deck created',
          updatedAt: 30,
        },
        origin,
      ),
    );
    expect(useActionApprovalStore.getState().pending).toEqual([]);
    expect(card.queryByTestId('computer-approval-card')).toBeNull();
  });

  it('uses the canonical task kind for a Web Use approval', () => {
    const materializer = new MobileStateMaterializer();
    materializer.put(
      'conversation',
      pending.executionChatId,
      {
        title: 'Find a flight',
        created_at: new Date(10).toISOString(),
        updated_at: new Date(10).toISOString(),
        project_id: null,
      },
      origin,
    );
    materializer.put(
      'action_approval',
      pending.actionId,
      {
        ...pending,
        taskKind: 'web_use',
        title: 'Find a flight',
      },
      origin,
    );
    act(() =>
      useChatStore.getState().setActiveConversation(pending.executionChatId),
    );

    const card = render(React.createElement(ComputerApprovalCard));
    expect(card.getByText('WEB USE')).toBeTruthy();
    expect(card.getByText('Approve')).toBeTruthy();
    expect(card.getByText('Decline')).toBeTruthy();
  });

  it('does not present a non-task Action approval as Web Use or Computer Use', () => {
    const materializer = new MobileStateMaterializer();
    materializer.put(
      'action_approval',
      pending.actionId,
      {
        ...pending,
        taskKind: undefined,
        title: 'Publish the report',
      },
      origin,
    );
    act(() =>
      useChatStore.getState().setActiveConversation(pending.executionChatId),
    );

    const card = render(React.createElement(ComputerApprovalCard));
    expect(card.queryByTestId('computer-approval-card')).toBeNull();
    expect(card.queryByText('COMPUTER USE')).toBeNull();
    expect(card.queryByText('WEB USE')).toBeNull();
  });
});
