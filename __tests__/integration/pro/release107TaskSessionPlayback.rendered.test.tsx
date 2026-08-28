import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  TASK_RUN_ENTITY,
  TASK_VISUAL_STEP_ENTITY,
  taskVisualStepId,
  type SyncedTaskRun,
  type SyncedTaskVisualStep,
} from '@offgrid/sync';
import { MobileStateMaterializer } from '../../../pro/sync/mobileStateMaterializer';
import { isRequiredSyncEntity } from '../../../pro/sync/actionApprovalSync';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { TaskChatCard } from '../../../pro/ui/TaskChatCard';
import { useChatStore } from '../../../src/stores/chatStore';

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

jest.mock('@react-native-community/slider', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) =>
    require('react').createElement(require('react-native').View, props),
}));

const materializer = new MobileStateMaterializer();
const origin = {
  originDeviceId: 'desktop-session-owner',
  originDeviceName: 'Studio Mac',
};
const FRAME_PAYLOAD = '/9j/2Q==';

function taskRun(
  kind: SyncedTaskRun['kind'],
  status: SyncedTaskRun['status'],
): SyncedTaskRun {
  const taskId = `release-107-session-${kind}-${status}`;
  return {
    version: 1,
    taskId,
    conversationId: `${taskId}-chat`,
    kind,
    executionDevice: { id: origin.originDeviceId, name: 'Studio Mac' },
    title: kind === 'web_use' ? 'Review the site' : 'Review the desktop app',
    status,
    phase:
      status === 'running'
        ? 'acting'
        : status === 'done'
          ? 'complete'
          : status === 'reconnecting'
            ? 'waiting'
          : status,
    progress: [],
    startedAt: 1_000,
    updatedAt: 4_000,
    finishedAt: status === 'running' ? undefined : 4_000,
    ...(status === 'running'
      ? {
          frame: {
            sequence: 3,
            mimeType: 'image/jpeg' as const,
            payloadBase64: FRAME_PAYLOAD,
            width: 100,
            height: 50,
            capturedAt: 4_000,
          },
        }
      : {}),
  };
}

function visualStep(
  run: SyncedTaskRun,
  sequence: number,
): SyncedTaskVisualStep {
  return {
    version: 1,
    visualStepId: taskVisualStepId(run.taskId, sequence),
    taskId: run.taskId,
    conversationId: run.conversationId,
    sequence,
    executionDevice: run.executionDevice,
    phase: sequence === 1 ? 'observing' : 'acting',
    actionLabel: sequence === 1 ? 'Opened the target' : 'Selected Continue',
    cursor: sequence === 2 ? { x: 75, y: 25 } : undefined,
    frame: {
      sequence,
      mimeType: 'image/jpeg',
      payloadBase64: FRAME_PAYLOAD,
      width: 100,
      height: 50,
      capturedAt: 1_000 + sequence * 1_000,
    },
    ...(sequence === 2 ? { result: { status: 'complete' as const } } : {}),
  };
}

function renderSyncedTask(run: SyncedTaskRun): ReturnType<typeof render> {
  // Older immutable records can arrive before the current task projection.
  for (const sequence of [2, 1]) {
    const step = visualStep(run, sequence);
    materializer.put(
      TASK_VISUAL_STEP_ENTITY,
      step.visualStepId,
      step as unknown as Record<string, unknown>,
      origin,
    );
  }
  materializer.put(
    'conversation',
    run.conversationId,
    {
      title: run.title,
      created_at: new Date(run.startedAt).toISOString(),
      updated_at: new Date(run.updatedAt).toISOString(),
      project_id: null,
    },
    origin,
  );
  useChatStore.getState().setActiveConversation(run.conversationId);
  materializer.put(
    TASK_RUN_ENTITY,
    run.taskId,
    run as unknown as Record<string, unknown>,
    origin,
  );
  return render(<TaskChatCard />);
}

function removeSyncedTask(run: SyncedTaskRun): void {
  materializer.remove(TASK_RUN_ENTITY, run.taskId);
  for (const sequence of [1, 2]) {
    materializer.remove(
      TASK_VISUAL_STEP_ENTITY,
      taskVisualStepId(run.taskId, sequence),
    );
  }
}

describe('Release 107 task session playback', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useChatStore.getState().clearAllConversations();
    useSyncStore.getState().setConnectedDeviceIds([origin.originDeviceId]);
  });

  afterEach(() => {
    for (const kind of ['web_use', 'computer_use'] as const) {
      for (const status of ['running', 'done', 'stopped'] as const) {
        removeSyncedTask(taskRun(kind, status));
      }
    }
    jest.useRealTimers();
  });

  it('keeps saved task frames in required state sync', () => {
    expect(isRequiredSyncEntity(TASK_VISUAL_STEP_ENTITY)).toBe(true);
  });

  it.each([
    ['web_use', 'done'],
    ['computer_use', 'stopped'],
  ] as const)(
    'plays and scrubs the preserved %s session after it is %s',
    (kind, status) => {
      const screen = renderSyncedTask(taskRun(kind, status));

      expect(screen.getByTestId('task-session-playback')).toBeTruthy();
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
      expect(screen.getByText('Opened the target')).toBeTruthy();
      expect(screen.queryByTestId('task-control-stop')).toBeNull();

      fireEvent(
        screen.getByTestId('task-session-frame'),
        'layout',
        { nativeEvent: { layout: { width: 300 } } },
      );
      expect(screen.getByLabelText('Saved task screen 1 of 2')).toBeTruthy();

      fireEvent(
        screen.getByTestId('task-session-scrubber'),
        'valueChange',
        1,
      );
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
      expect(screen.getByText('Selected Continue')).toBeTruthy();
      expect(screen.getByTestId('task-session-cursor')).toBeTruthy();

      fireEvent.press(screen.getByTestId('task-session-toggle'));
      expect(screen.getByText('Pause')).toBeTruthy();
      act(() => jest.advanceTimersByTime(1_000));
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
      expect(screen.getByText('Play')).toBeTruthy();
    },
  );

  it.each(['web_use', 'computer_use'] as const)(
    'keeps the live %s frame while saved steps remain reviewable',
    kind => {
      const screen = renderSyncedTask(taskRun(kind, 'running'));

      expect(screen.getByTestId('task-live-frame')).toBeTruthy();
      expect(screen.getByTestId('task-session-playback')).toBeTruthy();
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
      expect(screen.getByTestId('task-control-stop')).toBeTruthy();
    },
  );
});
