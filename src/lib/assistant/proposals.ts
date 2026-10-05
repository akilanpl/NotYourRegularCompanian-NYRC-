import type { CompanionAction } from "../tasks/action";
export const actionSchemas = {
  "time.current": {},
  "timer.list": {},
  "timer.create": { durationMs: "number", label: "optional" },
  "timer.cancel": { id: "string" },
  "system.volume.get": {},
  "system.volume.set": { volume: "number" },
  "system.volume.increase": {},
  "system.volume.decrease": {},
  "system.volume.mute": {},
  "system.volume.unmute": {},
  "web.open": { url: "string" },
  "app.open": { application: "string" },
  "alias.execute": { phrase: "string" },
  "mode.activate": { name: "string" },
  "reminder.create": { title: "string", scheduledAt: "string" },
  "reminder.list": {},
  "reminder.cancel": { id: "string" },
  "alarm.list": {},
  "alarm.cancel": { id: "string" },
  "calendar.list": { start: "string", end: "string" },
  "calendar.get": { id: "string" },
  "calendar.create": {
    title: "string",
    start: "string",
    end: "string",
    timezone: "string",
  },
  "calendar.update": {
    id: "string",
    title: "string",
    start: "string",
    end: "string",
    timezone: "string",
  },
  "calendar.delete": { id: "string" },
  "pocket.save_text": { content: "string", title: "string" },
  "pocket.save_url": { content: "string", title: "string" },
  "pocket.list": {},
  "pocket.get": { id: "string" },
  "pocket.delete": { id: "string" },
  "developer.task.status": {},
} as const;
export type Proposal =
  | { kind: "reply"; message: string }
  | { kind: "action"; action: CompanionAction };
export function validateProposal(value: unknown): Proposal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    v.kind === "reply" &&
    typeof v.message === "string" &&
    v.message.trim() &&
    v.message.length <= 2000
  )
    return { kind: "reply", message: v.message };
  if (
    v.kind !== "action" ||
    typeof v.action !== "string" ||
    !Object.hasOwn(actionSchemas, v.action) ||
    !v.payload ||
    typeof v.payload !== "object" ||
    Array.isArray(v.payload)
  )
    return null;
  const payload = v.payload as Record<string, unknown>;
  const schema = actionSchemas[v.action as keyof typeof actionSchemas];
  for (const [key, type] of Object.entries(schema)) {
    if (type === "optional") continue;
    if (typeof payload[key] !== type) return null;
    if (
      type === "string" &&
      (!(payload[key] as string).trim() ||
        (payload[key] as string).length > 2000)
    )
      return null;
    if (type === "number" && !Number.isFinite(payload[key])) return null;
  }
  if (
    payload.label !== undefined &&
    (typeof payload.label !== "string" || payload.label.length > 80)
  )
    return null;
  if (v.action.startsWith("calendar.")) {
    for (const k of ["description", "location"])
      if (
        payload[k] !== undefined &&
        (typeof payload[k] !== "string" || (payload[k] as string).length > 2000)
      )
        return null;
    if (payload.allDay !== undefined && typeof payload.allDay !== "boolean")
      return null;
    if (payload.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: String(payload.timezone) });
      } catch {
        return null;
      }
    }
  }
  // Only the schema keys and safe domain option fields may cross this boundary.
  const options = v.action.startsWith("calendar.")
    ? ["description", "location", "allDay"]
    : [];
  if (
    Object.keys(payload).some(
      (k) => !Object.hasOwn(schema, k) && !options.includes(k),
    )
  )
    return null;
  if (
    "volume" in payload &&
    (Number(payload.volume) < 0 || Number(payload.volume) > 100)
  )
    return null;
  if (
    "durationMs" in payload &&
    (!Number.isSafeInteger(payload.durationMs) ||
      Number(payload.durationMs) <= 0 ||
      Number(payload.durationMs) > 2147000000)
  )
    return null;
  if ("url" in payload || v.action === "pocket.save_url") {
    try {
      const u = new URL(String(payload.url ?? payload.content));
      if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
        return null;
    } catch {
      return null;
    }
  }
  if ("scheduledAt" in payload && !validTimestamp(payload.scheduledAt))
    return null;
  if ("start" in payload) {
    if (
      !(payload.allDay
        ? validDate(payload.start) && validDate(payload.end)
        : validTimestamp(payload.start) && validTimestamp(payload.end)) ||
      Date.parse(String(payload.end)) <= Date.parse(String(payload.start))
    )
      return null;
  }
  const id = v.action as CompanionAction["id"];
  // The model cannot set or weaken permissions; all AI mutations ask first.
  const permission = /\.(list|get|current|status)$/.test(id)
    ? "none"
    : "confirm";
  return { kind: "action", action: { id, payload, permission } };
}
function validTimestamp(v: unknown) {
  return (
    typeof v === "string" &&
    /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
    Number.isFinite(Date.parse(v))
  );
}

function validDate(v: unknown) {
  return (
    typeof v === "string" &&
    /^\d{4}-\d\d-\d\d$/.test(v) &&
    Number.isFinite(Date.parse(v))
  );
}
