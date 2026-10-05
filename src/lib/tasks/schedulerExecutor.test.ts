import { describe, expect, it } from "vitest";
import type { CompanionAction } from "./action";
import { SchedulerExecutor, type SchedulerBackend } from "./schedulerExecutor";
import type { ScheduledItem } from "./scheduledItem";

const uuid = "123e4567-e89b-42d3-a456-426614174000";

function item(
  kind: ScheduledItem["kind"] = "reminder",
  id = uuid,
): ScheduledItem {
  return {
    id,
    kind,
    title: "Submit assignment",
    message: null,
    scheduledAt: "2026-10-05T04:30:00.000Z",
    timezone: "Asia/Kolkata",
    status: "scheduled",
    recurrence: null,
    metadata: null,
    createdAt: "2026-10-05T04:00:00.000Z",
    updatedAt: "2026-10-05T04:00:00.000Z",
    triggeredAt: null,
    dismissedAt: null,
  };
}

function action(id: CompanionAction["id"], payload: unknown = {}): CompanionAction {
  return { id, payload, permission: "none" };
}

describe("SchedulerExecutor", () => {
  it("supports only reminder and alarm scheduling actions", async () => {
    const executor = new SchedulerExecutor({} as SchedulerBackend);
    for (const id of [
      "reminder.create",
      "reminder.list",
      "reminder.cancel",
      "reminder.dismiss",
      "alarm.create",
      "alarm.list",
      "alarm.cancel",
      "alarm.dismiss",
    ] as const) {
      expect(executor.canExecute(action(id))).toBe(true);
    }
    expect(executor.canExecute(action("calendar.create"))).toBe(false);
    expect(await executor.execute(action("calendar.create"))).toMatchObject({
      ok: false,
      error: { code: "unsupported_action" },
    });
  });

  it("validates and creates reminders and alarms through the persistence boundary", async () => {
    const created: ScheduledItem[] = [];
    const backend: SchedulerBackend = {
      createScheduledItem: async (input) => {
        const next = {
          ...item(input.kind),
          title: input.title,
          scheduledAt: input.scheduledAt,
          timezone: input.timezone ?? null,
        };
        created.push(next);
        return next;
      },
      getScheduledItem: async (id) => item("reminder", id),
      listScheduledItems: async () => created,
      cancelScheduledItem: async (id) => item("reminder", id),
      dismissScheduledItem: async (id) => item("reminder", id),
    };
    const executor = new SchedulerExecutor(backend);
    const result = await executor.execute(action("reminder.create", {
      title: "  Submit assignment ",
      scheduledAt: "2026-10-05T10:00:00+05:30",
    }));
    expect(result).toMatchObject({
      ok: true,
      data: {
        kind: "reminder",
        title: "Submit assignment",
        scheduledAt: "2026-10-05T04:30:00.000Z",
      },
    });
    expect(created[0].timezone).toBeTruthy();

    expect(await executor.execute(action("alarm.create", {
      title: "Wake up",
      scheduledAt: "2026-10-05T04:30:00Z",
    }))).toMatchObject({ ok: true, data: { kind: "alarm" } });
  });

  it("returns structured validation and backend errors", async () => {
    const executor = new SchedulerExecutor({
      createScheduledItem: async () => {
        throw { code: "invalid_timestamp", message: "Invalid timestamp" };
      },
      getScheduledItem: async () => item(),
      listScheduledItems: async () => [],
      cancelScheduledItem: async () => item(),
      dismissScheduledItem: async () => item(),
    });
    expect(await executor.execute(action("reminder.create", {
      title: "",
      scheduledAt: "tomorrow",
    }))).toMatchObject({ ok: false, error: { code: "invalid_title" } });
    expect(await executor.execute(action("reminder.create", {
      title: "Valid title",
      scheduledAt: "tomorrow",
    }))).toMatchObject({ ok: false, error: { code: "invalid_timestamp" } });
    expect(await executor.execute(action("reminder.create", {
      title: "Valid title",
      scheduledAt: "2026-10-05T04:30:00Z",
    }))).toMatchObject({ ok: false, error: { code: "invalid_timestamp" } });
  });

  it("validates IDs and prevents reminder actions from changing alarms", async () => {
    let cancelled = false;
    const executor = new SchedulerExecutor({
      createScheduledItem: async () => item(),
      getScheduledItem: async () => item("alarm"),
      listScheduledItems: async () => [],
      cancelScheduledItem: async () => {
        cancelled = true;
        return item("alarm");
      },
      dismissScheduledItem: async () => item("alarm"),
    });
    expect(await executor.execute(action("reminder.cancel", { id: "bad-id" })))
      .toMatchObject({ ok: false, error: { code: "invalid_id" } });
    expect(await executor.execute(action("reminder.cancel", { id: uuid })))
      .toMatchObject({ ok: false, error: { code: "item_kind_mismatch" } });
    expect(cancelled).toBe(false);
  });

  it("lists, cancels, and dismisses only matching scheduled item kinds", async () => {
    let current = item("reminder");
    const backend: SchedulerBackend = {
      createScheduledItem: async () => current,
      getScheduledItem: async () => current,
      listScheduledItems: async (kind) => kind === current.kind ? [current] : [],
      cancelScheduledItem: async () => {
        current = { ...current, status: "cancelled" };
        return current;
      },
      dismissScheduledItem: async () => {
        current = { ...current, status: "dismissed" };
        return current;
      },
    };
    const executor = new SchedulerExecutor(backend);
    expect(await executor.execute(action("reminder.list")))
      .toMatchObject({ ok: true, data: [{ kind: "reminder" }] });
    expect(await executor.execute(action("reminder.cancel", { id: uuid })))
      .toMatchObject({ ok: true, data: { status: "cancelled" } });

    current = { ...current, kind: "alarm", status: "triggered" };
    expect(await executor.execute(action("alarm.dismiss", { id: uuid })))
      .toMatchObject({ ok: true, data: { kind: "alarm", status: "dismissed" } });
  });
});
