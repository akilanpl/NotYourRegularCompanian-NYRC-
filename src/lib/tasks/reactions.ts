import type { Reaction } from "../character";
import { createReaction, reactionsFor } from "../character";
import type { ActionId } from "./action";
import type { TaskStatus } from "./task";

const CANCELLED_REACTION = createReaction({
  expression: "neutral",
  intensity: 0.2,
  durationMs: 500,
});

const STATUS_REACTIONS: Record<TaskStatus, Reaction> = {
  queued: reactionsFor("waiting_for_user")[0],
  running: reactionsFor("executing")[0],
  waiting_for_user: reactionsFor("waiting_for_user")[0],
  permission_required: reactionsFor("permission_required")[0],
  succeeded: reactionsFor("task_succeeded")[0],
  failed: reactionsFor("task_failed")[0],
  cancelled: CANCELLED_REACTION,
};

const SUCCESS_REACTIONS: Partial<Record<ActionId, Reaction>> = {
  "time.current": createReaction({ expression: "attentive", intensity: 0.2, durationMs: 600 }),
  "timer.create": reactionsFor("gentle_tap")[0],
  "timer.list": createReaction({ expression: "attentive", intensity: 0.2, durationMs: 600 }),
  "timer.cancel": CANCELLED_REACTION,
  "reminder.create": reactionsFor("gentle_tap")[0],
  "reminder.list": createReaction({ expression: "attentive", intensity: 0.2, durationMs: 600 }),
  "reminder.cancel": CANCELLED_REACTION,
  "reminder.dismiss": CANCELLED_REACTION,
  "alarm.create": reactionsFor("gentle_tap")[0],
  "alarm.list": createReaction({ expression: "attentive", intensity: 0.2, durationMs: 600 }),
  "alarm.cancel": CANCELLED_REACTION,
  "alarm.dismiss": CANCELLED_REACTION,
};

export function reactionForTaskStatus(
  status: TaskStatus,
  actionId?: ActionId,
  result?: unknown,
): Reaction {
  if (
    status === "succeeded" &&
    actionId === "mode.activate" &&
    typeof result === "object" &&
    result !== null &&
    "status" in result &&
    result.status === "partial_success"
  ) {
    return reactionsFor("task_failed")[0];
  }
  if (status === "succeeded" && actionId && SUCCESS_REACTIONS[actionId]) {
    return SUCCESS_REACTIONS[actionId];
  }
  return STATUS_REACTIONS[status];
}
