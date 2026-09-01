import {
  ensureModelReady,
  ensureReadyOrAlert,
  modelNotReadyAlert,
  reasonFromLoadError,
} from '../../../src/screens/ChatScreen/modelReadiness';

const base = {
  activeModelInfo: { isRemote: false },
  activeModel: null,
  activeModelId: null,
  setAlertState: jest.fn(),
};

describe('Mobile chat readiness projection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses the canonical Shared failure reason and copy', () => {
    expect(reasonFromLoadError(new Error('insufficient memory'))).toBe('insufficient-memory');
    expect(modelNotReadyAlert('not-downloaded').title).toBe('Model Not Downloaded');
  });

  it('projects the exact outcome from the Shared readiness service', async () => {
    const outcome = {
      ok: false as const,
      reason: 'load-threw' as const,
      detail: 'native load failed',
      forceLoadAllowed: false,
    };
    await expect(ensureModelReady({
      ...base,
      ensureModelLoaded: async () => outcome,
    })).resolves.toEqual(outcome);
  });

  it('presents the Shared memory override and resumes only after a successful force load', async () => {
    const resume = jest.fn();
    const setAlertState = jest.fn();
    await ensureReadyOrAlert({
      ...base,
      setAlertState,
      ensureModelLoaded: async () => ({
        ok: false,
        reason: 'insufficient-memory',
        detail: 'budget refused the load',
        forceLoadAllowed: true,
      }),
      forceLoadModel: async () => ({ ok: true, reloadedForVision: false }),
    }, 'send', resume);

    const alert = setAlertState.mock.calls[0][0];
    expect(alert.title).toBe('Not Enough Memory');
    alert.buttons.find((button: { text: string }) => button.text === 'Load Anyway').onPress();
    await Promise.resolve();
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
