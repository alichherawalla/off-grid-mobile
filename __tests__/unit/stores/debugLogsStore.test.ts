import { useDebugLogsStore, flushDebugLogs } from '../../../src/stores/debugLogsStore';

describe('debugLogsStore', () => {
  beforeEach(() => useDebugLogsStore.getState().clearLogs());

  // addLog is coalesced: it writes to the buffer and publishes on a tick, so a burst costs one
  // array copy instead of one per line. Reading in the same tick therefore needs a flush.
  it('appends log entries in order', () => {
    useDebugLogsStore.getState().addLog({ timestamp: 1, level: 'log', message: 'a' });
    useDebugLogsStore.getState().addLog({ timestamp: 2, level: 'warn', message: 'b' });
    flushDebugLogs();
    expect(useDebugLogsStore.getState().logs.map(l => l.message)).toEqual(['a', 'b']);
  });

  it('caps the buffer at the in-memory limit, dropping the oldest', () => {
    for (let i = 0; i < 520; i++) {
      useDebugLogsStore.getState().addLog({ timestamp: i, level: 'log', message: `m${i}` });
    }
    flushDebugLogs();
    const { logs } = useDebugLogsStore.getState();
    expect(logs.length).toBe(500);
    expect(logs[0].message).toBe('m20'); // oldest 20 dropped
    expect(logs[logs.length - 1].message).toBe('m519'); // newest kept
  });

  it('clearLogs empties the buffer', () => {
    useDebugLogsStore.getState().addLog({ timestamp: 1, level: 'error', message: 'x' });
    useDebugLogsStore.getState().clearLogs();
    expect(useDebugLogsStore.getState().logs).toEqual([]);
  });

  // The point of the change: a burst must not cost one array copy per line. 1000 lines used to
  // mint 1000 arrays (each a 500-element copy) and fire 1000 subscriber notifications; coalesced,
  // the whole burst produces a single publish.
  it('coalesces a burst into ONE store publish', () => {
    const notify = jest.fn();
    const unsub = useDebugLogsStore.subscribe(notify);
    for (let i = 0; i < 1000; i++) {
      useDebugLogsStore.getState().addLog({ timestamp: i, level: 'log', message: `burst${i}` });
    }
    // Nothing published yet - the lines are in the buffer, costing no React work.
    expect(notify).not.toHaveBeenCalled();
    flushDebugLogs();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(useDebugLogsStore.getState().logs.length).toBe(500);
    unsub();
  });

  it('drops the buffer past twice the cap so the trim is amortised, not per line', () => {
    for (let i = 0; i < 1200; i++) {
      useDebugLogsStore.getState().addLog({ timestamp: i, level: 'log', message: `m${i}` });
    }
    flushDebugLogs();
    const { logs } = useDebugLogsStore.getState();
    expect(logs.length).toBe(500);
    expect(logs[logs.length - 1].message).toBe('m1199');
  });
});
