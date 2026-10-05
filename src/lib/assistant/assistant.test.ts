import { describe, it, expect, vi } from "vitest";
import { duration, nextTime, localRoute } from "./router";
import { validateProposal } from "./proposals";
import { AssistantRuntime } from "./runtime";
import { TimerService } from "../tasks/timerService";
import { normalizeReply } from "./personality";
import { estimateState, adaptation } from "./state";
import {
  validDeveloperEvent,
  developerReaction,
  Proactivity,
} from "./developer";
import { MockCalendarProvider, CalendarProactivity } from "./calendar";
const now = new Date(2026, 9, 5, 18, 0);
describe("deterministic command routing", () => {
  it.each([
    ["what time is it", "time.current"],
    ["time", "time.current"],
    ["timer 25 minutes", "timer.create"],
    ["25 minute timer", "timer.create"],
    ["start a timer for 10 minutes", "timer.create"],
    ["start a 25 minute timer", "timer.create"],
    ["volume 30", "system.volume.set"],
    ["set volume to 50", "system.volume.set"],
    ["volume up", "system.volume.increase"],
    ["volume down", "system.volume.decrease"],
    ["mute", "system.volume.mute"],
    ["unmute", "system.volume.unmute"],
    ["open youtube", "web.open"],
    ["open Safari", "app.open"],
    ["list reminders", "reminder.list"],
    ["list alarms", "alarm.list"],
    ["show my pocket", "pocket.list"],
    ["save clipboard to pocket", "clipboard.to_pocket"],
    ["my birthday is March 12", "important_date.create"],
    ["remember my anniversary is June 17", "important_date.create"],
    ["remind me every year on October 5", "important_date.create"],
  ])("%s → %s", (s, id) => expect(localRoute(s, {}, now)?.action?.id).toBe(id));
  it("parses duration and rejects overflow or malformed units", () => {
    expect(duration("1.5 hours")).toBe(5400000);
    for (const s of [
      "0 minutes",
      "-5 minutes",
      "999999 hours",
      "five minutes",
      "2 cats",
    ])
      expect(duration(s)).toBeNull();
  });
  it("parses 12-hour times and rolls next day", () => {
    expect(nextTime("8 pm", now)?.getHours()).toBe(20);
    expect(nextTime("8 am", now)?.getDate()).toBe(6);
    expect(nextTime("12 am", now)?.getHours()).toBe(0);
    for (const t of ["13 pm", "24:00", "8:60"])
      expect(nextTime(t, now)).toBeNull();
  });
  it("reminders remain local", () => {
    const r = localRoute(
      "remind me in 20 minutes to submit assignment",
      {},
      now,
    );
    expect((r?.action?.payload as any).scheduledAt).toBe(
      new Date(now.getTime() + 1200000).toISOString(),
    );
    expect(localRoute("remind me at 8 pm to call home", {}, now)?.source).toBe(
      "local",
    );
  });
  it("resolves normalized aliases and saved modes", () => {
    const e: any = {
      aliases: [
        { phrase: "open my editor", normalizedPhrase: "open my editor" },
      ],
      modes: [{ name: "Study" }],
    };
    expect(localRoute(" OPEN   MY EDITOR ", e)?.source).toBe("alias");
    expect(localRoute("start study mode", e)?.source).toBe("mode");
  });
  it("clarifies ambiguous cancellation without AI", () => {
    expect(localRoute("cancel my timer", { timers: [] })?.source).toBe(
      "clarification",
    );
    const e: any = { timers: [{ id: "t", label: "Tea" }] };
    expect((localRoute("cancel tea timer", e)?.action?.payload as any).id).toBe(
      "t",
    );
  });
});
it("binary file routes stay local and allow no external paths", () => {
  expect(localRoute("save file picture.png to pocket")?.action?.id).toBe(
    "pocket.save_file",
  );
  expect(
    localRoute("export pocket 00000000-0000-4000-8000-000000000000")?.action
      ?.id,
  ).toBe("pocket.export_file");
});
describe("AI boundary and task flow", () => {
  it.each([
    { kind: "action", action: "shell.execute", payload: {} },
    { kind: "action", action: "timer.create", payload: { durationMs: "10" } },
    {
      kind: "action",
      action: "web.open",
      payload: { url: "javascript:alert(1)" },
    },
    { kind: "action", action: "calendar.create", payload: {} },
    null,
  ])("rejects unsafe proposal %j", (p) =>
    expect(validateProposal(p)).toBeNull(),
  );
  it("assigns permission independent of model", () => {
    expect(
      (
        validateProposal({
          kind: "action",
          action: "web.open",
          payload: { url: "https://example.com" },
          permission: "none",
        }) as any
      ).action.permission,
    ).toBe("confirm");
  });
  it("executes local commands without calling AI", async () => {
    const ai = vi.fn();
    const timers = new TimerService();
    const r = new AssistantRuntime(timers, ai);
    expect((await r.submit("timer 25 minutes")).task?.status).toBe("succeeded");
    expect(ai).not.toHaveBeenCalled();
    timers.dispose();
  });
  it("resumes after approval and denies without executor side effects", async () => {
    const execute = vi.fn(async () => ({ ok: true as const, data: {} }));
    const timers = new TimerService();
    const r = new AssistantRuntime(
      timers,
      async () => ({
        kind: "action",
        action: "web.open",
        payload: { url: "https://example.com" },
      }),
      [{ canExecute: () => true, execute }],
    );
    const a = await r.submit("open a useful reference");
    expect(a.task?.status).toBe("permission_required");
    expect(execute).not.toHaveBeenCalled();
    expect((await r.permission(a.task!.id, true)).status).toBe("succeeded");
    const b = await r.submit("open something else");
    expect((await r.permission(b.task!.id, false)).error?.code).toBe(
      "permission_denied",
    );
    expect(execute).toHaveBeenCalledTimes(1);
    timers.dispose();
  });
  it("clipboard read asks before touching clipboard", async () => {
    const execute = vi.fn();
    const t = new TimerService();
    const r = new AssistantRuntime(t, vi.fn(), [
      { canExecute: () => true, execute },
    ]);
    expect((await r.submit("save clipboard to pocket")).task?.status).toBe(
      "permission_required",
    );
    expect(execute).not.toHaveBeenCalled();
    t.dispose();
  });
  it("provider failure and malformed proposals clarify", async () => {
    const t = new TimerService();
    expect(
      (
        await new AssistantRuntime(t, async () => {
          throw Error("network");
        }).submit("help with something")
      ).route.source,
    ).toBe("clarification");
    expect(
      (
        await new AssistantRuntime(t, async () => ({
          kind: "action",
          action: "evil",
          payload: {},
        })).submit("unknown")
      ).task,
    ).toBeUndefined();
    t.dispose();
  });
});
describe("personality, state and developer events", () => {
  it("normalizes identically regardless of provider", () => {
    expect(normalizeReply(" calm\u0007 reply!!! ")).toBe("calm reply!");
    expect(normalizeReply("x".repeat(900), undefined, true).length).toBe(300);
  });
  it("explainable bounded state with manual override", () => {
    const s = estimateState({
      hour: 23,
      failures: 4,
      focusMode: true,
      manual: { focus: 0.9 },
    });
    expect(s.factors).toContain("manual focus");
    expect(s.dimensions.focus).toBe(0.9);
    for (const v of Object.values(s.dimensions))
      expect(v).toBeGreaterThanOrEqual(0);
    expect(adaptation(s).quiet).toBe(true);
  });
  it("validates event types and semantic reactions", () => {
    const e: any = {
      id: "a",
      type: "developer.tests.failed",
      timestamp: now.toISOString(),
    };
    expect(validDeveloperEvent(e)).toBe(true);
    expect(developerReaction(e).expression).toBe("concerned");
    expect(validDeveloperEvent({ ...e, type: "shell.execute" })).toBe(false);
    expect(validDeveloperEvent({ ...e, message: "x".repeat(2001) })).toBe(
      false,
    );
  });
  it("proactivity deduplicates and suppresses nonessential focus interruptions", () => {
    const p = new Proactivity();
    expect(p.accept({ id: "a", type: "developer.tests.passed" }, true)).toBe(
      true,
    );
    expect(p.accept({ id: "a", type: "developer.tests.passed" })).toBe(false);
    expect(p.accept({ id: "b", type: "developer.agent.message" }, true)).toBe(
      false,
    );
  });
});
describe("calendar domain", () => {
  it("mock provider performs CRUD and overlap queries", async () => {
    const p = new MockCalendarProvider();
    const e = await p.create({
      title: "Meeting",
      start: "2026-10-05T10:00:00Z",
      end: "2026-10-05T11:00:00Z",
      timezone: "UTC",
    });
    expect(
      (
        await p.list({
          start: "2026-10-05T00:00:00Z",
          end: "2026-10-06T00:00:00Z",
        })
      ).length,
    ).toBe(1);
    expect((await p.update({ ...e, title: "Changed" })).title).toBe("Changed");
    await p.delete(e.id);
    await expect(p.get(e.id)).rejects.toThrow();
  });
  it("calendar notification uses scheduled events, stops on dispose", () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const p = new CalendarProactivity(notify);
    p.load([
      {
        id: "a",
        title: "Soon",
        start: new Date(Date.now() + 360000).toISOString(),
        end: new Date(Date.now() + 720000).toISOString(),
        timezone: "UTC",
      },
    ]);
    vi.advanceTimersByTime(60000);
    expect(notify).toHaveBeenCalledWith("Upcoming: Soon");
    p.dispose();
    vi.useRealTimers();
  });
});

it("calendar conflicts compare instants across offsets and do not repeat", () => {
  const notify = vi.fn();
  const p = new CalendarProactivity(notify);
  const events = [
    {
      id: "a",
      title: "A",
      start: "2026-10-05T10:00:00Z",
      end: "2026-10-05T11:00:00Z",
      timezone: "UTC",
    },
    {
      id: "b",
      title: "B",
      start: "2026-10-05T15:45:00+05:30",
      end: "2026-10-05T16:45:00+05:30",
      timezone: "Asia/Kolkata",
    },
  ];
  p.load(events, Date.parse("2026-10-06T00:00:00Z"));
  p.load(events, Date.parse("2026-10-06T00:00:00Z"));
  expect(notify).toHaveBeenCalledTimes(1);
  p.dispose();
});

it("calendar mocks reject malformed end timestamps before storing", async () => {
  const p = new MockCalendarProvider();
  await expect(
    p.create({
      title: "Meeting",
      start: "2026-10-05T10:00:00Z",
      end: "invalid",
      timezone: "UTC",
    }),
  ).rejects.toThrow("Invalid calendar event");
});
