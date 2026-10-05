import { describe, expect, it, vi } from "vitest";
import { SchedulerRuntime } from "./schedulerRuntime";
import type { ScheduledItem } from "./scheduledItem";
import type { SchedulerBackend } from "./schedulerExecutor";

const reminderId = "123e4567-e89b-42d3-a456-426614174000";
const alarmId = "123e4567-e89b-42d3-a456-426614174001";

function scheduled(
  id: string,
  kind: ScheduledItem["kind"],
  scheduledAt: string,
  status: ScheduledItem["status"] = "scheduled",
): ScheduledItem {
  return {
    id,
    kind,
    title: kind === "alarm" ? "Wake up" : "Submit assignment",
    message: null,
    scheduledAt,
    timezone: "Asia/Kolkata",
    status,
    recurrence: null,
    metadata: null,
    createdAt: "2026-10-05T04:00:00.000Z",
    updatedAt: "2026-10-05T04:00:00.000Z",
    triggeredAt: status === "triggered" ? scheduledAt : null,
    dismissedAt: null,
  };
}

class FakeBackend implements SchedulerBackend {
  readonly items: ScheduledItem[];
  constructor(items: ScheduledItem[]) {
    this.items = items;
  }
  async createScheduledItem(input: Parameters<SchedulerBackend["createScheduledItem"]>[0]) {
    const created = scheduled(reminderId, input.kind, input.scheduledAt);
    this.items.push(created);
    return created;
  }
  async getScheduledItem(id: string) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) throw { code: "item_not_found", message: "No such item" };
    return item;
  }
  async listScheduledItems(kind?: ScheduledItem["kind"]) {
    return this.items.filter((item) => kind === undefined || item.kind === kind);
  }
  async cancelScheduledItem(id: string) {
    return this.replace(id, { status: "cancelled" });
  }
  async dismissScheduledItem(id: string) {
    return this.replace(id, { status: "dismissed" });
  }
  async claimDueScheduledItems(now: string) {
    const nowAt = Date.parse(now);
    const claimed = this.items.filter(
      (item) => item.status === "scheduled" && Date.parse(item.scheduledAt) <= nowAt,
    );
    for (const item of claimed) {
      this.replace(item.id, { status: "triggered", triggeredAt: now });
    }
    return Promise.all(claimed.map((item) => this.getScheduledItem(item.id)));
  }
  private replace(id: string, patch: Partial<ScheduledItem>) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) throw { code: "item_not_found", message: "No such item" };
    this.items[index] = { ...this.items[index], ...patch };
    return this.items[index];
  }
}

class FakeScheduler {
  private jobs = new Map<number, { at: number; callback: () => void }>();
  private nextId = 1;
  constructor(private readonly now: () => number) {}
  schedule = (callback: () => void, delayMs: number): (() => void) => {
    const id = this.nextId++;
    this.jobs.set(id, { at: this.now() + delayMs, callback });
    return () => this.jobs.delete(id);
  };
  async advance(ms: number): Promise<void> {
    const target = this.now() + ms;
    const due = [...this.jobs.entries()].filter(([, job]) => job.at <= target);
    for (const [id, job] of due) {
      this.jobs.delete(id);
      job.callback();
      await flushAsync();
    }
  }
}

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe("SchedulerRuntime", () => {
  it("executes user scheduling actions through the task manager and executor", async () => {
    const backend = new FakeBackend([]);
    const runtime = new SchedulerRuntime(
      backend,
      () => new Date("2026-10-05T04:00:00.000Z"),
      () => () => {},
    );
    const changes: string[] = [];
    runtime.subscribeTasks(({ task, reaction }) => {
      changes.push(task.status);
      if (task.status === "succeeded") expect(reaction.expression).toBe("pleased");
    });
    const task = await runtime.execute(
      {
        id: "reminder.create",
        payload: {
          title: "Submit assignment",
          scheduledAt: "2026-10-05T04:01:00Z",
        },
        permission: "none",
      },
      { title: "Create assignment reminder" },
    );
    expect(task.status).toBe("succeeded");
    expect(task.result).toMatchObject({ kind: "reminder", status: "scheduled" });
    expect(changes).toEqual(["queued", "running", "succeeded"]);
    expect(runtime.scheduledItems).toHaveLength(1);
    runtime.dispose();
  });

  it("triggers due reminders exactly once and keeps future items scheduled", async () => {
    let nowMs = Date.parse("2026-10-05T04:00:00.000Z");
    const backend = new FakeBackend([
      scheduled(reminderId, "reminder", "2026-10-05T04:00:05.000Z"),
      scheduled(alarmId, "alarm", "2026-10-05T04:01:00.000Z"),
    ]);
    const scheduler = new FakeScheduler(() => nowMs);
    const runtime = new SchedulerRuntime(
      backend,
      () => new Date(nowMs),
      scheduler.schedule,
    );
    const due: Array<{ kind: string; signal?: string }> = [];
    runtime.subscribeDue(({ item, reaction }) =>
      due.push({ kind: item.kind, signal: reaction.signal }),
    );
    await runtime.start();
    expect(runtime.scheduledItems[0].status).toBe("scheduled");
    nowMs += 5_000;
    await scheduler.advance(5_000);
    expect(due).toEqual([{ kind: "reminder", signal: "reminder" }]);
    expect(runtime.scheduledItems.find((item) => item.id === reminderId)?.status)
      .toBe("triggered");
    await runtime.start();
    expect(due).toHaveLength(1);
    runtime.dispose();
  });

  it("recovers overdue items after restart and does not retrigger committed claims", async () => {
    const backend = new FakeBackend([
      scheduled(reminderId, "reminder", "2026-10-05T03:59:00.000Z"),
    ]);
    const now = () => new Date("2026-10-05T04:00:00.000Z");
    const first = new SchedulerRuntime(backend, now, () => () => {});
    const firstDue: string[] = [];
    first.subscribeDue(({ item }) => firstDue.push(item.id));
    await first.start();
    expect(firstDue).toEqual([reminderId]);
    first.dispose();

    const reopened = new SchedulerRuntime(backend, now, () => () => {});
    const reopenedDue: string[] = [];
    reopened.subscribeDue(({ item }) => reopenedDue.push(item.id));
    await reopened.start();
    expect(reopenedDue).toEqual([]);
    expect(reopened.scheduledItems[0].status).toBe("triggered");
    reopened.dispose();
  });

  it("uses alarm-specific reactions and reports failure without losing fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const backend = new FakeBackend([
      scheduled(alarmId, "alarm", "2026-10-05T04:00:00.000Z"),
    ]);
    const runtime = new SchedulerRuntime(
      backend,
      () => new Date("2026-10-05T04:00:01.000Z"),
      () => () => {},
    );
    const events: string[] = [];
    let inAppFallbackCount = 0;
    runtime.subscribeDue(() => { inAppFallbackCount += 1; });
    runtime.subscribeDue(({ item, reaction }) => {
      events.push(`${item.title}:${reaction.signal}`);
      throw new Error("simulated OS notification failure");
    });
    await runtime.start();
    expect(events).toEqual(["Wake up:notification"]);
    expect(inAppFallbackCount).toBe(1);
    expect(runtime.scheduledItems[0].status).toBe("triggered");
    expect(runtime.tasks.list().some((task) => task.type === "alarm.triggered")).toBe(true);
    runtime.dispose();
    warn.mockRestore();
  });

  it("does not trigger cancelled items", async () => {
    const backend = new FakeBackend([
      scheduled(reminderId, "reminder", "2026-10-05T03:59:00.000Z", "cancelled"),
    ]);
    const runtime = new SchedulerRuntime(
      backend,
      () => new Date("2026-10-05T04:00:00.000Z"),
      () => () => {},
    );
    let count = 0;
    runtime.subscribeDue(() => { count += 1; });
    await runtime.start();
    expect(count).toBe(0);
    runtime.dispose();
  });
});
