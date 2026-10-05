import type { CompanionAction } from "../tasks/action";
import type {
  UserAlias,
  AssistantMode,
  ScheduledItem,
} from "../tasks/scheduledItem";
import type { TimerSnapshot } from "../tasks/timerService";
export type RouteSource = "local" | "alias" | "mode" | "ai" | "clarification";
export type Route = {
  source: RouteSource;
  confidence: number;
  intent?: CompanionAction["id"];
  action?: CompanionAction;
  message?: string;
};
export type Entities = {
  aliases?: UserAlias[];
  modes?: AssistantMode[];
  timers?: TimerSnapshot[];
  scheduled?: ScheduledItem[];
  applications?: string[];
};
export const normalize = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[?!.]+$/, "");
export function duration(s: string): number | null {
  const m =
    /^(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)$/.exec(
      s.trim(),
    );
  if (!m) return null;
  const n =
    Number(m[1]) *
    (/^(h)/.test(m[2]) ? 3600000 : /^(m)/.test(m[2]) ? 60000 : 1000);
  return Number.isSafeInteger(n) && n > 0 && n <= 2147000000 ? n : null;
}
export function nextTime(s: string, now: Date): Date | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (min > 59 || (m[3] ? h < 1 || h > 12 : h > 23)) return null;
  if (m[3]) h = (h % 12) + (m[3] === "pm" ? 12 : 0);
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}
export function localRoute(
  input: string,
  entities: Entities = {},
  now = new Date(),
): Route | null {
  if (!input.trim() || input.length > 2000)
    return {
      source: "clarification",
      confidence: 0,
      message: "Use a request of 1–2000 characters.",
    };
  const s = normalize(input);
  const route = (
    id: CompanionAction["id"],
    payload: unknown = {},
    source: RouteSource = "local",
  ): Route => ({
    source,
    confidence: 1,
    intent: id,
    action: {
      id,
      payload,
      permission:
        id === "clipboard.to_pocket" || id === "clipboard.read"
          ? "sensitive"
          : id.endsWith(".delete") ||
              (id.startsWith("calendar.") && /create|update/.test(id))
            ? "confirm"
            : "none",
    },
  });
  if (/^(time|what(?:'s| is) (?:the time|time)|what time is it)$/.test(s))
    return route("time.current");
  if (/^(?:set )?volume(?: to)? \d+$/.test(s)) {
    const volume = Number(s.match(/\d+$/)![0]);
    return volume <= 100
      ? route("system.volume.set", { volume })
      : {
          source: "clarification",
          confidence: 0,
          message: "Choose a volume from 0 to 100.",
        };
  }
  const exact: Record<string, CompanionAction["id"]> = {
    "get volume": "system.volume.get",
    volume: "system.volume.get",
    "volume up": "system.volume.increase",
    "volume down": "system.volume.decrease",
    mute: "system.volume.mute",
    unmute: "system.volume.unmute",
    "list timers": "timer.list",
    "list reminders": "reminder.list",
    "list alarms": "alarm.list",
    "show my pocket": "pocket.list",
    "show pocket": "pocket.list",
    "save clipboard to pocket": "clipboard.to_pocket",
    "read clipboard": "clipboard.read",
  };
  if (exact[s]) return route(exact[s]);
  let m =
    /^(?:start (?:a )?)?timer(?: for)? (.+?)(?: called (.+))?$/.exec(s) ??
    /^start (?:a )?(.+?) timer(?: called (.+))?$/.exec(s) ??
    /^(\d.+?) timer(?: called (.+))?$/.exec(s);
  if (m) {
    const ms = duration(m[1]);
    return ms
      ? route("timer.create", { durationMs: ms, label: m[2] ?? "Timer" })
      : {
          source: "clarification",
          confidence: 0,
          message: "Give a timer duration, such as 25 minutes.",
        };
  }
  m = /^cancel (?:my |the )?(.+?)?\s*timer$/.exec(s);
  if (m) {
    const candidates = (entities.timers ?? []).filter(
      (t) => !m![1] || normalize(t.label) === m![1],
    );
    return candidates.length === 1
      ? route("timer.cancel", { id: candidates[0].id })
      : {
          source: "clarification",
          confidence: 0,
          message: "Which timer should I cancel? Use its label.",
        };
  }
  m = /^remind me (in|at) (.+?) to (.+)$/.exec(s);
  if (m) {
    const ms = duration(m[2]);
    const at =
      m[1] === "in"
        ? ms
          ? new Date(now.getTime() + ms)
          : null
        : nextTime(m[2], now);
    return at
      ? route("reminder.create", {
          title: input
            .slice(input.toLowerCase().lastIndexOf(" to ") + 4)
            .trim(),
          scheduledAt: at.toISOString(),
        })
      : {
          source: "clarification",
          confidence: 0,
          message:
            "Give a duration or a time, such as in 20 minutes or at 8 pm.",
        };
  }
  m = /^(?:remember )?my (birthday|anniversary) is ([a-z]+) (\d{1,2})$/.exec(s);
  if (!m) {
    const yearly = /^remind me every year on ([a-z]+) (\d{1,2})$/.exec(s);
    if (yearly) {
      yearly.splice(1, 0, "Important date");
      m = yearly;
    }
  }
  if (m) {
    const months = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    const month = months.indexOf(m[2]);
    const day = Number(m[3]);
    const d = new Date(now.getFullYear(), month, day, 9);
    if (month < 0 || day < 1 || d.getMonth() !== month)
      return {
        source: "clarification",
        confidence: 0,
        message: "Use a valid month and day.",
      };
    if (d <= now) d.setFullYear(d.getFullYear() + 1);
    return route("important_date.create", {
      title: m[1],
      scheduledAt: d.toISOString(),
      recurrence: "yearly",
    });
  }
  const cancelSchedule = /^cancel (?:my |the )?(reminder|alarm)$/.exec(s);
  if (cancelSchedule) {
    const candidates = (entities.scheduled ?? []).filter(
      (i) => i.kind === cancelSchedule[1] && i.status === "scheduled",
    );
    return candidates.length === 1
      ? route(`${cancelSchedule[1]}.cancel` as CompanionAction["id"], {
          id: candidates[0].id,
        })
      : {
          source: "clarification",
          confidence: 0,
          message: "Which scheduled item should I cancel? Use its exact title.",
        };
  }
  m = /^cancel (?:my |the )?(reminder|alarm|important date) (.+)$/.exec(s);
  if (m) {
    const kind = m[1].replace(" ", "_");
    const items = (entities.scheduled ?? []).filter(
      (t) =>
        t.kind === kind &&
        t.status === "scheduled" &&
        (normalize(t.title) === m![2] || t.id === m![2]),
    );
    return items.length === 1
      ? route(`${kind}.cancel` as CompanionAction["id"], { id: items[0].id })
      : {
          source: "clarification",
          confidence: 0,
          message: "Use the exact name of one scheduled item.",
        };
  }
  // Exact saved entities are resolved before guessing application names.
  const alias = (entities.aliases ?? []).find(
    (a) =>
      normalize(a.phrase) === s ||
      normalize(a.phrase) === s.replace(/^open /, ""),
  );
  if (alias) return route("alias.execute", { phrase: alias.phrase }, "alias");
  const name = s.replace(/^start /, "").replace(/ mode$/, "");
  const mode = (entities.modes ?? []).find((a) => normalize(a.name) === name);
  if (
    (mode || ["study", "work", "focus", "relax"].includes(name)) &&
    / mode$/.test(s)
  )
    return route("mode.activate", { name: mode?.name ?? name }, "mode");
  m = /^open (.+)$/.exec(s);
  if (m) {
    const app = (
      entities.applications ?? [
        "Visual Studio Code",
        "Antigravity",
        "Safari",
        "Terminal",
      ]
    ).find((a) => normalize(a) === m![1]);
    if (app) return route("app.open", { application: app });
    const sites: Record<string, string> = {
      youtube: "https://youtube.com",
      google: "https://google.com",
    };
    if (sites[m[1]]) return route("web.open", { url: sites[m[1]] });
  }
  m = /^save (?:this )?text to (?:my )?pocket[: ]+([\s\S]+)$/i.exec(
    input.trim(),
  );
  if (m)
    return route("pocket.save_text", {
      content: m[1],
      title: m[1].slice(0, 80),
    });
  m = /^save (https?:\/\/\S+) to (?:my )?pocket$/i.exec(input.trim());
  if (m) return route("pocket.save_url", { content: m[1], title: m[1] });
  m = /^(?:get|show) pocket (.+)$/.exec(s);
  if (m) return route("pocket.get", { id: m[1] });
  const exportFile = /^export pocket (.+)$/.exec(s);
  if (exportFile) return route("pocket.export_file", { id: exportFile[1] });
  m = /^delete pocket (.+)$/.exec(s);
  if (m) return route("pocket.delete", { id: m[1] });
  m = /^save file (.+) to (?:my )?pocket$/i.exec(input.trim());
  if (m) return route("pocket.save_file", { name: m[1], title: m[1] });
  m = /^copy (.+) to clipboard$/i.exec(input.trim());
  if (m) return route("clipboard.write", { content: m[1] });
  if (/calendar (today|tomorrow)|on my calendar(?: tomorrow)?/.test(s)) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (s.includes("tomorrow")) start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return route("calendar.list", {
      start: start.toISOString(),
      end: end.toISOString(),
    });
  }
  if (s === "what failed in the latest build")
    return route("developer.task.status");
  return null;
}
