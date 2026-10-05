import { describe, expect, it } from "vitest";
import { LOCAL_UTILITY_ACTIONS, LocalUtilityExecutor } from "./localUtilityExecutor";
import { TimerService, type TimerSnapshot } from "./timerService";

describe("LocalUtilityExecutor", () => {
  it("returns structured local-time data", async () => {
    const time = new Date(2026, 9, 5, 9, 45, 0);
    const executor = new LocalUtilityExecutor(new TimerService(), () => time);
    const result = await executor.execute({
      id: "time.current",
      payload: {},
      permission: "none",
    });
    expect(result).toEqual({
      ok: true,
      data: {
        iso: time.toISOString(),
        hours: time.getHours(),
        minutes: time.getMinutes(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
  });

  it("supports only the four local utility actions", async () => {
    const executor = new LocalUtilityExecutor(new TimerService());
    for (const id of LOCAL_UTILITY_ACTIONS) {
      expect(executor.canExecute({ id, payload: {}, permission: "none" })).toBe(true);
    }
    const unsupported = { id: "calendar.create", payload: {}, permission: "none" } as const;
    expect(executor.canExecute(unsupported)).toBe(false);
    expect(await executor.execute(unsupported)).toMatchObject({
      ok: false,
      error: { code: "unsupported_action" },
    });
  });

  it("returns timer create, list, and cancel results through the action contract", async () => {
    const executor = new LocalUtilityExecutor(new TimerService());
    const created = await executor.execute({
      id: "timer.create",
      payload: { durationMs: 5_000, label: "Test" },
      permission: "none",
    });
    expect(created).toMatchObject({ ok: true, data: { label: "Test", status: "running" } });
    if (!created.ok || !isTimerSnapshot(created.data)) {
      throw new Error("expected timer creation to return a timer snapshot");
    }

    const listed = await executor.execute({
      id: "timer.list",
      payload: {},
      permission: "none",
    });
    expect(listed).toMatchObject({ ok: true, data: [{ id: created.data.id }] });

    const cancelled = await executor.execute({
      id: "timer.cancel",
      payload: { id: created.data.id },
      permission: "none",
    });
    expect(cancelled).toMatchObject({ ok: true, data: { status: "cancelled" } });
  });

  it("returns structured errors for invalid durations and missing timer IDs", async () => {
    const executor = new LocalUtilityExecutor(new TimerService());
    expect(
      await executor.execute({
        id: "timer.create",
        payload: { durationMs: Number.MAX_VALUE },
        permission: "none",
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_duration" } });
    expect(
      await executor.execute({
        id: "timer.cancel",
        payload: { id: "missing" },
        permission: "none",
      }),
    ).toMatchObject({ ok: false, error: { code: "timer_not_found" } });
  });
});

function isTimerSnapshot(value: unknown): value is TimerSnapshot {
  return typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string";
}
