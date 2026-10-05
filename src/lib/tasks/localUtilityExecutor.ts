import {
  actionFailure,
  actionSuccess,
  type ActionExecutor,
  type ActionResult,
  type CompanionAction,
} from "./action";
import { TimerService, TimerServiceError, type TimerSnapshot } from "./timerService";

export const LOCAL_UTILITY_ACTIONS = [
  "time.current",
  "timer.create",
  "timer.list",
  "timer.cancel",
] as const;

export type CurrentTimeResult = Readonly<{
  iso: string;
  hours: number;
  minutes: number;
  timezone: string;
}>;

export type TimerCreatePayload = Readonly<{
  durationMs: number;
  label?: string;
}>;

export type TimerCancelPayload = Readonly<{ id: string }>;

type Clock = () => Date;

export class LocalUtilityExecutor implements ActionExecutor {
  constructor(
    private readonly timers: TimerService,
    private readonly clock: Clock = () => new Date(),
  ) {}

  canExecute(action: CompanionAction): boolean {
    return (LOCAL_UTILITY_ACTIONS as readonly string[]).includes(action.id);
  }

  async execute(action: CompanionAction): Promise<ActionResult> {
    if (!this.canExecute(action)) {
      return actionFailure(
        "unsupported_action",
        `Unsupported local utility action: ${action.id}`,
      );
    }

    try {
      switch (action.id) {
        case "time.current":
          return actionSuccess(currentLocalTime(this.clock()));
        case "timer.create": {
          const payload = parseTimerCreatePayload(action.payload);
          if (!payload) {
            return actionFailure(
              "invalid_duration",
              "Timer creation requires a positive integer durationMs",
            );
          }
          return actionSuccess(this.timers.create(payload.durationMs, payload.label));
        }
        case "timer.list":
          return actionSuccess(this.timers.list());
        case "timer.cancel": {
          const payload = parseTimerCancelPayload(action.payload);
          if (!payload) {
            return actionFailure("invalid_payload", "Timer cancellation requires a timer id");
          }
          return actionSuccess(this.timers.cancel(payload.id));
        }
      }
      return actionFailure(
        "unsupported_action",
        `Unsupported local utility action: ${action.id}`,
      );
    } catch (error) {
      if (error instanceof TimerServiceError) {
        return actionFailure(error.code, error.message);
      }
      return actionFailure(
        "execution_failed",
        error instanceof Error ? error.message : "Local utility action failed",
      );
    }
  }
}

function currentLocalTime(now: Date): CurrentTimeResult {
  return {
    iso: now.toISOString(),
    hours: now.getHours(),
    minutes: now.getMinutes(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTimerCreatePayload(value: unknown): TimerCreatePayload | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.durationMs !== "number" ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs <= 0
  ) {
    return null;
  }
  if (value.label !== undefined && typeof value.label !== "string") return null;
  return {
    durationMs: value.durationMs,
    ...(value.label === undefined ? {} : { label: value.label }),
  };
}

function parseTimerCancelPayload(value: unknown): TimerCancelPayload | null {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0
    ? { id: value.id }
    : null;
}

export type { TimerSnapshot };
