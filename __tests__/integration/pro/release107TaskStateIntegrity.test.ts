import {
  MAX_SYNCED_TASK_VISUAL_STEPS,
  type SyncedTaskRun,
  type SyncedTaskVisualStep,
} from '@offgrid/sync';
import { requestTaskControl } from '../../../pro/tasks/taskControlService';
import {
  useTaskRunStore,
  visualStepsForTask,
} from '../../../pro/tasks/taskRunStore';

const run: SyncedTaskRun = {
  version: 1,
  launchId: 'launch-release-107-integrity',
  requestingDeviceId: 'mobile-release-107',
  taskId: 'task-release-107-integrity',
  conversationId: 'chat-release-107-integrity',
  kind: 'computer_use',
  executionDevice: { id: 'desktop-release-107', name: 'Office Mac' },
  title: 'Send the release update',
  status: 'running',
  progress: [],
  startedAt: 1,
  updatedAt: 1,
};

function step(sequence: number): SyncedTaskVisualStep {
  return {
    version: 1,
    visualStepId: `${run.taskId}:${sequence}`,
    taskId: run.taskId,
    conversationId: run.conversationId,
    sequence,
    executionDevice: run.executionDevice,
    frame: {
      sequence,
      mimeType: 'image/jpeg',
      payloadBase64: 'c2NyZWVu',
      width: 100,
      height: 50,
      capturedAt: sequence * 100,
    },
  };
}

describe('Release 107 Mobile task state integrity', () => {
  beforeEach(() => {
    useTaskRunStore.setState({
      runs: {},
      visualSteps: {},
      requestedControlByTaskId: {},
    });
  });

  it('keeps the newest 250 recorded frames and removes them with their task', () => {
    const store = useTaskRunStore.getState();
    store.applySynced(run);
    for (let sequence = 1; sequence <= 251; sequence += 1) {
      useTaskRunStore.getState().applyVisualStep(step(sequence));
    }

    const saved = visualStepsForTask(
      useTaskRunStore.getState().visualSteps,
      run.taskId,
    );
    expect(saved).toHaveLength(MAX_SYNCED_TASK_VISUAL_STEPS);
    expect(saved[0]?.sequence).toBe(2);
    expect(saved.at(-1)?.sequence).toBe(251);

    useTaskRunStore.getState().remove(run.taskId);
    expect(useTaskRunStore.getState().runs[run.taskId]).toBeUndefined();
    expect(
      visualStepsForTask(useTaskRunStore.getState().visualSteps, run.taskId),
    ).toEqual([]);
  });

  it('rejects a control from a stale rendered task state immediately', async () => {
    useTaskRunStore.getState().applySynced({ ...run, updatedAt: 2 });

    await expect(requestTaskControl(run, 'pause')).rejects.toThrow(
      'This task changed. Wait for its current state and try again.',
    );
  });
});
