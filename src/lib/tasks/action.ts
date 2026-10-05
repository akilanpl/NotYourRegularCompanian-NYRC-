export type ActionId = `${string}.${string}`;

export const ACTION_IDS = [
  "time.current",
  "calendar.read",
  "calendar.list",
  "calendar.get",
  "calendar.delete",
  "pocket.save_text",
  "pocket.save_url",
  "pocket.save_file",
  "pocket.export_file",
  "pocket.list",
  "pocket.get",
  "pocket.delete",
  "clipboard.read",
  "clipboard.write",
  "clipboard.to_pocket",

  "calendar.create",
  "calendar.update",
  "system.volume.set",
  "system.focus.enable",
  "system.dnd.enable",
  "timer.create",
  "timer.list",
  "timer.cancel",
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
  "web.open",
  "app.open",
  "alias.create",
  "alias.list",
  "alias.update",
  "alias.delete",
  "alias.execute",
  "system.volume.get",
  "system.volume.increase",
  "system.volume.decrease",
  "system.volume.mute",
  "system.volume.unmute",
  "media.play_pause",
  "media.next",
  "media.previous",
  "mode.activate",
  "mode.list",
  "mode.create",
  "mode.update",
  "mode.delete",
  "clipboard.save",
  "clipboard.retrieve",
  "developer.task.status",
  "developer.permission.respond",
] as const satisfies readonly ActionId[];

export type KnownActionId = (typeof ACTION_IDS)[number];

export type PermissionLevel = "none" | "confirm" | "sensitive";

export type CompanionAction<TPayload = unknown> = Readonly<{
  id: ActionId;
  payload: TPayload;
  permission: PermissionLevel;
}>;

export type ActionErrorCode =
  | "unsupported_action"
  | "execution_failed"
  | "permission_denied"
  | (string & {});

export type ActionError = Readonly<{
  code: ActionErrorCode;
  message: string;
}>;

export type ActionResult<TData = unknown> =
  | Readonly<{ ok: true; data: TData }>
  | Readonly<{ ok: false; error: ActionError }>;

export function actionSuccess<TData>(data: TData): ActionResult<TData> {
  return { ok: true, data };
}

export function actionFailure(
  code: ActionErrorCode,
  message: string,
): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

export interface ActionExecutor {
  canExecute(action: CompanionAction): boolean | Promise<boolean>;
  execute(action: CompanionAction): Promise<ActionResult>;
}
