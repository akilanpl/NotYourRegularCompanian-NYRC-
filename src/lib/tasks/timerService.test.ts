import { describe, expect, it } from "vitest";
import {
  MAX_TIMER_DURATION_MS,
  TimerService,
  TimerServiceError,
  type TimerScheduler,
} from "./timerService";

class FakeTime {
  nowMs = 1_800_000_000_000;
  private nextHandle = 1;
  private readonly jobs = new Map<number, { at: number; callback: () => void }>();

  readonly scheduler: TimerScheduler = {
    set: (callback, delayMs) => {
      const handle = this.nextHandle++;
      this.jobs.set(handle, { at: this.nowMs + delayMs, callback });
      return () => {
        this.jobs.delete(handle);
      };
    },
  };

  advance(ms: number): void {
    this.nowMs += ms;
    const due = [...this.jobs.entries()].filter(([, job]) => job.at <= this.nowMs);
    for (const [handle, job] of due) {
      this.jobs.delete(handle);
      job.callback();
    }
  }
}

describe("TimerService", () => {
  it("creates, lists, and reports remaining time for session timers", () => {
    const time = new FakeTime();
    const timers = new TimerService(() => time.nowMs, time.scheduler);
    const created = timers.create(5_000, "Tea");
    expect(created).toMatchObject({
      id: "timer-1",
      label: "Tea",
      remainingMs: 5_000,
      status: "running",
    });
    time.advance(1_500);
    expect(timers.remaining(created.id)).toBe(3_500);
    expect(timers.list()).toHaveLength(1);
  });

  it("expires a timer exactly once and reports a completed snapshot", () => {
    const time = new FakeTime();
    const timers = new TimerService(() => time.nowMs, time.scheduler);
    const completed: string[] = [];
    timers.subscribe((timer) => completed.push(`${timer.label}:${timer.status}`));
    const timer = timers.create(5_000, "Focus");
    time.advance(5_000);
    expect(completed).toEqual(["Focus:completed"]);
    expect(timers.list()).toEqual([]);
    expect(timers.remaining(timer.id)).toBe(0);
    expect(completed).toHaveLength(1);
  });

  it("tracks multiple timers independently and cancels one", () => {
    const time = new FakeTime();
    const timers = new TimerService(() => time.nowMs, time.scheduler);
    const first = timers.create(5_000, "Short");
    const second = timers.create(10_000, "Long");
    const cancelled = timers.cancel(first.id);
    expect(cancelled.status).toBe("cancelled");
    expect(timers.list().map(({ id }) => id)).toEqual([second.id]);
    time.advance(10_000);
    expect(timers.list()).toEqual([]);
  });

  it("rejects invalid, fractional, and excessive timer durations", () => {
    const timers = new TimerService();
    for (const duration of [0, -1, NaN, Infinity, 1.5, MAX_TIMER_DURATION_MS + 1]) {
      expect(() => timers.create(duration)).toThrow(TimerServiceError);
    }
    timers.dispose();
  });

  it("reports missing and duplicate cancellations with distinct errors", () => {
    const timers = new TimerService();
    expect(() => timers.cancel("unknown")).toThrowError(
      expect.objectContaining({ code: "timer_not_found" }),
    );
    const timer = timers.create(60_000);
    timers.cancel(timer.id);
    expect(() => timers.cancel(timer.id)).toThrowError(
      expect.objectContaining({ code: "timer_not_active" }),
    );
    timers.dispose();
  });
});
