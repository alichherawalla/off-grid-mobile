import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { TASK_GUIDANCE_CHANNEL, type SyncedTaskRun } from '@offgrid/sync';
import {
  TaskGuidanceService,
  type TaskGuidanceTransport,
} from '../../../pro/tasks/taskGuidanceService';
import { TaskGuidanceComposer } from '../../../pro/ui/task-card/TaskGuidanceComposer';

jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

class GuidanceBoundary implements TaskGuidanceTransport {
  sent: Array<{ deviceId: string; channel: string; data: any }> = [];
  appListener?: (deviceId: string, channel: string, data: unknown) => void;
  disconnectedListener?: (deviceId: string) => void;
  thisDeviceId = () => 'phone-1';
  connectedDeviceIds = () => ['desktop-1'];
  sendApp = (deviceId: string, channel: string, data: unknown): boolean => {
    this.sent.push({ deviceId, channel, data });
    return true;
  };
  onAppMessage = (listener: (deviceId: string, channel: string, data: unknown) => void) => {
    this.appListener = listener;
    return () => { this.appListener = undefined; };
  };
  onDisconnected = (listener: (deviceId: string) => void) => {
    this.disconnectedListener = listener;
    return () => { this.disconnectedListener = undefined; };
  };
}

const run: SyncedTaskRun = {
  version: 1,
  launchId: 'launch-1',
  requestingDeviceId: 'phone-1',
  taskId: 'task-1',
  conversationId: 'chat-1',
  kind: 'web_use',
  executionDevice: { id: 'desktop-1', name: 'Studio Mac' },
  title: 'Find a flight',
  status: 'running',
  progress: [],
  startedAt: 1,
  updatedAt: 2,
};

describe('ephemeral Mobile task guidance', () => {
  it('sends guidance outside StateSync and accepts only the execution Desktop acknowledgement', async () => {
    const boundary = new GuidanceBoundary();
    const service = new TaskGuidanceService(boundary);
    service.start();
    const pending = service.send(run, 'Use the existing account');
    const request = boundary.sent[0];
    expect(request).toMatchObject({ deviceId: 'desktop-1', channel: TASK_GUIDANCE_CHANNEL });
    expect(request.data).toMatchObject({
      type: 'guidance_request',
      taskId: 'task-1',
      text: 'Use the existing account',
    });

    boundary.appListener?.('other-device', TASK_GUIDANCE_CHANNEL, {
      version: 1,
      type: 'guidance_result',
      guidanceId: request.data.guidanceId,
      taskId: 'task-1',
      outcome: 'accepted',
      respondedAt: 3,
    });
    let settled = false;
    pending.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    boundary.appListener?.('desktop-1', TASK_GUIDANCE_CHANNEL, {
      version: 1,
      type: 'guidance_result',
      guidanceId: request.data.guidanceId,
      taskId: 'task-1',
      outcome: 'accepted',
      respondedAt: 4,
    });
    await expect(pending).resolves.toMatchObject({ outcome: 'accepted' });
    service.stop();
  });

  it('renders the privacy boundary and clears guidance only after Desktop accepts it', async () => {
    const boundary = new GuidanceBoundary();
    const service = new TaskGuidanceService(boundary);
    service.start();
    const screen = render(<TaskGuidanceComposer run={run} service={service} />);
    expect(screen.getByText(/not saved in synced task history/)).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('task-guidance-input'), 'Use the existing account');
    fireEvent.press(screen.getByTestId('task-guidance-send'));
    const request = boundary.sent[0].data;

    act(() => boundary.appListener?.('desktop-1', TASK_GUIDANCE_CHANNEL, {
      version: 1,
      type: 'guidance_result',
      guidanceId: request.guidanceId,
      taskId: 'task-1',
      outcome: 'accepted',
      respondedAt: 4,
    }));

    await waitFor(() => expect(screen.getByText('Guidance accepted by Studio Mac.')).toBeTruthy());
    expect(screen.getByTestId('task-guidance-input').props.value).toBe('');
    service.stop();
  });
});
