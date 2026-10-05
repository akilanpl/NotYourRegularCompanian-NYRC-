import { reactionsFor } from "../character";
import { api } from "../bridge/api";
import {
  actionFailure,
  actionSuccess,
  type ActionExecutor,
  type ActionResult,
  type CompanionAction,
} from "./action";
import type { AssistantMode, UserAlias, UserAliasInput } from "./scheduledItem";

const ACTIONS = [
  "web.open",
  "app.open",
  "system.volume.get",
  "system.volume.set",
  "system.volume.increase",
  "system.volume.decrease",
  "system.volume.mute",
  "system.volume.unmute",
  "media.play_pause",
  "media.next",
  "media.previous",
  "system.focus.enable",
  "system.dnd.enable",
  "alias.create",
  "alias.list",
  "alias.update",
  "alias.delete",
  "alias.execute",
  "mode.activate",
  "mode.list",
  "mode.create",
  "mode.update",
  "mode.delete",
] as const;

const MODE_STEP_ACTIONS = new Set<string>([
  "web.open",
  "app.open",
  "system.volume.get",
  "system.volume.set",
  "system.volume.increase",
  "system.volume.decrease",
  "system.volume.mute",
  "system.volume.unmute",
  "media.play_pause",
  "media.next",
  "media.previous",
  "system.focus.enable",
  "system.dnd.enable",
]);

type ModeStepResult = Readonly<{
  index: number;
  action: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}>;

export type DesktopAssistantBackend = Pick<typeof api,
  | "openWebsite"
  | "openApplication"
  | "getSystemVolume"
  | "setSystemVolume"
  | "setSystemMute"
  | "unsupportedDesktopCapability"
  | "createAlias"
  | "listAliases"
  | "updateAlias"
  | "deleteAlias"
  | "listModes"
  | "createMode"
  | "updateMode"
  | "deleteMode"
>;

export class DesktopAssistantExecutor implements ActionExecutor {
  constructor(private readonly backend: DesktopAssistantBackend = api) {}
  canExecute(action: CompanionAction): boolean {
    return (ACTIONS as readonly string[]).includes(action.id);
  }

  async execute(action: CompanionAction): Promise<ActionResult> {
    if (!this.canExecute(action)) {
      return actionFailure("unsupported_action", `Unsupported assistant action: ${action.id}`);
    }
    try {
      switch (action.id) {
        case "web.open":
          await this.backend.openWebsite(requiredString(action.payload, "url"));
          return actionSuccess({ opened: true });
        case "app.open":
          await this.backend.openApplication(requiredString(action.payload, "application"));
          return actionSuccess({ opened: true });
        case "system.volume.get":
          return actionSuccess({ volume: await this.backend.getSystemVolume() });
        case "system.volume.set": {
          const volume = numberField(action.payload, "volume");
          if (volume === null || !Number.isFinite(volume)) {
            return actionFailure("invalid_volume", "Volume must be a finite number");
          }
          return actionSuccess({ volume: await this.backend.setSystemVolume(clampVolume(volume)) });
        }
        case "system.volume.increase":
        case "system.volume.decrease": {
          const payload = requireRecord(action.payload);
          const requestedAmount = numberField(payload, "amount");
          if ("amount" in payload && requestedAmount === null) {
            return actionFailure("invalid_volume", "Volume adjustment must be numeric");
          }
          if (requestedAmount !== null && (!Number.isFinite(requestedAmount) || requestedAmount < 0)) {
            return actionFailure("invalid_volume", "Volume adjustment must be a non-negative finite number");
          }
          const amount = requestedAmount ?? 10;
          const current = await this.backend.getSystemVolume();
          const next = current + (action.id.endsWith("increase") ? amount : -amount);
          return actionSuccess({ volume: await this.backend.setSystemVolume(clampVolume(next)) });
        }
        case "system.volume.mute":
        case "system.volume.unmute":
          return actionSuccess({
            muted: await this.backend.setSystemMute(action.id === "system.volume.mute"),
          });
        case "media.play_pause":
        case "media.next":
        case "media.previous":
        case "system.focus.enable":
        case "system.dnd.enable":
          await this.backend.unsupportedDesktopCapability(action.id);
          return actionFailure("unsupported_capability", `${action.id} is unsupported`);
        case "alias.create":
          return actionSuccess(await this.backend.createAlias(parseAliasInput(action.payload)));
        case "alias.list":
          return actionSuccess(await this.backend.listAliases());
        case "alias.update": {
          const record = requireRecord(action.payload);
          return actionSuccess(await this.backend.updateAlias(
            requiredString(record, "id"),
            parseAliasInput(record),
          ));
        }
        case "alias.delete":
          await this.backend.deleteAlias(requiredString(action.payload, "id"));
          return actionSuccess({ deleted: true });
        case "alias.execute":
          return this.executeAlias(requiredString(action.payload, "phrase"));
        case "mode.list":
          return actionSuccess(await this.backend.listModes());
        case "mode.create":
          return actionSuccess(await this.backend.createMode(parseModeInput(action.payload)));
        case "mode.update": {
          const record = requireRecord(action.payload);
          return actionSuccess(await this.backend.updateMode(
            requiredString(record, "id"),
            parseModeInput(record),
          ));
        }
        case "mode.delete":
          await this.backend.deleteMode(requiredString(action.payload, "id"));
          return actionSuccess({ deleted: true });
        case "mode.activate":
          return this.activateMode(requiredString(action.payload, "name"));
        default:
          return actionFailure("unsupported_action", `Unsupported assistant action: ${action.id}`);
      }
    } catch (error) {
      return structuredFailure(error);
    }
  }

  private async executeAlias(phrase: string): Promise<ActionResult> {
    const aliases = await this.backend.listAliases();
    const normalized = normalizePhrase(phrase);
    const alias = aliases.find((candidate) => candidate.normalizedPhrase === normalized);
    if (!alias) return actionFailure("alias_not_found", `No alias matches "${phrase}"`);
    const delegated: Record<UserAlias["targetType"], CompanionAction> = {
      website: { id: "web.open", payload: { url: alias.target }, permission: "none" },
      application: { id: "app.open", payload: { application: alias.target }, permission: "none" },
      mode: { id: "mode.activate", payload: { name: alias.target }, permission: "none" },
    };
    return this.execute(delegated[alias.targetType]);
  }

  private async activateMode(name: string): Promise<ActionResult> {
    const modes = await this.backend.listModes();
    const mode = modes.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!mode) return actionFailure("mode_not_found", `Mode "${name}" was not found`);

    const results: ModeStepResult[] = [];
    for (const [index, value] of mode.actions.entries()) {
      const parsed = parseModeStep(value);
      if (!parsed) {
        results.push({
          index,
          action: "invalid",
          ok: false,
          error: { code: "invalid_mode_step", message: "Mode action is invalid" },
        });
        continue;
      }
      const result = await this.execute(parsed);
      results.push(result.ok
        ? { index, action: parsed.id, ok: true, data: result.data }
        : { index, action: parsed.id, ok: false, error: result.error });
    }
    const failed = results.filter((step) => !step.ok).length;
    if (results.length === 0) {
      return actionFailure("empty_mode", `Mode "${mode.name}" has no actions`);
    }
    if (failed === results.length) {
      const firstError = results.find((step) => step.error)?.error;
      return actionFailure(
        firstError?.code ?? "mode_execution_failed",
        firstError?.message ?? `All actions in mode "${mode.name}" failed`,
      );
    }
    return actionSuccess({
      mode: mode.name,
      status: failed === 0 ? "succeeded" : "partial_success",
      steps: results,
    });
  }
}

function normalizePhrase(value: string): string {
  return value.trim().split(/\s+/).join(" ").toLowerCase();
}

function parseAliasInput(value: unknown): UserAliasInput {
  const record = requireRecord(value);
  const targetType = requiredString(record, "targetType");
  if (targetType !== "website" && targetType !== "application" && targetType !== "mode") {
    throw new TypeError("Unsupported alias target type");
  }
  return {
    phrase: requiredString(record, "phrase"),
    targetType,
    target: requiredString(record, "target"),
  };
}

function parseModeInput(value: unknown): { name: string; actions: unknown[] } {
  const record = requireRecord(value);
  if (!Array.isArray(record.actions) || record.actions.length > 20) {
    throw new TypeError("Mode actions must be an array of at most 20 entries");
  }
  return { name: requiredString(record, "name"), actions: record.actions };
}

function parseModeStep(value: unknown): CompanionAction | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.includes(".")) return null;
  if (!MODE_STEP_ACTIONS.has(value.id)) return null;
  if (typeof value.permission !== "string" || !["none", "confirm", "sensitive"].includes(value.permission)) {
    return null;
  }
  return {
    id: value.id as CompanionAction["id"],
    payload: value.payload,
    permission: value.permission as CompanionAction["permission"],
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("Action payload must be an object");
  return value;
}

function requiredString(value: unknown, key: string): string {
  const record = requireRecord(value);
  if (typeof record[key] !== "string" || !record[key].trim()) {
    throw new TypeError(`${key} is required`);
  }
  return record[key].trim();
}

function numberField(value: unknown, key: string): number | null {
  return isRecord(value) && typeof value[key] === "number" ? value[key] : null;
}

function clampVolume(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structuredFailure(error: unknown): ActionResult<never> {
  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    return actionFailure(error.code, error.message);
  }
  if (typeof error === "string" && error.trim()) {
    return actionFailure("assistant_action_failed", error.trim());
  }
  return actionFailure("assistant_action_failed", error instanceof Error ? error.message : "Assistant action failed");
}

export function modeReaction(result: unknown) {
  if (isRecord(result) && result.status === "partial_success") return reactionsFor("task_failed")[0];
  return reactionsFor("task_succeeded")[0];
}

export type { AssistantMode };
