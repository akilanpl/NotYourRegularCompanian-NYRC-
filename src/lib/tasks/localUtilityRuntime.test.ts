import { describe, expect, it } from "vitest";
import { LocalUtilityRuntime } from "./localUtilityRuntime";
import { TimerService, type TimerScheduler } from "./timerService";

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

describe("LocalUtilityRuntime", () => {
  it("runs a timer through task execution and emits completion reaction", async () => {
    const time = new FakeTime();
    const timers = new TimerService(() => time.nowMs, time.scheduler);
    const runtime = new LocalUtilityRuntime(timers);
    const reactions: Array<{ status: string; expression: string }> = [];
    const finished: Array<{ label: string; signal?: string }> = [];
    runtime.subscribe(({ task, reaction }) =>
      reactions.push({ status: task.status, expression: reaction.expression }),
    );
    runtime.subscribeTimerFinished(({ timer, reaction }) =>
      finished.push({ label: timer.label, signal: reaction.signal }),
    );

    const timerTask = await runtime.execute(
      {
        id: "timer.create",
        payload: { durationMs: 5_000, label: "Test timer" },
        permission: "none",
      },
      { title: "Start test timer" },
    );
    expect(timerTask.status).toBe("succeeded");
    expect(timerTask.result).toMatchObject({ label: "Test timer", status: "running" });
    expect(reactions).toContainEqual({ status: "succeeded", expression: "pleased" });

    time.advance(5_000);
    expect(finished).toEqual([{ label: "Test timer", signal: "timer" }]);
    expect(runtime.tasks.list().at(-1)).toMatchObject({
      type: "timer.completed",
      origin: "system",
      status: "succeeded",
    });
    expect(reactions.at(-1)).toEqual({ status: "succeeded", expression: "success" });
    runtime.dispose();
  });
});
