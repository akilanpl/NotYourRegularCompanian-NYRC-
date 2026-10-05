import {
  actionFailure,
  actionSuccess,
  type ActionExecutor,
  type ActionResult,
  type CompanionAction,
} from "./action";
import type {
  CreateScheduledItemInput,
  ScheduledItem,
  ScheduledItemKind,
  ScheduledRecurrence,
} from "./scheduledItem";
import { SCHEDULED_RECURRENCES } from "./scheduledItem";

export const SCHEDULER_ACTIONS = [
  "reminder.create",
  "reminder.list",
  "reminder.cancel",
  "reminder.dismiss",
  "alarm.create",
  "alarm.list",
  "alarm.cancel",
  "alarm.dismiss",
  "important_date.create",
  "important_date.list",
  "important_date.cancel",
] as const;

export interface SchedulerBackend {
  createScheduledItem(item: CreateScheduledItemInput): Promise<ScheduledItem>;
  getScheduledItem(id: string): Promise<ScheduledItem>;
  listScheduledItems(kind?: ScheduledItemKind): Promise<ScheduledItem[]>;
  cancelScheduledItem(id: string): Promise<ScheduledItem>;
  dismissScheduledItem(id: string): Promise<ScheduledItem>;
}

export class SchedulerExecutor implements ActionExecutor {
  constructor(private readonly backend: SchedulerBackend) {}

  canExecute(action: CompanionAction): boolean {
    return (SCHEDULER_ACTIONS as readonly string[]).includes(action.id);
  }

  async execute(action: CompanionAction): Promise<ActionResult> {
    if (!this.canExecute(action)) {
      return actionFailure(
        "unsupported_action",
        `Unsupported scheduling action: ${action.id}`,
      );
    }

    try {
      const [kindText, operation] = action.id.split(".");
      const kind: ScheduledItemKind =
        kindText === "alarm" ? "alarm" :
          kindText === "important_date" ? "important_date" : "reminder";
      switch (operation) {
        case "create": {
          const payload = parseCreatePayload(action.payload, kind);
          if (!payload.ok) return payload;
          return actionSuccess(await this.backend.createScheduledItem(payload.data));
        }
        case "list":
          return actionSuccess(await this.backend.listScheduledItems(kind));
        case "cancel":
        case "dismiss": {
          const id = parseId(action.payload);
          if (!id) {
            return actionFailure("invalid_id", "A scheduled item ID is required");
          }
          const item = await this.backend.getScheduledItem(id);
          if (item.kind !== kind) {
            return actionFailure(
              "item_kind_mismatch",
              `This action cannot change a ${item.kind}`,
            );
          }
          const changed = operation === "cancel"
            ? await this.backend.cancelScheduledItem(id)
            : await this.backend.dismissScheduledItem(id);
          return actionSuccess(changed);
        }
        default:
          return actionFailure(
            "unsupported_action",
            `Unsupported scheduling action: ${action.id}`,
          );
      }
    } catch (error) {
      return bridgeFailure(error);
    }
  }
}

function parseCreatePayload(
  value: unknown,
  kind: ScheduledItemKind,
): ActionResult<CreateScheduledItemInput> {
  if (!isRecord(value)) {
    return actionFailure("invalid_payload", "Scheduled item details are required");
  }
  if (typeof value.title !== "string" || !value.title.trim() || value.title.trim().length > 120) {
    return actionFailure("invalid_title", "Title must contain 1 to 120 characters");
  }
  if (
    typeof value.scheduledAt !== "string" ||
    !RFC3339_PATTERN.test(value.scheduledAt) ||
    !Number.isFinite(Date.parse(value.scheduledAt))
  ) {
    return actionFailure(
      "invalid_timestamp",
      "scheduledAt must be an ISO 8601/RFC3339 timestamp with an offset",
    );
  }
  if (value.message !== undefined && typeof value.message !== "string") {
    return actionFailure("invalid_message", "Message must be text");
  }
  if (typeof value.message === "string" && value.message.length > 500) {
    return actionFailure("invalid_message", "Message must be at most 500 characters");
  }
  if (
    value.recurrence !== undefined &&
    !(SCHEDULED_RECURRENCES as readonly unknown[]).includes(value.recurrence)
  ) {
    return actionFailure("invalid_recurrence", "Unsupported recurrence");
  }

  let timezone = value.timezone;
  if (timezone === undefined) {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  if (typeof timezone !== "string" || !isValidTimezone(timezone)) {
    return actionFailure("invalid_timezone", "Timezone must be a supported timezone identifier");
  }

  return actionSuccess({
    kind,
    title: value.title.trim(),
    scheduledAt: new Date(value.scheduledAt).toISOString(),
    timezone,
    ...(typeof value.message === "string" && value.message.trim()
      ? { message: value.message.trim() }
      : {}),
    ...(value.recurrence === undefined
      ? {}
      : { recurrence: value.recurrence as ScheduledRecurrence }),
    ...(value.metadata === undefined ? {} : { metadata: value.metadata }),
  });
}

function parseId(value: unknown): string | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
    ? value.id
    : null;
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone.length <= 100;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bridgeFailure(error: unknown): ActionResult<never> {
  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    return actionFailure(error.code, error.message);
  }
  return actionFailure(
    "scheduler_unavailable",
    error instanceof Error ? error.message : "Could not access scheduled items",
  );
}

const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
