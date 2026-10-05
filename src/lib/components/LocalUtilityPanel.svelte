<script lang="ts">
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
    assistantRuntime, assistantEntities, onAssistantResult, onAssistantThinking,
    open,
    timers,
    currentTime,
    latestTask,
    scheduledItems,
    aliases,
    modes,
    systemVolume,
    notificationPermission,
    onToggle,
    onAction,
    onRequestNotificationPermission,
  }: Props = $props();

  let durationSeconds = $state(60);
  let label = $state("");
  let scheduleTitle = $state("");
  let scheduleMessage = $state("");
  let scheduledAtLocal = $state(defaultScheduledAt());
  let aliasPhrase = $state("");
  let aliasTargetType = $state<UserAlias["targetType"]>("website");
  let aliasTarget = $state("");
  let editingAliasId = $state<string | null>(null);
  let modeName = $state("");
  let modeVolume = $state(35);
  let modeApplication = $state("");
  let modeWebsite = $state("");
  let editingModeId = $state<string | null>(null);
  let clockNow = $state(Date.now());
  let visibleScheduledItems = $derived(
    scheduledItems.filter((item) => item.status === "scheduled" || item.status === "triggered"),
  );

  const action = (
    id: CompanionAction["id"],
    payload: unknown,
  ): CompanionAction => ({ id, payload, permission: "none" });

  function startTimer(durationMs: number, title: string, timerLabel = label): void {
    onAction(action("timer.create", { durationMs, label: timerLabel }), title);
  }

  function startScheduledItem(
    kind: "reminder" | "alarm" | "important_date",
    delayMs?: number,
  ): void {
    const defaultTitle = kind === "alarm" ? "Alarm" : kind === "important_date" ? "Important date" : "Reminder";
    const title = scheduleTitle.trim() || defaultTitle;
    const localDate = delayMs === undefined
      ? new Date(scheduledAtLocal)
      : new Date(Date.now() + delayMs);
    if (!Number.isFinite(localDate.getTime())) return;
    onAction(action(`${kind}.create`, {
      title,
      message: scheduleMessage.trim() || undefined,
      scheduledAt: localDate.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(kind === "important_date" ? { recurrence: "yearly" } : {}),
    }), `Create ${defaultTitle.toLowerCase()}: ${title}`);
    scheduleTitle = "";
    scheduleMessage = "";
    scheduledAtLocal = defaultScheduledAt();
  }

  function scheduledStatus(item: ScheduledItem): string {
    switch (item.status) {
      case "scheduled": return "Scheduled";
      case "triggered": return "Due";
      case "dismissed": return "Dismissed";
      case "cancelled": return "Cancelled";
    }
  }

  function scheduledKindLabel(item: ScheduledItem): string {
    return item.kind === "important_date" ? "Important date" :
      item.kind === "alarm" ? "Alarm" : "Reminder";
  }

  function isBuiltInMode(mode: AssistantMode): boolean {
    return ["study", "work", "focus", "relax"].includes(mode.name.toLowerCase());
  }

  function beginAliasEdit(aliasItem: UserAlias): void {
    editingAliasId = aliasItem.id;
    aliasPhrase = aliasItem.phrase;
    aliasTargetType = aliasItem.targetType;
    aliasTarget = aliasItem.target;
  }

  function beginModeEdit(modeItem: AssistantMode): void {
    editingModeId = modeItem.id;
    modeName = modeItem.name;
    modeVolume = readModeNumber(modeItem, "system.volume.set", "volume") ?? 35;
    modeApplication = readModeString(modeItem, "app.open", "application") ?? "";
    modeWebsite = readModeString(modeItem, "web.open", "url") ?? "";
  }

  function readModeAction(modeItem: AssistantMode, actionId: string): Record<string, unknown> | null {
    const match = modeItem.actions.find((entry) =>
      typeof entry === "object" && entry !== null &&
      "id" in entry && entry.id === actionId,
    );
    if (!isRecord(match) || !isRecord(match.payload)) return null;
    return match.payload;
  }

  function readModeString(modeItem: AssistantMode, actionId: string, key: string): string | null {
    const value = readModeAction(modeItem, actionId)?.[key];
    return typeof value === "string" ? value : null;
  }

  function readModeNumber(modeItem: AssistantMode, actionId: string, key: string): number | null {
    const value = readModeAction(modeItem, actionId)?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function scheduledActionId(
    item: ScheduledItem,
    operation: "cancel" | "dismiss",
  ): CompanionAction["id"] {
    return `${item.kind}.${operation}`;
  }

  function statusLabel(task: CompanionTask): string {
    switch (task.status) {
      case "queued": return "Queued";
      case "running": return "Working";
      case "waiting_for_user": return "Waiting for you";
      case "permission_required": return "Permission needed";
      case "succeeded":
        if (task.type === "timer.completed") return "Timer complete";
        if (
          typeof task.result === "object" && task.result !== null &&
          "status" in task.result && task.result.status === "partial_success"
        ) return "Partially complete";
        return "Complete";
      case "failed": return task.error?.message ?? "Failed";
      case "cancelled": return "Cancelled";
    }
  }

  function remainingLabel(timer: TimerSnapshot): string {
    const remaining = Math.max(0, timer.endsAt ? Date.parse(timer.endsAt) - clockNow : 0);
    const seconds = Math.ceil(remaining / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  function defaultScheduledAt(): string {
    const date = new Date(Date.now() + 5 * 60_000);
    date.setSeconds(0, 0);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  $effect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      clockNow = Date.now();
    }, 1_000);
    return () => clearInterval(interval);
  });
</script>

<div class="utility-anchor">
  <button
    class="utility-toggle"
    type="button"
    aria-expanded={open}
    aria-controls="local-utility-panel"
    onclick={onToggle}
  >{open ? "Close" : "Ask NYRC"}</button>

  {#if open}
    <section id="local-utility-panel" class="utility-panel" aria-label="NYRC command panel">
      <AssistantInput runtime={assistantRuntime} entities={assistantEntities} onResult={onAssistantResult} onThinking={onAssistantThinking} />
      <details><summary>Utilities & saved settings</summary>
      <div class="panel-heading">
        <h2>NYRC</h2>
        <button type="button" class="quiet-button" onclick={() => onAction(action("time.current", {}), "Get local time")}>
          Local time
        </button>
      </div>

      {#if currentTime}
        <p class="local-time">{currentTime.hours.toString().padStart(2, "0")}:{currentTime.minutes.toString().padStart(2, "0")} <span>{currentTime.timezone}</span></p>
      {/if}

      <section class="schedule-controls" aria-label="Reminders and alarms">
        <h3>Reminders, alarms & important dates</h3>
        <label>
          <span>Title</span>
          <input type="text" maxlength="120" bind:value={scheduleTitle} placeholder="What should NYRC remind you?" />
        </label>
        <label>
          <span>Note (optional)</span>
          <input type="text" maxlength="500" bind:value={scheduleMessage} />
        </label>
        <label>
          <span>Date and time</span>
          <input type="datetime-local" bind:value={scheduledAtLocal} />
        </label>
        <div class="quick-timers">
          <button type="button" onclick={() => startScheduledItem("reminder", 5_000)}>Reminder in 5 sec</button>
          <button type="button" onclick={() => startScheduledItem("alarm", 5_000)}>Alarm in 5 sec</button>
        </div>
        <div class="quick-timers">
          <button type="button" onclick={() => startScheduledItem("reminder")}>Schedule reminder</button>
          <button type="button" onclick={() => startScheduledItem("alarm")}>Schedule alarm</button>
          <button type="button" onclick={() => startScheduledItem("important_date")}>Add yearly date</button>
        </div>

        <div class="notification-permission">
          {#if notificationPermission === "granted"}
            <span>Desktop notifications enabled</span>
          {:else if notificationPermission === "not_requested"}
            <button type="button" class="quiet-button" onclick={onRequestNotificationPermission}>
              Enable desktop notifications
            </button>
          {:else if notificationPermission === "denied"}
            <span>Desktop notifications denied; in-app alerts remain on</span>
          {:else}
            <span>Desktop notifications unavailable; in-app alerts remain on</span>
          {/if}
        </div>

        {#if visibleScheduledItems.length > 0}
          <ul class="timer-list" aria-label="Reminders and alarms">
            {#each visibleScheduledItems as item (item.id)}
              <li>
                <span>
                  <strong>{scheduledKindLabel(item)}: {item.title}</strong>
                  <small>
                    {scheduledStatus(item)}
                    {item.recurrence === "yearly" ? " · Yearly" : ""}
                    {" · "}{new Date(item.scheduledAt).toLocaleString()}
                  </small>
                </span>
                {#if item.status === "scheduled"}
                  <button
                    type="button"
                    class="quiet-button"
                    aria-label={`Cancel ${item.title}`}
                    onclick={() => onAction(action(scheduledActionId(item, "cancel"), { id: item.id }), `Cancel ${item.title}`)}
                  >Cancel</button>
                {:else if item.status === "triggered"}
                  <button
                    type="button"
                    class="quiet-button"
                    aria-label={`Dismiss ${item.title}`}
                    onclick={() => onAction(action(scheduledActionId(item, "dismiss"), { id: item.id }), `Dismiss ${item.title}`)}
                  >Dismiss</button>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty-state">No scheduled reminders or alarms</p>
        {/if}
      </section>

      <div class="quick-timers">
        <button type="button" onclick={() => startTimer(5_000, "Start 5-second timer", "Test timer")}>5 sec</button>
        <button type="button" onclick={() => startTimer(25 * 60_000, "Start 25-minute timer", "25-minute timer")}>25 min</button>
      </div>

      <form
        class="custom-timer"
        onsubmit={(event) => {
          event.preventDefault();
          startTimer(Math.round(durationSeconds * 1_000), "Start custom timer");
        }}
      >
        <label>
          <span>Seconds</span>
          <input type="number" min="1" step="1" bind:value={durationSeconds} aria-label="Custom timer duration in seconds" />
        </label>
        <label>
          <span>Label</span>
          <input type="text" maxlength="80" bind:value={label} aria-label="Custom timer label" placeholder="Optional" />
        </label>
        <button type="submit">Start</button>
      </form>

      <div class="task-status" aria-live="polite">
        {#if latestTask}
          <strong>{latestTask.title}</strong>
          <span class:failed={latestTask.status === "failed"}>{statusLabel(latestTask)}</span>
        {/if}
      </div>

      {#if timers.length > 0}
        <ul class="timer-list" aria-label="Active timers">
          {#each timers as timer (timer.id)}
            <li>
              <span><strong>{timer.label}</strong><small>{remainingLabel(timer)}</small></span>
              <button
                type="button"
                class="quiet-button"
                aria-label={`Cancel ${timer.label}`}
                onclick={() => onAction(action("timer.cancel", { id: timer.id }), `Cancel ${timer.label}`)}
              >Cancel</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty-state">No active timers</p>
      {/if}

      <section class="assistant-controls" aria-label="Desktop controls">
        <h3>Desktop controls</h3>
        <p class="control-value">System volume: {systemVolume === null ? "Unavailable" : `${systemVolume}%`}</p>
        <div class="quick-timers">
          <button type="button" onclick={() => onAction(action("system.volume.decrease", { amount: 10 }), "Lower system volume")}>−10</button>
          <button type="button" onclick={() => onAction(action("system.volume.get", {}), "Read system volume")}>Read</button>
          <button type="button" onclick={() => onAction(action("system.volume.increase", { amount: 10 }), "Raise system volume")}>+10</button>
          <button type="button" onclick={() => onAction(action("system.volume.mute", {}), "Mute system volume")}>Mute</button>
          <button type="button" onclick={() => onAction(action("system.volume.unmute", {}), "Unmute system volume")}>Unmute</button>
        </div>
        <div class="quick-timers">
          <button type="button" onclick={() => onAction(action("media.next", {}), "Skip media track")}>Media next</button>
          <button type="button" onclick={() => onAction(action("system.focus.enable", {}), "Enable system Focus")}>Enable Focus</button>
          <button type="button" onclick={() => onAction(action("system.dnd.enable", {}), "Enable Do Not Disturb")}>Enable DND</button>
        </div>
        <p class="empty-state">Media and Focus/DND actions return explicit unsupported results.</p>
      </section>

      <section class="assistant-controls" aria-label="Website and application aliases">
        <h3>Aliases</h3>
        <form class="control-form" onsubmit={(event) => {
          event.preventDefault();
          onAction(action(editingAliasId ? "alias.update" : "alias.create", {
            ...(editingAliasId ? { id: editingAliasId } : {}),
            phrase: aliasPhrase,
            targetType: aliasTargetType,
            target: aliasTarget,
          }), `${editingAliasId ? "Update" : "Save"} alias: ${aliasPhrase.trim()}`);
          aliasPhrase = "";
          aliasTarget = "";
          editingAliasId = null;
        }}>
          <label><span>Phrase</span><input bind:value={aliasPhrase} maxlength="80" required placeholder="open notes" /></label>
          <label>
            <span>Opens</span>
            <select bind:value={aliasTargetType}>
              <option value="website">Website</option>
              <option value="application">Allowlisted application</option>
              <option value="mode">Assistant mode</option>
            </select>
          </label>
          <label><span>Website or app name</span><input bind:value={aliasTarget} maxlength="500" required placeholder="https://example.com" /></label>
          <button type="submit">{editingAliasId ? "Update alias" : "Save alias"}</button>
          {#if editingAliasId}
            <button type="button" class="quiet-button" onclick={() => {
              editingAliasId = null;
              aliasPhrase = "";
              aliasTarget = "";
            }}>Stop editing</button>
          {/if}
        </form>
        {#if aliases.length}
          <ul class="control-list">
            {#each aliases as aliasItem (aliasItem.id)}
              <li>
                <span><strong>{aliasItem.phrase}</strong><small>{aliasItem.target}</small></span>
                <button type="button" class="quiet-button" onclick={() => onAction(action("alias.execute", { phrase: aliasItem.phrase }), `Run alias: ${aliasItem.phrase}`)}>Run</button>
                <button type="button" class="quiet-button" aria-label={`Edit alias ${aliasItem.phrase}`} onclick={() => beginAliasEdit(aliasItem)}>Edit</button>
                <button type="button" class="quiet-button" aria-label={`Delete alias ${aliasItem.phrase}`} onclick={() => onAction(action("alias.delete", { id: aliasItem.id }), `Delete alias: ${aliasItem.phrase}`)}>Delete</button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty-state">No aliases yet</p>
        {/if}
      </section>

      <section class="assistant-controls" aria-label="Assistant modes">
        <h3>Modes</h3>
        <form class="control-form" onsubmit={(event) => {
          event.preventDefault();
          const actions: CompanionAction[] = [
            action("system.volume.set", { volume: modeVolume }),
            ...(modeApplication ? [action("app.open", { application: modeApplication })] : []),
            ...(modeWebsite.trim() ? [action("web.open", { url: modeWebsite.trim() })] : []),
          ];
          onAction(action(editingModeId ? "mode.update" : "mode.create", {
            ...(editingModeId ? { id: editingModeId } : {}),
            name: modeName,
            actions,
          }), `${editingModeId ? "Update" : "Save"} mode: ${modeName.trim()}`);
          modeName = "";
          modeWebsite = "";
          editingModeId = null;
        }}>
          <label><span>Mode name</span><input bind:value={modeName} maxlength="60" required placeholder="Study" /></label>
          <label><span>Volume</span><input type="number" min="0" max="100" bind:value={modeVolume} /></label>
          <label>
            <span>Application (optional)</span>
            <select bind:value={modeApplication}>
              <option value="">None</option>
              <option value="Visual Studio Code">Visual Studio Code</option>
              <option value="Antigravity">Antigravity</option>
              <option value="Safari">Safari</option>
              <option value="Terminal">Terminal</option>
            </select>
          </label>
          <label><span>Website (optional)</span><input bind:value={modeWebsite} maxlength="500" placeholder="https://example.com" /></label>
          <button type="submit">{editingModeId ? "Update mode" : "Save mode"}</button>
          {#if editingModeId}
            <button type="button" class="quiet-button" onclick={() => {
              editingModeId = null;
              modeName = "";
              modeWebsite = "";
              modeApplication = "";
              modeVolume = 35;
            }}>Stop editing</button>
          {/if}
        </form>
        {#if modes.length}
          <ul class="control-list">
            {#each modes as modeItem (modeItem.id)}
              <li>
                <span><strong>{modeItem.name}</strong><small>{modeItem.actions.length} actions</small></span>
                <button type="button" class="quiet-button" onclick={() => onAction(action("mode.activate", { name: modeItem.name }), `Start ${modeItem.name} mode`)}>Start</button>
                <button type="button" class="quiet-button" aria-label={`Edit mode ${modeItem.name}`} onclick={() => beginModeEdit(modeItem)}>Edit</button>
                {#if !isBuiltInMode(modeItem)}
                  <button type="button" class="quiet-button" aria-label={`Delete mode ${modeItem.name}`} onclick={() => onAction(action("mode.delete", { id: modeItem.id }), `Delete mode: ${modeItem.name}`)}>Delete</button>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty-state">No modes yet</p>
        {/if}
      </section>
      </details>
    </section>
  {/if}
</div>

<style>
  .utility-anchor {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 6;
    pointer-events: auto;
    font: 12px/1.35 system-ui, sans-serif;
    color: #26232b;
  }
  .utility-toggle,
  .quick-timers button,
  .custom-timer button {
    border: 1px solid rgba(30, 35, 45, 0.12);
    border-radius: 8px;
    background: rgba(250, 250, 252, 0.96);
    color: inherit;
    padding: 6px 9px;
    cursor: pointer;
  }
  .control-form button {
    border: 1px solid rgba(30, 35, 45, 0.12);
    border-radius: 7px;
    background: rgba(30, 35, 45, 0.07);
    color: inherit;
    padding: 5px 7px;
    cursor: pointer;
  }
  .utility-toggle {
    font-weight: 600;
    box-shadow: 0 3px 12px rgba(15, 20, 30, 0.12);
  }
  .utility-panel {
    position: absolute;
    top: 38px;
    right: 0;
    box-sizing: border-box;
    width: 300px;
    max-height: calc(100vh - 132px);
    overflow-y: auto;
    padding: 11px;
    border: 1px solid rgba(30, 35, 45, 0.12);
    border-radius: 12px;
    background: rgba(250, 250, 252, 0.98);
    box-shadow: 0 8px 26px rgba(15, 20, 30, 0.18);
  }
  .panel-heading,
  .quick-timers,
  .custom-timer,
  .timer-list li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .panel-heading {
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 650;
  }
  h3 {
    margin: 8px 0 5px;
    font-size: 11px;
    font-weight: 650;
  }
  .quiet-button {
    border: 0;
    border-radius: 6px;
    background: rgba(30, 35, 45, 0.07);
    color: inherit;
    padding: 5px 7px;
    cursor: pointer;
  }
  .local-time {
    margin: 7px 0;
    font-size: 19px;
    font-variant-numeric: tabular-nums;
  }
  .local-time span {
    font-size: 10px;
    color: #6e7078;
  }
  .quick-timers {
    margin: 8px 0;
  }
  .custom-timer {
    align-items: end;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .custom-timer label {
    display: grid;
    flex: 1 1 88px;
    gap: 3px;
    color: #686a72;
    font-size: 10px;
  }
  .schedule-controls > label {
    display: grid;
    gap: 3px;
    margin: 5px 0;
    color: #686a72;
    font-size: 10px;
  }
  .schedule-controls .quick-timers {
    flex-wrap: wrap;
  }
  .assistant-controls {
    margin-top: 10px;
    padding-top: 7px;
    border-top: 1px solid rgba(30, 35, 45, 0.09);
  }
  .assistant-controls .quick-timers {
    flex-wrap: wrap;
  }
  .control-value {
    margin: 5px 0;
    color: #686a72;
    font-size: 10px;
  }
  .control-form {
    display: grid;
    gap: 5px;
    margin: 7px 0;
  }
  .control-form label {
    display: grid;
    gap: 3px;
    color: #686a72;
    font-size: 10px;
  }
  .control-form select {
    width: 100%;
    border: 1px solid rgba(30, 35, 45, 0.16);
    border-radius: 6px;
    padding: 5px 6px;
    color: #26232b;
    background: white;
    font: inherit;
    font-size: 11px;
  }
  .control-list {
    display: grid;
    gap: 5px;
    margin: 7px 0 0;
    padding: 0;
    list-style: none;
  }
  .control-list li {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
  }
  .control-list li span {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .control-list strong,
  .control-list small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .control-list small {
    color: #777982;
  }
  .notification-permission {
    padding: 5px 0;
    color: #777982;
    font-size: 10px;
  }
  input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    border: 1px solid rgba(30, 35, 45, 0.16);
    border-radius: 6px;
    padding: 5px 6px;
    color: #26232b;
    background: white;
    font: inherit;
    font-size: 11px;
  }
  .task-status {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 0;
    border-top: 1px solid rgba(30, 35, 45, 0.09);
    border-bottom: 1px solid rgba(30, 35, 45, 0.09);
    font-size: 10px;
  }
  .task-status strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .task-status span,
  .empty-state {
    color: #777982;
  }
  .task-status .failed {
    color: #a33d3d;
  }
  .timer-list {
    display: grid;
    gap: 5px;
    margin: 7px 0 0;
    padding: 0;
    list-style: none;
  }
  .timer-list li {
    justify-content: space-between;
    font-size: 10px;
  }
  .timer-list li span {
    display: grid;
    min-width: 0;
  }
  .timer-list strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .timer-list small {
    color: #777982;
  }
  .empty-state {
    margin: 8px 0 1px;
    font-size: 10px;
  }
</style>
