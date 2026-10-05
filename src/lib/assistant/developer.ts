import { reactionsFor, type ReactionEvent } from "../character/reaction";
export const developerEvents = [
  "developer.task.started",
  "developer.task.completed",
  "developer.tests.passed",
  "developer.tests.failed",
  "developer.build.success",
  "developer.build.failed",
  "developer.agent.waiting",
  "developer.permission.required",
  "developer.agent.message",
] as const;
export type DeveloperEvent = {
  id: string;
  type: (typeof developerEvents)[number];
  message?: string;
  timestamp: string;
};
export function validDeveloperEvent(v: unknown): v is DeveloperEvent {
  if (!v || typeof v !== "object") return false;
  const e = v as DeveloperEvent;
  return (
    typeof e.id === "string" &&
    e.id.length > 0 &&
    e.id.length <= 80 &&
    /^[a-zA-Z0-9_-]+$/.test(e.id) &&
    developerEvents.includes(e.type) &&
    typeof e.timestamp === "string" &&
    Number.isFinite(Date.parse(e.timestamp)) &&
    (e.message === undefined ||
      (typeof e.message === "string" && e.message.length <= 2000)) &&
    JSON.stringify(e).length <= 4096
  );
}
const reactions: Record<DeveloperEvent["type"], ReactionEvent> = {
  "developer.task.started": "focus_started",
  "developer.task.completed": "task_succeeded",
  "developer.tests.passed": "task_succeeded",
  "developer.tests.failed": "task_failed",
  "developer.build.success": "task_succeeded",
  "developer.build.failed": "task_failed",
  "developer.agent.waiting": "waiting_for_user",
  "developer.permission.required": "permission_required",
  "developer.agent.message": "listening",
};
export function developerReaction(e: DeveloperEvent) {
  return reactionsFor(reactions[e.type])[0];
}
/** Event IDs deduplicate delivery; no polling and no AI invocation. */
export class Proactivity {
  private seen = new Set<string>();
  accept(e: { id: string; type: string }, focused = false) {
    if (this.seen.has(e.id)) return false;
    this.seen.add(e.id);
    if (this.seen.size > 1000)
      this.seen.delete(this.seen.values().next().value!);
    return !focused || !/agent.message/.test(e.type);
  }
}
