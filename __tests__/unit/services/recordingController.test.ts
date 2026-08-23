/**
 * recordingController — the single owner of the record lifecycle. These lock in
 * the contract every mic depends on: toggle() decides from the authoritative
 * phase (so a second tap STOPS instead of starting a second recording — the hero
 * tap-to-stop bug), intents are guarded by phase, and subscribers see transitions.
 */
import { recordingController } from '../../../src/services/recordingController';
import { voiceSession } from '../../../src/services/voiceSession';

const handlers = () => ({ start: jest.fn(), stop: jest.fn(), cancel: jest.fn() });

// BOTH, every test. The controller derives its phase from the session and stores none of its own, so
// resetting only the controller left the previous test's session state standing - and a `start()` that
// is guarded on `idle` silently did nothing.
beforeEach(() => {
  recordingController._reset();
  voiceSession._resetForTesting();
});

describe('recordingController', () => {
  it('toggle() starts when idle', () => {
    const h = handlers();
    recordingController.registerHandlers(h);
    recordingController.toggle();
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('toggle() stops when recording (does not start a second recording)', () => {
    const h = handlers();
    recordingController.registerHandlers(h);
    (voiceSession.dispatch('userStart'), voiceSession.dispatch('speechHeard'));
    recordingController.toggle();
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(h.start).not.toHaveBeenCalled();
  });

  it('toggle() is a no-op while transcribing (the stop already happened)', () => {
    const h = handlers();
    recordingController.registerHandlers(h);
    // Arrive the way a person does: begin, speak, then the turn is captured. `turnCaptured` on its own
    // is not a route into transcribing - it only used to look like one because the previous test's
    // session was still standing.
    voiceSession.dispatch('userStart');
    voiceSession.dispatch('speechHeard');
    voiceSession.dispatch('turnCaptured');
    recordingController.toggle();
    expect(h.start).not.toHaveBeenCalled();
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('start() only fires from idle; stop() only fires while recording', () => {
    const h = handlers();
    recordingController.registerHandlers(h);
    recordingController.stop(); // not recording → ignored
    expect(h.stop).not.toHaveBeenCalled();
    recordingController.start();
    expect(h.start).toHaveBeenCalledTimes(1);
    (voiceSession.dispatch('userStart'), voiceSession.dispatch('speechHeard'));
    recordingController.start(); // already recording → ignored
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers on phase transitions only', () => {
    const seen: string[] = [];
    recordingController.subscribe((p) => seen.push(p));
    (voiceSession.dispatch('userStart'), voiceSession.dispatch('speechHeard'));
    (voiceSession.dispatch('userStart'), voiceSession.dispatch('speechHeard')); // no change → no notify
    voiceSession.dispatch('turnCaptured');
    voiceSession.dispatch('userStop');
    // FOUR. `userStart` opens the microphone before anyone has spoken ('listening'); `speechHeard` then
    // moves the phase to 'recording' without moving the state, and a surface has to be told, or the
    // hero says "Listening" over a turn that is being recorded.
    expect(seen).toEqual(['listening', 'recording', 'transcribing', 'idle']);
  });

  it('unregister stops a stale recorder from receiving intents', () => {
    const h = handlers();
    const unregister = recordingController.registerHandlers(h);
    unregister();
    recordingController.toggle();
    expect(h.start).not.toHaveBeenCalled();
  });

  it('exposes isRecording from the authoritative phase', () => {
    expect(recordingController.isRecording()).toBe(false);
    (voiceSession.dispatch('userStart'), voiceSession.dispatch('speechHeard'));
    expect(recordingController.isRecording()).toBe(true);
  });
});
