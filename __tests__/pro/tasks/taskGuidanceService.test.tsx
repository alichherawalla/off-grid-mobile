import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  TASK_GUIDANCE_CHANNEL,
  type SendCommand,
  type SyncEvent,
  type SyncSnapshot,
  type SyncedTaskRun,
} from '@offgrid/sync';
import {
  TaskGuidanceService,
  type TaskGuidanceTransport,
} from '../../../pro/tasks/taskGuidanceService';
import { TaskGuidanceComposer } from '../../../pro/ui/task-card/TaskGuidanceComposer';

jest.mock('react-native-tcp-socket', () => {
  const {
    createNativeTcpBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const {
    createNativeDiscoveryBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

class GuidanceBoundary implements TaskGuidanceTransport {
  sent: SendCommand[] = [];
  listener?: (event: SyncEvent) => void;
  snapshot = (): SyncSnapshot => ({
    self: {
      id: 'phone-1',
      name: 'Phone',
      platform: 'ios',
      version: '1',
      host: 'phone',
      port: 1,
    },
    paired: [],
    discovered: [],
    connections: { 'desktop-1': 'connected' },
    reachabilityFailures: {},
    pairing: null,
    membershipRevocations: [],
    transfers: [],
    transferActivity: { current: [], completed: [] },
    discoverable: false,
    browsing: false,
    discoveryScan: { state: 'idle' },
    running: true,
    service: { state: 'running' },
    lastFailure: null,
  });
  send = async (command: SendCommand) => {
    this.sent.push(command);
    return { ok: true as const, value: undefined };
  };
  events = (listener: (event: SyncEvent) => void) => {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
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
    await Promise.resolve();
    const request = boundary.sent[0];
    expect(request).toMatchObject({
      deviceId: 'desktop-1',
      payload: { kind: 'mutation', channel: TASK_GUIDANCE_CHANNEL },
    });
    expect(request.payload).toMatchObject({
      kind: 'mutation',
      payload: {
        type: 'guidance_request',
        taskId: 'task-1',
        text: 'Use the existing account',
      },
    });
    const guidance =
      request.payload.kind === 'mutation'
        ? (request.payload.payload as { guidanceId: string })
        : undefined;

    boundary.listener?.({
      type: 'mutation_received',
      fromDeviceId: 'other-device',
      channel: TASK_GUIDANCE_CHANNEL,
      payload: {
        version: 1,
        type: 'guidance_result',
        guidanceId: guidance?.guidanceId,
        taskId: 'task-1',
        outcome: 'accepted',
        respondedAt: 3,
      },
    });
    let settled = false;
    pending.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    boundary.listener?.({
      type: 'mutation_received',
      fromDeviceId: 'desktop-1',
      channel: TASK_GUIDANCE_CHANNEL,
      payload: {
        version: 1,
        type: 'guidance_result',
        guidanceId: guidance?.guidanceId,
        taskId: 'task-1',
        outcome: 'accepted',
        respondedAt: 4,
      },
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
    fireEvent.changeText(
      screen.getByTestId('task-guidance-input'),
      'Use the existing account',
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('task-guidance-send'));
      await Promise.resolve();
    });
    const sent = boundary.sent[0].payload;
    const request =
      sent.kind === 'mutation'
        ? (sent.payload as { guidanceId: string })
        : undefined;

    act(() =>
      boundary.listener?.({
        type: 'mutation_received',
        fromDeviceId: 'desktop-1',
        channel: TASK_GUIDANCE_CHANNEL,
        payload: {
          version: 1,
          type: 'guidance_result',
          guidanceId: request?.guidanceId,
          taskId: 'task-1',
          outcome: 'accepted',
          respondedAt: 4,
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getByText('Guidance accepted by Studio Mac.')).toBeTruthy(),
    );
    expect(screen.getByTestId('task-guidance-input').props.value).toBe('');
    service.stop();
  });
});
