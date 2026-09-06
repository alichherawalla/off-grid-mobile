/**
 * Holds stop requests until a realtime native session has either installed its
 * stop handle or failed to start. This closes the async start/stop gap without
 * owning any recording policy.
 */
export class RealtimeStartBarrier {
  private pending: Promise<void> | null = null;
  private settlePending: (() => void) | null = null;

  begin(): void {
    if (this.pending) throw new Error('Realtime transcription is already starting');
    this.pending = new Promise<void>(resolve => {
      this.settlePending = resolve;
    });
  }

  settle(): void {
    const settle = this.settlePending;
    this.settlePending = null;
    this.pending = null;
    settle?.();
  }

  async wait(): Promise<boolean> {
    const pending = this.pending;
    if (!pending) return false;
    await pending;
    return true;
  }
}
