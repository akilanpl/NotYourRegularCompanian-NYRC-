import type {
  ActionError,
  CompanionAction,
  PermissionLevel,
} from "./action";
import type { Reaction } from "../character";

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_for_user"
  | "permission_required"
  | "succeeded"
  | "failed"
  | "cancelled";

export type TaskOrigin = "user" | "automation" | "system" | "companion";
export type ActiveTaskStatus = "running" | "waiting_for_user";

export type TaskPermissionRequest = Readonly<{
  level: Exclude<PermissionLevel, "none">;
  prompt: string;
  requestedAt: string;
}>;

export type CompanionTask = Readonly<{
  id: string;
  type: string;
  origin: TaskOrigin;
  status: TaskStatus;
  title: string;
  action: CompanionAction;
  createdAt: string;
  updatedAt: string;
  permissionRequest: TaskPermissionRequest | null;
  permissionGranted: boolean;
  result?: unknown;
  error?: ActionError;
}>;

export type CreateTaskInput = Readonly<{
  type: string;
  origin: TaskOrigin;
  title: string;
  action: CompanionAction;
}>;

export type TaskStatusChange = Readonly<{
  task: CompanionTask;
  reaction: Reaction;
}>;

export type TaskListener = (change: TaskStatusChange) => void;
