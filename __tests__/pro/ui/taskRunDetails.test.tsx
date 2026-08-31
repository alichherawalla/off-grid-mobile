import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { SyncedTaskRun } from '@offgrid/sync';
import { TaskRunDetails } from '../../../pro/ui/task-card/TaskRunDetails';

const run: SyncedTaskRun = {
  version: 1,
  launchId: 'launch-1',
  requestingDeviceId: 'phone-1',
  taskId: 'task-1',
  conversationId: 'chat-1',
  kind: 'web_use',
  executionDevice: { id: 'desktop-1', name: 'Studio Mac' },
  title: 'Open example.com',
  status: 'running',
  progress: [
    { sequence: 1, label: 'opened https://example.com', at: 1 },
    { sequence: 2, label: 'milestone complete: Open example.com', at: 2 },
  ],
  startedAt: 1,
  updatedAt: 2,
};

describe('TaskRunDetails activity disclosure', () => {
  it('keeps activity collapsed until the user opens it', () => {
    const screen = render(<TaskRunDetails run={run} />);
    const disclosure = screen.getByTestId('task-activity-disclosure');

    expect(disclosure.props.accessibilityState).toEqual({ expanded: false });
    expect(screen.queryByText('opened https://example.com')).toBeNull();
    expect(screen.getByText('2')).toBeTruthy();

    fireEvent.press(disclosure);

    expect(disclosure.props.accessibilityState).toEqual({ expanded: true });
    expect(screen.getByText('opened https://example.com')).toBeTruthy();
    expect(
      screen.getByText('milestone complete: Open example.com'),
    ).toBeTruthy();
  });
});
