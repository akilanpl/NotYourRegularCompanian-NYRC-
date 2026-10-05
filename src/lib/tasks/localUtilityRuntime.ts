import { reactionsFor, type Reaction } from "../character";
import type { CompanionAction } from "./action";
import { LocalUtilityExecutor } from "./localUtilityExecutor";
import type { TaskOrigin, TaskStatusChange } from "./task";
import { TaskManager } from "./taskManager";
import type { TimerSnapshot } from "./timerService";
import { TimerService } from "./timerService";

export type TimerFinishedEvent = Readonly<{
  timer: TimerSnapshot;
  reaction: Reaction;
}>;

export type UtilityTaskListener = (change: TaskStatusChange) => void;
export type TimerFinishedListener = (event: TimerFinishedEvent) => void;

export class LocalUtilityRuntime {
  readonly tasks: TaskManager;
  readonly timers: TimerService;
  private readonly executor: LocalUtilityExecutor;
  private readonly timerListeners = new Set<TimerFinishedListener>();
  private readonly unsubscribeTimer: () => void;

  constructor(timers = new TimerService()) {
    this.tasks = new TaskManager();
    this.timers = timers;
    this.executor = new LocalUtilityExecutor(timers);
    this.unsubscribeTimer = timers.subscribe((timer) => this.onTimerFinished(timer));
  }

  subscribe(listener: UtilityTaskListener): () => void {
    return this.tasks.subscribe(listener);
  }

  subscribeTimerFinished(listener: TimerFinishedListener): () => void {
    this.timerListeners.add(listener);
    return () => this.timerListeners.delete(listener);
  }

  async execute(
    action: CompanionAction,
    options: { title: string; origin?: TaskOrigin },
  ) {
    const task = this.tasks.create({
      type: action.id,
      origin: options.origin ?? "user",
      title: options.title,
      action,
    });
    return this.tasks.execute(task.id, this.executor);
  }

  dispose(): void {
    this.unsubscribeTimer();
    this.timerListeners.clear();
    this.timers.dispose();
  }

  private onTimerFinished(timer: TimerSnapshot): void {
    const task = this.tasks.create({
      type: "timer.completed",
      origin: "system",
      title: `Timer finished: ${timer.label}`,
      action: {
        id: "timer.completed",
        payload: {},
        permission: "none",
      },
    });
    this.tasks.updateStatus(task.id, "running");
    this.tasks.complete(task.id, timer);

    const event: TimerFinishedEvent = {
      timer,
      reaction: reactionsFor("timer_finished")[0],
    };
    for (const listener of this.timerListeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn("timer finished listener error", error);
      }
    }
  }
}
