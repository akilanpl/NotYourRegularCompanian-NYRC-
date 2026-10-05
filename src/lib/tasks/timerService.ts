export type TimerStatus = "running" | "completed" | "cancelled";

export type TimerSnapshot = Readonly<{
  id: string;
  label: string;
  createdAt: string;
  endsAt: string;
  remainingMs: number;
  status: TimerStatus;
}>;

export type TimerCompletionListener = (timer: TimerSnapshot) => void;

export type TimerServiceErrorCode =
  | "invalid_duration"
  | "timer_not_found"
  | "timer_not_active";

export class TimerServiceError extends Error {
  constructor(
    readonly code: TimerServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TimerServiceError";
  }
}

export const MAX_TIMER_DURATION_MS = 2_147_000_000;

export type TimerScheduler = {
  set(callback: () => void, delayMs: number): () => void;
};

type TimerEntry = {
  id: string;
  label: string;
  createdAtMs: number;
  endsAtMs: number;
  status: TimerStatus;
  cancelSchedule: (() => void) | null;
};

const DEFAULT_SCHEDULER: TimerScheduler = {
  set: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};

/** Session-only local timers; entries are intentionally not persisted. */
export class TimerService {
  private readonly timers = new Map<string, TimerEntry>();
  private readonly listeners = new Set<TimerCompletionListener>();
  private nextId = 1;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly scheduler: TimerScheduler = DEFAULT_SCHEDULER,
  ) {}

  create(durationMs: number, label = "Timer"): TimerSnapshot {
    if (
      !Number.isSafeInteger(durationMs) ||
      durationMs <= 0 ||
      durationMs > MAX_TIMER_DURATION_MS
    ) {
      throw new TimerServiceError(
        "invalid_duration",
        `Timer duration must be an integer between 1 and ${MAX_TIMER_DURATION_MS} ms`,
      );
    }

    const createdAtMs = this.now();
    const id = `timer-${this.nextId++}`;
    const entry: TimerEntry = {
      id,
      label: normalizeLabel(label),
      createdAtMs,
      endsAtMs: createdAtMs + durationMs,
      status: "running",
      cancelSchedule: null,
    };
    entry.cancelSchedule = this.scheduler.set(() => this.complete(entry), durationMs);
    this.timers.set(id, entry);
    return snapshot(entry, createdAtMs);
  }

  list(): TimerSnapshot[] {
    this.completeExpired();
    const now = this.now();
    return [...this.timers.values()]
      .filter((timer) => timer.status === "running")
      .map((timer) => snapshot(timer, now));
  }

  remaining(timerId: string): number {
    const timer = this.requireTimer(timerId);
    if (timer.status !== "running") return 0;
    const remainingMs = Math.max(0, timer.endsAtMs - this.now());
    if (remainingMs === 0) this.complete(timer);
    return remainingMs;
  }

  cancel(timerId: string): TimerSnapshot {
    const timer = this.requireTimer(timerId);
    if (timer.status !== "running") {
      throw new TimerServiceError("timer_not_active", `Timer ${timerId} is not active`);
    }
    timer.cancelSchedule?.();
    timer.status = "cancelled";
    return snapshot(timer, this.now());
  }

  subscribe(listener: TimerCompletionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      if (timer.status === "running") {
        timer.cancelSchedule?.();
      }
    }
    this.timers.clear();
    this.listeners.clear();
  }

  private requireTimer(timerId: string): TimerEntry {
    const timer = this.timers.get(timerId);
    if (!timer) {
      throw new TimerServiceError("timer_not_found", `Timer ${timerId} was not found`);
    }
    return timer;
  }

  private completeExpired(): void {
    const now = this.now();
    for (const timer of this.timers.values()) {
      if (timer.status === "running" && timer.endsAtMs <= now) this.complete(timer);
    }
  }

  private complete(timer: TimerEntry): void {
    if (timer.status !== "running") return;
    timer.status = "completed";
    const result = snapshot(timer, this.now());
    for (const listener of this.listeners) {
      try {
        listener(result);
      } catch (error) {
        console.warn("timer completion listener error", error);
      }
    }
  }
}

function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : "Timer";
}

function snapshot(timer: TimerEntry, now: number): TimerSnapshot {
  return {
    id: timer.id,
    label: timer.label,
    createdAt: new Date(timer.createdAtMs).toISOString(),
    endsAt: new Date(timer.endsAtMs).toISOString(),
    remainingMs:
      timer.status === "running" ? Math.max(0, timer.endsAtMs - now) : 0,
    status: timer.status,
  };
}
