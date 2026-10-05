import { CapabilityRegistry } from "../platform/capabilities";
import { TaskManager } from "../tasks/taskManager";
import { LocalUtilityExecutor } from "../tasks/localUtilityExecutor";
import { DesktopAssistantExecutor } from "../tasks/desktopAssistantExecutor";
import { SchedulerExecutor } from "../tasks/schedulerExecutor";
import {
  actionFailure,
  type ActionExecutor,
  type CompanionAction,
} from "../tasks/action";
import { api } from "../bridge/api";
import { invoke } from "../bridge/tauri";
import { localRoute, type Entities, type Route } from "./router";
import { validateProposal } from "./proposals";
import {
  normalizeReply,
  defaultPersonality,
  type Personality,
} from "./personality";
import { estimateState, adaptation, type StateSignals } from "./state";
import type { TimerService } from "../tasks/timerService";
import type { CompanionTask } from "../tasks/task";
export class AssistantRuntime {
  readonly tasks = new TaskManager();
  personality: Personality = defaultPersonality;
  private focusMode = false;
  private manual: StateSignals["manual"];
  private calendarHours = 0;
  private interactions: { at: number; text: string }[] = [];
  private developerResults: { at: number; ok: boolean }[] = [];
  private bodyInteractions: {at:number;text:string}[]=[];
  observeBody(type:string) {
    if(["touch","hold","double_tap","shake","pickup","put_down","sleep","wake"].includes(type)) {
      this.bodyInteractions.push({at:Date.now(),text:type});
      this.interactions.push({at:Date.now(),text:`body:${type}`});
      this.adapt({});
    }
  }
  observeDeveloper(type: string) {
    if (/passed|success|completed|failed/.test(type))
      this.developerResults.push({ at: Date.now(), ok: !/failed/.test(type) });
    this.adapt({});
  }
  estimatedState = estimateState({ hour: new Date().getHours() });
  private adapt(entities: Entities) {
    const cutoff = Date.now() - 3600000;
    const recent = this.tasks
      .list()
      .filter((t) => Date.parse(t.createdAt) >= cutoff)
      .slice(-20);
    this.developerResults = this.developerResults
      .filter((e) => e.at >= cutoff)
      .slice(-20);
    this.interactions = this.interactions
      .filter((e) => e.at >= cutoff)
      .slice(-50);
    this.bodyInteractions=this.bodyInteractions.filter(e=>e.at>=cutoff).slice(-50);
    this.estimatedState = estimateState({
      hour: new Date().getHours(),
      successes:
        recent.filter((t) => t.status === "succeeded").length +
        this.developerResults.filter((e) => e.ok).length,
      failures:
        recent.filter((t) => t.status === "failed").length +
        this.developerResults.filter((e) => !e.ok).length,
      focusMode: this.focusMode,
      activeReminders: entities.scheduled?.filter(
        (s) => s.status === "scheduled",
      ).length,
      dismissed: entities.scheduled?.filter((s) => s.status === "dismissed")
        .length,
      interactions: this.interactions.length,
      repeatedInteractions: this.interactions.filter(
        (e) => e.text === this.interactions.at(-1)?.text,
      ).length,
      calendarHours: this.calendarHours,
      body:{shakes:this.bodyInteractions.filter(e=>e.text==="shake").length,pickups:this.bodyInteractions.filter(e=>e.text==="pickup").length,absence:this.bodyInteractions.at(-1)?.text==="sleep"},
      manual: this.manual,
    });
    return adaptation(this.estimatedState);
  }
  private executor: ActionExecutor;
  constructor(
    timers: TimerService,
    private ai: (input: string) => Promise<unknown> = (input) =>
      invoke("assistant_interpret", { input }),
    executors?: ActionExecutor[],
  ) {
    const services: ActionExecutor = {
      canExecute: (a) =>
        /^(pocket|calendar|clipboard)\./.test(a.id) ||
        a.id === "developer.task.status",
      execute: async (a) => {
        const blocked=await new CapabilityRegistry().check(a.id);
        if(blocked)return actionFailure(blocked.code,blocked.message);
        return invoke("assistant_service", { action: a.id, payload: a.payload })
          .then((data) => ({ ok: true as const, data }))
          .catch((error: unknown) =>
            actionFailure(
              "service_unavailable",
              typeof error === "string" && error.length < 300
                ? error
                : "The service is unavailable. Check its settings and try again.",
            ),
          );
      },
    };
    const all = executors ?? [
      new LocalUtilityExecutor(timers),
      new DesktopAssistantExecutor(),
      new SchedulerExecutor(api),
      services,
    ];
    this.executor = {
      canExecute: (a) => all.some((e) => e.canExecute(a)),
      execute: async (a) => {
        const e = all.find((e) => e.canExecute(a));
        return e
          ? e.execute(a)
          : actionFailure("unsupported_action", "This action is unavailable.");
      },
    };
  }
  async submit(
    input: string,
    entities: Entities = {},
  ): Promise<{ route: Route; task?: CompanionTask; message: string }> {
    this.interactions.push({
      at: Date.now(),
      text: input.trim().toLowerCase(),
    });
    const adapted = this.adapt(entities);
    const manual = /^i feel (tired|focused|calm|busy)$/i.exec(input.trim());
    if (manual) {
      this.manual =
        manual[1].toLowerCase() === "tired"
          ? { fatigue: 0.8 }
          : manual[1].toLowerCase() === "focused"
            ? { focus: 0.85 }
            : manual[1].toLowerCase() === "busy"
              ? { stress: 0.7 }
              : { stress: 0.15, valence: 0.65 };
      this.adapt(entities);
      return {
        route: { source: "local", confidence: 1 },
        message: "Got it. I’ll keep that in mind for this session.",
      };
    }
    let route = localRoute(input, entities);
    if (!route) {
      try {
        const p = validateProposal(await this.ai(input));
        if (!p)
          return {
            route: { source: "clarification", confidence: 0 },
            message:
              "I could not safely interpret that. Please give a more specific request.",
          };
        if (p.kind === "reply")
          return {
            route: { source: "ai", confidence: 1 },
            message: normalizeReply(
              p.message,
              this.personality,
              adapted.shortReplies,
            ),
          };
        route = {
          source: "ai",
          confidence: 1,
          action: p.action,
          intent: p.action.id,
        };
      } catch {
        return {
          route: { source: "clarification", confidence: 0 },
          message:
            "AI is unavailable. Try a local command, such as “timer 25 minutes”, or give more detail.",
        };
      }
    }
    if (!route.action)
      return { route, message: route.message ?? "Please give more detail." };
    const task = await this.execute(route.action, input);
    if (task.status === "succeeded" && task.action.id === "mode.activate")
      this.focusMode = /study|work|focus/i.test(
        String((task.action.payload as { name: string }).name),
      );
    if (
      task.status === "succeeded" &&
      task.action.id === "calendar.list" &&
      Array.isArray(task.result)
    ) {
      this.calendarHours = Math.min(
        24,
        task.result
          .filter((e) => !e.allDay)
          .reduce(
            (total, e) =>
              total +
              Math.max(0, (Date.parse(e.end) - Date.parse(e.start)) / 3600000),
            0,
          ),
      );
    }
    this.adapt(entities);
    return {
      route,
      task,
      message: normalizeReply(
        taskMessage(task),
        this.personality,
        adapted.shortReplies,
      ),
    };
  }
  async execute(action: CompanionAction, title: string) {
    const task = this.tasks.create({
      type: action.id,
      origin: "user",
      title,
      action,
    });
    return this.tasks.execute(task.id, this.executor);
  }
  async permission(id: string, allow: boolean) {
    if (!allow) return this.tasks.denyPermission(id);
    this.tasks.approvePermission(id);
    return this.tasks.execute(id, this.executor);
  }
}
export function taskMessage(t: CompanionTask): string {
  if (t.status === "permission_required") return "Ready when you approve.";
  if (t.status === "failed")
    return t.error?.message ?? "That did not complete.";
  const v = t.result as Record<string, unknown> | undefined;
  if (t.action.id === "time.current" && typeof v?.iso === "string")
    return new Date(v.iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  if (typeof v?.volume === "number") return `Volume: ${v.volume}%`;
  if (typeof v?.muted === "boolean") return v.muted ? "Muted." : "Unmuted.";
  if (typeof v?.scheduledAt === "string")
    return `Scheduled: ${v.title} · ${new Date(v.scheduledAt).toLocaleString()}`;
  if (t.action.id.startsWith("pocket.save") && typeof v?.id === "string")
    return `Saved: ${v.title} [${v.id}]`;
  if (Array.isArray(t.result))
    return t.result.length
      ? t.result
          .slice(0, 30)
          .map(
            (i: any) =>
              `${i.title ?? i.label ?? i.summary ?? i.id}${i.id ? ` [${i.id}]` : ""}${i.start ? ` · ${typeof i.start === "string" ? i.start : (i.start.dateTime ?? i.start.date)}` : ""}`,
          )
          .join("\n")
      : "Nothing here yet.";
  if (v?.exported === true) return `Exported to NYRC exports: ${v.name}`;
  if (
    v?.itemType === "file" &&
    (v.metadata as { encoding?: string })?.encoding === "base64"
  )
    return "Binary file retrieved. Use “export pocket <id>” to save a copy in NYRC exports.";
  if (typeof v?.message === "string") return normalizeReply(v.message);
  if (typeof v?.content === "string")
    return normalizeReply(v.content, {
      warmth: 0.65,
      humor: 0.3,
      verbosity: 1,
      initiative: 0.35,
      expressiveness: 0.4,
      formality: 0.55,
      playfulness: 0.3,
    });
  if (v?.status === "partial_success")
    return "Some steps completed. One or more capabilities are unavailable.";
  return t.status === "succeeded" ? "Done." : t.status;
}
