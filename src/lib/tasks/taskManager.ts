import {
  type ActionExecutor,
  type ActionError,
} from "./action";
import type {
  ActiveTaskStatus,
  CompanionTask,
  CreateTaskInput,
  TaskListener,
  TaskPermissionRequest,
  TaskStatus,
  TaskStatusChange,
} from "./task";
import { reactionForTaskStatus } from "./reactions";

type Clock = () => Date;

const ALLOWED_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  queued: new Set(["running", "waiting_for_user", "permission_required", "failed", "cancelled"]),
  running: new Set(["waiting_for_user", "permission_required", "succeeded", "failed", "cancelled"]),
  waiting_for_user: new Set(["queued", "permission_required", "failed", "cancelled"]),
  permission_required: new Set(["queued", "failed", "cancelled"]),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export class TaskManager {
  private readonly tasks = new Map<string, CompanionTask>();
  private readonly listeners = new Set<TaskListener>();
  private nextTaskNumber = 1;
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly clock: Clock = () => new Date()) {}

  create(input: CreateTaskInput): CompanionTask {
    if (this.list().filter(t => !["succeeded", "failed", "cancelled"].includes(t.status)).length >= 100) throw new Error("Too many pending tasks");
    if (input.title.length > 2000 || JSON.stringify(input.action).length > 1048576) throw new Error("Task input too large");
    const permission = /^(clipboard\.|calendar\.(create|update|delete)$|pocket\.(delete|save_file|export_file)$)/.test(input.action.id) && input.action.permission === "none" ? "confirm" : input.action.permission;
    const now = this.timestamp();
    const task: CompanionTask = {
      ...input,
      action: immutableCopy({...input.action, permission}),
      id: `task-${this.nextTaskNumber++}`,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      permissionRequest: null,
      permissionGranted: permission === "none",
    };
    return this.commit(task);
  }

  get(taskId: string): CompanionTask | undefined {
    return this.tasks.get(taskId);
  }

  list(): CompanionTask[] {
    return [...this.tasks.values()];
  }

  subscribe(listener: TaskListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  updateStatus(taskId: string, status: ActiveTaskStatus): CompanionTask {
    const task = this.requireTask(taskId);
    this.transition(task, status);
    return this.commit({
      ...task,
      status,
      permissionRequest: null,
      updatedAt: this.timestamp(),
    });
  }

  requestPermission(taskId: string, prompt: string): CompanionTask {
    const task = this.requireTask(taskId);
    if (task.action.permission === "none") {
      throw new Error("This task does not require permission");
    }
    if (task.status !== "queued" && task.status !== "running") {
      throw new Error(`Cannot request permission while task is ${task.status}`);
    }
    const permissionRequest: TaskPermissionRequest = {
      level: task.action.permission,
      prompt,
      requestedAt: this.timestamp(),
    };
    return this.commit({
      ...task,
      status: "permission_required",
      permissionRequest,
      updatedAt: permissionRequest.requestedAt,
    });
  }

  approvePermission(taskId: string): CompanionTask {
    const task = this.requireTask(taskId);
    if (task.status !== "permission_required" || !task.permissionRequest) {
      throw new Error("Task is not waiting for permission");
    }
    const age = this.clock().getTime() - Date.parse(task.permissionRequest.requestedAt);
    if (!Number.isFinite(age) || age < 0 || age > 300000) {
      this.fail(taskId, {code:"permission_expired",message:"Approval expired; submit the operation again"});
      throw new Error("Approval expired");
    }
    return this.commit({
      ...task,
      status: "queued",
      permissionRequest: null,
      permissionGranted: true,
      updatedAt: this.timestamp(),
    });
  }

  denyPermission(taskId: string): CompanionTask {
    const task = this.requireTask(taskId);
    if (task.status !== "permission_required" || !task.permissionRequest) {
      throw new Error("Task is not waiting for permission");
    }
    return this.fail(taskId, {
      code: "permission_denied",
      message: "The requested permission was denied",
    });
  }

  waitForUser(taskId: string): CompanionTask {
    return this.updateStatus(taskId, "waiting_for_user");
  }

  resume(taskId: string): CompanionTask {
    const task = this.requireTask(taskId);
    if (task.status !== "waiting_for_user") {
      throw new Error("Task is not waiting for the user");
    }
    return this.commit({
      ...task,
      status: "queued",
      updatedAt: this.timestamp(),
    });
  }

  complete(taskId: string, result?: unknown): CompanionTask {
    const task = this.requireTask(taskId);
    return this.commit({
      ...task,
      status: this.transition(task, "succeeded"),
      permissionRequest: null,
      result,
      updatedAt: this.timestamp(),
    });
  }

  fail(taskId: string, error: ActionError): CompanionTask {
    const task = this.requireTask(taskId);
    return this.commit({
      ...task,
      status: this.transition(task, "failed"),
      permissionRequest: null,
      error,
      updatedAt: this.timestamp(),
    });
  }

  cancel(taskId: string): CompanionTask {
    const task = this.requireTask(taskId);
    if (task.status === "cancelled") return task;
    this.controllers.get(taskId)?.abort();
    return this.commit({
      ...task,
      status: this.transition(task, "cancelled"),
      permissionRequest: null,
      updatedAt: this.timestamp(),
    });
  }

  async execute(taskId: string, executor: ActionExecutor): Promise<CompanionTask> {
    let task = this.requireTask(taskId);
    if (task.status !== "queued") {
      throw new Error(`Cannot execute task while it is ${task.status}`);
    }
    if (task.action.permission !== "none" && !task.permissionGranted) {
      return this.requestPermission(taskId, `Allow ${task.title}?`);
    }

    task = this.updateStatus(taskId, "running");
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    try {
      if (!(await executor.canExecute(task.action))) {
        const current = this.requireTask(taskId);
        if (current.status !== "running") return current;
        return this.fail(taskId, {
          code: "unsupported_action",
          message: `No executor supports ${task.action.id}`,
        });
      }
      if (this.requireTask(taskId).status !== "running") return this.requireTask(taskId);
      const result = await executor.execute(task.action, controller.signal);
      if (this.requireTask(taskId).status !== "running") return this.requireTask(taskId);
      return result.ok
        ? this.complete(taskId, result.data)
        : this.fail(taskId, result.error);
    } catch (error) {
      const current = this.requireTask(taskId);
      if (current.status !== "running") return current;
      return this.fail(taskId, {
        code: "execution_failed",
        message: error instanceof Error ? error.message : "Action execution failed",
      });
    } finally {
      this.controllers.delete(taskId);
    }
  }

  private requireTask(taskId: string): CompanionTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    return task;
  }

  private timestamp(): string {
    return this.clock().toISOString();
  }

  private commit(task: CompanionTask): CompanionTask {
    task = immutableCopy(task);
    this.tasks.set(task.id, task);
    // Retain active operations, but bound completed history in long-running sessions.
    const terminal = [...this.tasks.values()].filter(t => ["succeeded", "failed", "cancelled"].includes(t.status));
    for (const old of terminal.slice(0, Math.max(0, terminal.length - 200))) this.tasks.delete(old.id);
    this.emit(task);
    return task;
  }

  private emit(task: CompanionTask): void {
    const change: TaskStatusChange = {
      task,
      reaction: reactionForTaskStatus(task.status, task.action.id, task.result),
    };
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (error) {
        console.warn("task listener error", error);
      }
    }
  }

  private transition(task: CompanionTask, status: TaskStatus): TaskStatus {
    if (!ALLOWED_TRANSITIONS[task.status].has(status)) {
      throw new Error(`Invalid task status transition: ${task.status} -> ${status}`);
    }
    return status;
  }
}

function immutableCopy<T>(value: T): T {
  const copy = structuredClone(value);
  function freeze(v: unknown) {
    if (v && typeof v === "object") {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
  }
  freeze(copy);
  return copy;
}
