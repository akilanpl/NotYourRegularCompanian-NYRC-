import { reactionsFor, type Reaction } from "../character";
import { api } from "../bridge/api";
import type { ActionError, CompanionAction } from "./action";
import type { TaskStatusChange, TaskOrigin } from "./task";
import { TaskManager } from "./taskManager";
import type { ScheduledItem } from "./scheduledItem";
import { SchedulerExecutor, type SchedulerBackend } from "./schedulerExecutor";
import { DesktopAssistantExecutor } from "./desktopAssistantExecutor";
import type { ActionExecutor } from "./action";

const MAX_TIMEOUT_MS = 2_147_000_000;
const RETRY_MS = 60_000;
const BUILT_IN_MODES = [
  {
    name: "Study",
    actions: [
      { id: "system.volume.set", payload: { volume: 30 }, permission: "none" },
      { id: "web.open", payload: { url: "https://chatgpt.com" }, permission: "none" },
      { id: "app.open", payload: { application: "Antigravity" }, permission: "none" },
    ],
  },
  {
    name: "Work",
    actions: [
      { id: "system.volume.set", payload: { volume: 35 }, permission: "none" },
      { id: "app.open", payload: { application: "Visual Studio Code" }, permission: "none" },
    ],
  },
  {
    name: "Focus",
    actions: [
      { id: "system.focus.enable", payload: {}, permission: "none" },
      { id: "system.volume.set", payload: { volume: 20 }, permission: "none" },
    ],
  },
  {
    name: "Relax",
    actions: [
      { id: "system.volume.set", payload: { volume: 45 }, permission: "none" },
      { id: "web.open", payload: { url: "https://music.youtube.com" }, permission: "none" },
    ],
  },
] as const;

export type ScheduledDueEvent = Readonly<{
  item: ScheduledItem;
  reaction: Reaction;
}>;

export type SchedulerListener = (items: ScheduledItem[]) => void;
export type ScheduledDueListener = (event: ScheduledDueEvent) => void;

type SchedulerClock = () => Date;
type ScheduleWake = (callback: () => void, delayMs: number) => () => void;

const defaultWake: ScheduleWake = (callback, delayMs) => {
  const handle = setTimeout(callback, delayMs);
  return () => clearTimeout(handle);
};

export class SchedulerRuntime {
  readonly tasks = new TaskManager();
  private readonly executor: ActionExecutor;
  private readonly listeners = new Set<SchedulerListener>();
  private readonly dueListeners = new Set<ScheduledDueListener>();
  private items: ScheduledItem[] = [];
  private cancelWake: (() => void) | null = null;
  private started = false;
  private disposed = false;
  private claimingDue = false;
  private refreshGeneration = 0;

  constructor(
    private readonly backend: SchedulerBackend & {
      claimDueScheduledItems(now: string): Promise<ScheduledItem[]>;
      listModes?: typeof api.listModes;
      createMode?: typeof api.createMode;
    } = api,
    private readonly clock: SchedulerClock = () => new Date(),
    private readonly scheduleWake: ScheduleWake = defaultWake,
  ) {
    const executors = [new SchedulerExecutor(backend), new DesktopAssistantExecutor()];
    this.executor = {
      canExecute: (action) => executors.some((executor) => executor.canExecute(action)),
      execute: async (action) => {
        const executor = executors.find((candidate) => candidate.canExecute(action));
        return executor
          ? executor.execute(action)
          : { ok: false, error: { code: "unsupported_action", message: `No executor supports ${action.id}` } };
      },
    };
  }

  get scheduledItems(): readonly ScheduledItem[] {
    return this.items;
  }

  subscribe(listener: SchedulerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeDue(listener: ScheduledDueListener): () => void {
    this.dueListeners.add(listener);
    return () => this.dueListeners.delete(listener);
  }

  subscribeTasks(listener: (change: TaskStatusChange) => void): () => void {
    return this.tasks.subscribe(listener);
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    try {
      await this.refresh();
      await this.ensureBuiltInModes();
      await this.checkDue();
    } catch (error) {
      this.recordFailure(error);
      this.scheduleRetry();
    }
  }

  private async ensureBuiltInModes(): Promise<void> {
    if (!this.backend.listModes || !this.backend.createMode) return;
    const modes = await this.backend.listModes();
    const existing = new Set(modes.map((mode) => mode.name.toLowerCase()));
    for (const mode of BUILT_IN_MODES) {
      if (!existing.has(mode.name.toLowerCase())) {
        await this.backend.createMode({ name: mode.name, actions: [...mode.actions] });
      }
    }
  }

  async execute(
    action: CompanionAction,
    options: { title: string; origin?: TaskOrigin } ,
  ) {
    const task = this.tasks.create({
      type: action.id,
      origin: options.origin ?? "user",
      title: options.title,
      action,
    });
    const result = await this.tasks.execute(task.id, this.executor);
    if (result.status === "succeeded" || result.status === "failed") {
      try {
        await this.refresh();
      } catch (error) {
        this.recordFailure(error);
        this.scheduleRetry();
      }
    }
    return result;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelWake?.();
    this.cancelWake = null;
    this.listeners.clear();
    this.dueListeners.clear();
  }

  private async checkDue(): Promise<void> {
    if (this.disposed || this.claimingDue) return;
    this.claimingDue = true;
    try {
      const now = this.clock().toISOString();
      const due = await this.backend.claimDueScheduledItems(now);
      if (this.disposed) return;
      for (const item of due) this.emitDue(item);
      await this.refresh();
    } finally {
      this.claimingDue = false;
      this.scheduleNext();
    }
  }

  async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    const items = await this.backend.listScheduledItems();
    if (this.disposed || generation !== this.refreshGeneration) return;
    this.items = items;
    for (const listener of this.listeners) {
      try {
        listener([...this.items]);
      } catch (error) {
        console.warn("scheduler list listener error", error);
      }
    }
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.disposed || !this.started || this.claimingDue) return;
    this.cancelWake?.();
    this.cancelWake = null;
    const next = this.items
      .filter((item) => item.status === "scheduled")
      .reduce<number | null>((nearest, item) => {
        const at = Date.parse(item.scheduledAt);
        if (!Number.isFinite(at)) return nearest;
        return nearest === null ? at : Math.min(nearest, at);
      }, null);
    if (next === null) return;
    const delay = Math.min(
      Math.min(MAX_TIMEOUT_MS, RETRY_MS),
      Math.max(0, next - this.clock().getTime()),
    );
    this.cancelWake = this.scheduleWake(() => {
      this.cancelWake = null;
      void this.checkDue().catch((error) => {
        this.recordFailure(error);
        this.scheduleRetry();
      });
    }, delay);
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    this.cancelWake?.();
    this.cancelWake = this.scheduleWake(() => {
      this.cancelWake = null;
      void this.retry();
    }, RETRY_MS);
  }

  private async retry(): Promise<void> {
    try {
      await this.refresh();
      await this.checkDue();
    } catch (error) {
      this.recordFailure(error);
      this.scheduleRetry();
    }
  }

  private emitDue(item: ScheduledItem): void {
    const actionId = item.kind === "alarm" ? "alarm.list" :
      item.kind === "important_date" ? "important_date.list" : "reminder.list";
    const task = this.tasks.create({
      type: `${item.kind}.triggered`,
      origin: "system",
      title: `${item.kind === "alarm" ? "Alarm" : item.kind === "important_date" ? "Important date" : "Reminder"}: ${item.title}`,
      action: { id: actionId, payload: {}, permission: "none" },
    });
    this.tasks.updateStatus(task.id, "running");
    this.tasks.complete(task.id, item);
    const reaction = item.kind === "alarm"
      ? reactionsFor("alarm_fired")[0]
      : reactionsFor("reminder_fired")[0];
    for (const listener of this.dueListeners) {
      try {
        listener({ item, reaction });
      } catch (error) {
        console.warn("scheduled due listener error", error);
      }
    }
  }

  private recordFailure(error: unknown): void {
    const task = this.tasks.create({
      type: "scheduler.failure",
      origin: "system",
      title: "Scheduled items unavailable",
      action: { id: "reminder.list", payload: {}, permission: "none" },
    });
    this.tasks.updateStatus(task.id, "running");
    const actionError: ActionError = {
      code: "scheduler_unavailable",
      message: error instanceof Error ? error.message : "Could not load scheduled items",
    };
    this.tasks.fail(task.id, actionError);
  }
}
