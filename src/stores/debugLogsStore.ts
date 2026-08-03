import { create } from 'zustand';

const MAX_IN_MEMORY = 500;

export interface DebugLogEntry {
  timestamp: number;
  level: 'log' | 'warn' | 'error';
  message: string;
}

interface DebugLogsState {
  logs: DebugLogEntry[];
  addLog: (entry: DebugLogEntry) => void;
  clearLogs: () => void;
}

/**
 * How often the buffer is published into the store (ms). Every logged line used to be a
 * zustand state update carrying a freshly-copied 500-element array, so a burst - recovery
 * scanning files at launch, a transcribe batch ticking progress - cost one array copy and one
 * subscriber notification PER LINE. Publishing on a tick instead makes that one copy per
 * interval no matter how many lines arrive, which is what turns the cost from O(lines × buffer)
 * into O(buffer) per tick.
 *
 * 250ms is comfortably faster than anyone can read a scrolling log and slow enough that a
 * thousand-line burst produces a handful of updates rather than a thousand.
 */
const PUBLISH_MS = 250;

/**
 * The live buffer. Writes go here and ONLY here, so a log line costs a push - no allocation,
 * no React work. It is deliberately not the array held in the store: the store needs a fresh
 * reference to trigger a re-render, and minting one per line was the whole problem.
 */
let buffer: DebugLogEntry[] = [];
let publishTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Trim lazily. `shift()` per line would reintroduce an O(buffer) cost on every write, so the
 * buffer is allowed to run up to twice the cap and is then cut back in one splice - amortising
 * the trim across MAX_IN_MEMORY lines.
 */
function pushBounded(entry: DebugLogEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_IN_MEMORY * 2) {
    buffer.splice(0, buffer.length - MAX_IN_MEMORY);
  }
}

/** The newest MAX_IN_MEMORY entries, oldest first - the shape the log screens render. */
function snapshot(): DebugLogEntry[] {
  return buffer.length > MAX_IN_MEMORY ? buffer.slice(-MAX_IN_MEMORY) : [...buffer];
}

export const useDebugLogsStore = create<DebugLogsState>((set) => ({
  logs: [],

  addLog: (entry) => {
    pushBounded(entry);
    // Coalesce: the first line of a burst schedules the publish, the rest are free.
    if (publishTimer) return;
    publishTimer = setTimeout(() => {
      publishTimer = null;
      set({ logs: snapshot() });
    }, PUBLISH_MS);
  },

  clearLogs: () => {
    if (publishTimer) {
      clearTimeout(publishTimer);
      publishTimer = null;
    }
    buffer = [];
    set({ logs: [] });
  },
}));

/**
 * Publish the buffer to the store immediately, skipping the tick.
 *
 * Exists because `addLog` is asynchronous by design: a caller that logs and then reads
 * `getState().logs` in the same tick would see the previous publish. Tests use this, and so
 * should any code that must read its own write synchronously (there is none today). Not a
 * general-purpose escape hatch - calling it per log line would undo the coalescing.
 */
export function flushDebugLogs(): void {
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = null;
  }
  useDebugLogsStore.setState({ logs: snapshot() });
}
