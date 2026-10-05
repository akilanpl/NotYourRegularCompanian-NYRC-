<script lang="ts">
  import { taskLabels } from "../product/presentation";
  import AssistantInput from "./AssistantInput.svelte";
  import type { AssistantRuntime } from "../assistant/runtime";
  import type { Entities } from "../assistant/router";
  import type { CurrentTimeResult } from "../tasks/localUtilityExecutor";
  import type { CompanionAction } from "../tasks/action";
  import type { CompanionTask } from "../tasks/task";
  import type { TimerSnapshot } from "../tasks/timerService";
  import type {
    AssistantMode,
    ScheduledItem,
    UserAlias,
  } from "../tasks/scheduledItem";
  import type { ScheduledNotificationPermission } from "../bridge/scheduledNotifications";

  type Props = {
    instanceName: string;
    assistantRuntime: AssistantRuntime;
    assistantEntities: () => Entities;
    onAssistantResult: (task?: CompanionTask) => void;
    onAssistantThinking: () => void;
    open: boolean;
    timers: TimerSnapshot[];
    currentTime: CurrentTimeResult | null;
    latestTask: CompanionTask | null;
    scheduledItems: ScheduledItem[];
    aliases: UserAlias[];
    modes: AssistantMode[];
    systemVolume: number | null;
    notificationPermission: ScheduledNotificationPermission;
    onToggle: () => void;
    onAction: (action: CompanionAction, title: string) => void;
    onRequestNotificationPermission: () => void;
  };

  let {
    instanceName,
    assistantRuntime,
    assistantEntities,
    onAssistantResult,
    onAssistantThinking,
    open,
    timers,
    currentTime,
    latestTask,
    scheduledItems,
    modes,
    onToggle,
    onAction,
  }: Props = $props();

  const action = (
    id: CompanionAction["id"],
    payload: unknown,
  ): CompanionAction => ({ id, payload, permission: "none" });
  let tab = $state("Timers");
  let modeResult = $state<
    | {
        mode?: string;
        status?: string;
        steps?: { action: string; ok: boolean }[];
      }
    | undefined
  >();
  $effect(() => {
    if (latestTask?.action.id === "mode.activate" && latestTask.result)
      modeResult = latestTask.result as typeof modeResult;
  });
  const stepNames: Record<string, string> = {
    "system.volume.set": "Volume",
    "system.focus.enable": "Focus control",
    "system.dnd.enable": "Do not disturb",
    "app.open": "Open application",
    "web.open": "Open website",
  };
  const descriptions: Record<string, string> = {
    Study: "Make room to learn.",
    Work: "Set up your work tools.",
    Focus: "Reduce interruptions.",
    Relax: "Take a little space.",
  };
</script>

<div class="utility-anchor">
  {#if !open}<button
      data-interactive
      class="utility-toggle"
      aria-expanded={open}
      onclick={onToggle}>Ask companion</button
    >{/if}
  {#if open}<section
      class="utility-panel"
      aria-label="Assistant"
      data-interactive
    >
      <header class="row">
        <strong>{instanceName}</strong><small>Local features ready</small
        ><button aria-label="Close assistant" onclick={onToggle}>×</button>
      </header>
      <AssistantInput
        runtime={assistantRuntime}
        entities={assistantEntities}
        onResult={onAssistantResult}
        onThinking={onAssistantThinking}
      />
      <nav class="row" aria-label="Quick tools">
        {#each ["Timers", "Reminders", "Modes"] as name}<button
            aria-pressed={tab === name}
            onclick={() => (tab = name)}>{name}</button
          >{/each}
      </nav>
      {#if tab === "Timers"}<div class="row">
          <button
            onclick={() =>
              onAction(
                action("timer.create", {
                  durationMs: 25 * 60000,
                  label: "Focus",
                }),
                "25 minute timer",
              )}>25 minute timer</button
          ><button
            onclick={() => onAction(action("time.current", {}), "Local time")}
            >Time</button
          >
        </div>
        {#if currentTime}<p>
            {currentTime.hours.toString().padStart(2, "0")}:{currentTime.minutes
              .toString()
              .padStart(2, "0")}
          </p>{/if}
        {#each timers.filter((t) => t.status === "running") as timer}<div
            class="tool"
          >
            <span>{timer.label || "Timer"}</span><button
              onclick={() =>
                onAction(
                  action("timer.cancel", { id: timer.id }),
                  "Cancel timer",
                )}>Cancel</button
            >
          </div>{/each}
      {:else if tab === "Reminders"}<p class="muted">
          Ask “remind me in 10 minutes to take a break”.
        </p>
        {#each scheduledItems.filter( (i) => ["scheduled", "triggered"].includes(i.status) ) as item}<div
            class="tool"
          >
            <span
              >{item.title}<small
                >{new Date(item.scheduledAt).toLocaleString()}</small
              ></span
            ><button
              onclick={() =>
                onAction(
                  action(
                    `${item.kind}.${item.status === "triggered" ? "dismiss" : "cancel"}`,
                    { id: item.id },
                  ),
                  "Update reminder",
                )}>{item.status === "triggered" ? "Dismiss" : "Cancel"}</button
            >
          </div>{/each}
      {:else}<div class="stack">
          {#each modes as mode}<button
              class="mode"
              onclick={() =>
                onAction(
                  action("mode.activate", { name: mode.name }),
                  mode.name,
                )}
              ><strong
                >{mode.name}{modeResult?.mode === mode.name
                  ? " · Active"
                  : ""}</strong
              ><small
                >{descriptions[mode.name] || "Your saved setup"} · {mode.actions
                  .length} steps</small
              ></button
            >{/each}
        </div>{/if}
      {#if modeResult?.steps}<div aria-label="Mode results">
          {#each modeResult.steps as step}<p>
              {stepNames[step.action] || "Mode step"} · {step.ok
                ? "Complete"
                : "Unavailable"}
            </p>{/each}
        </div>{/if}
      {#if latestTask}<p role="status" class="muted">
          {latestTask.title} · {taskLabels[latestTask.status]}
        </p>{/if}
    </section>{/if}
</div>

<style>
  .utility-anchor {
    position: absolute;
    left: 12px;
    right: 12px;
    top: 52px;
    pointer-events: auto;
  }
  .utility-toggle {
    box-shadow: var(--shadow);
  }
  .utility-panel {
    margin-top: 0;
    max-height: calc(100vh - 64px);
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px;
    box-shadow: var(--shadow);
  }
  header {
    margin-bottom: 12px;
  }
  header button {
    margin-left: auto;
  }
  .tool {
    display: flex;
    gap: 8px;
    justify-content: space-between;
    margin: 10px 0;
  }
  .tool small,
  .mode small {
    display: block;
  }
  .mode {
    text-align: left;
  }
  nav {
    margin: 12px 0;
  }
  nav button[aria-pressed="true"] {
    border-color: var(--accent);
  }
  p {
    margin-top: 10px;
  }
</style>
