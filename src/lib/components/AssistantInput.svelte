<script lang="ts">
  import PocketTray from "./PocketTray.svelte";
  import { onMount, untrack } from "svelte";
  import type { AssistantRuntime } from "../assistant/runtime";
  import { taskMessage } from "../assistant/runtime";
  import type { Entities } from "../assistant/router";
  import type { CompanionTask } from "../tasks/task";
  import type { CompanionAction } from "../tasks/action";
  import { taskLabels } from "../product/presentation";
  let {
    runtime,
    entities,
    onResult,
    onThinking,
  }: {
    runtime: AssistantRuntime;
    entities: () => Entities;
    onResult: (task?: CompanionTask) => void;
    onThinking: () => void;
  } = $props();
  let input = $state("");
  let response = $state("What can I help with?");
  let request = $state("");
  let busy = $state(false);
  let tasks = $state<CompanionTask[]>(untrack(() => runtime.tasks.list()));
  let result = $state<unknown>(null);
  let field: HTMLInputElement;
  let view = $state("");
  let title = $state("");
  let start = $state("");
  let end = $state("");
  let editId = $state("");
  type Item = {
    id: string;
    title?: string;
    itemType?: string;
    createdAt?: string;
    start?: string;
    end?: string;
    content?: string;
    metadata?: { encoding?: string };
  };
  let items = $derived(Array.isArray(result) ? (result as Item[]) : []);
  let pending = $derived(
    tasks.filter((t) => t.status === "permission_required"),
  );
  let content = $derived(
    result &&
      typeof result === "object" &&
      "content" in result &&
      typeof result.content === "string" &&
      (!("metadata" in result) ||
        (result.metadata as Item["metadata"])?.encoding !== "base64")
      ? result.content
      : null,
  );
  onMount(() => {
    field?.focus();
    tasks = runtime.tasks.list();
    return runtime.tasks.subscribe(() => (tasks = runtime.tasks.list()));
  });
  async function submit(value = input) {
    if (busy || !value.trim()) return;
    input = "";
    request = value;
    busy = true;
    onThinking();
    try {
      const r = await runtime.submit(value, entities());
      response = r.message;
      result = r.task?.result;
      onResult(r.task);
    } catch {
      response = "Couldn’t complete that. Local commands are still available.";
    } finally {
      busy = false;
      field?.focus();
    }
  }
  async function action(
    id: CompanionAction["id"],
    payload: unknown,
    label: string,
    permission: CompanionAction["permission"] = "none",
  ) {
    busy = true;
    request = label;
    try {
      const task = await runtime.execute({ id, payload, permission }, label);
      result = task.result;
      response = taskMessage(task);
      onResult(task);
    } catch {
      response = "Couldn’t complete that action.";
    } finally {
      busy = false;
    }
  }
  async function permission(t: CompanionTask, allow: boolean) {
    busy = true;
    try {
      const task = await runtime.permission(t.id, allow);
      response = !allow ? "Action denied." : taskMessage(task);
      result = task.result;
      onResult(task);
    } finally {
      busy = false;
    }
  }
  async function pocket() {
    view = "Pocket";
    await action("pocket.list", {}, "Pocket");
  }
  async function calendar(tomorrow = false) {
    view = "Calendar";
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    if (tomorrow) from.setDate(from.getDate() + 1);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    await action(
      "calendar.list",
      { start: from.toISOString(), end: to.toISOString() },
      tomorrow ? "Tomorrow" : "Today",
    );
  }
  function calendarSave() {
    const a = new Date(start),
      b = new Date(end);
    if (
      !title.trim() ||
      !Number.isFinite(a.getTime()) ||
      !Number.isFinite(b.getTime()) ||
      b <= a
    ) {
      response = "Choose a title and an end time after the start.";
      return;
    }
    void action(
      editId ? "calendar.update" : "calendar.create",
      {
        ...(editId ? { id: editId } : {}),
        title,
        start: a.toISOString(),
        end: b.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      editId ? "Update Calendar event" : "Create Calendar event",
      "confirm",
    );
  }
  let lastPermission = "";
  $effect(() => {
    const id = pending.at(-1)?.id;
    if (id && id !== lastPermission) {
      lastPermission = id;
      queueMicrotask(() => {
        const card = document.querySelector<HTMLElement>(".permission");
        card?.scrollIntoView({ block: "nearest" });
        card?.focus();
      });
    }
  });
  function permissionDetails(t: CompanionTask) {
    const p = t.action.payload as Record<string, unknown>;
    if (t.action.id.startsWith("calendar.") && typeof p.title === "string")
      return `${p.title} · ${new Date(String(p.start)).toLocaleString()} — ${new Date(String(p.end)).toLocaleTimeString()}`;
    return t.title;
  }
  function permissionLabel(t: CompanionTask) {
    if (t.action.id === "clipboard.read") return "Read clipboard once?";
    if (t.action.id === "clipboard.to_pocket")
      return "Read clipboard once and save it to Pocket?";
    if (t.action.id === "calendar.delete") return "Delete this Calendar event?";
    if (t.action.id === "calendar.create") return "Create this Calendar event?";
    if (t.action.id === "calendar.update") return "Update this Calendar event?";
    if (t.action.id === "pocket.delete") return "Delete this Pocket item?";
    return t.permissionRequest?.prompt || "Allow this action once?";
  }
</script>

<section class="assistant-input" aria-label="Command input">
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void submit();
    }}
  >
    <label for="nyrc-command">Ask or do something</label>
    <div class="row">
      <input
        id="nyrc-command"
        bind:this={field!}
        bind:value={input}
        maxlength="2000"
        placeholder="25 minute timer"
        disabled={busy}
      /><button type="submit" disabled={busy || !input.trim()}
        >{busy ? "Working…" : "Go"}</button
      >
    </div>
  </form>
  {#if !request}<p class="muted hint">
      Try “study mode”, “volume 30” or “what’s tomorrow?”
    </p>{/if}
  {#if request}<p class="request">{request}</p>{/if}
  <div class="response" role="status" aria-live="polite">{response}</div>
  {#each pending as task (task.id)}<section
      tabindex="-1"
      class="permission"
      aria-label="Permission request"
    >
      <strong>{permissionLabel(task)}</strong>
      <p>{permissionDetails(task)}</p>
      <div class="row">
        <button onclick={() => permission(task, true)} disabled={busy}
          >Allow once</button
        ><button onclick={() => permission(task, false)} disabled={busy}
          >Deny</button
        >
      </div>
    </section>{/each}
  {#if content !== null}<label
      >Retrieved content<textarea rows="3" readonly value={content}
      ></textarea></label
    ><button
      onclick={() => action("clipboard.write", { content }, "Copy content")}
      >Copy content</button
    >{/if}
  <nav class="row" aria-label="Saved and upcoming">
    <button onclick={pocket}>Pocket</button><button onclick={() => calendar()}
      >Today</button
    ><button onclick={() => calendar(true)}>Tomorrow</button>
  </nav>
  {#if view === "Pocket"}<PocketTray {runtime} />
  {:else if view === "Calendar"}{#each items as item}<article class="item">
        <strong>{item.title}</strong><small
          >{item.start ? new Date(item.start).toLocaleString() : ""}</small
        >
        <div class="row">
          <button
            onclick={() => {
              editId = item.id;
              title = item.title || "";
              const local = (v: string) => {
                const d = new Date(v);
                return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                  .toISOString()
                  .slice(0, 16);
              };
              start = local(item.start!);
              end = local(item.end!);
            }}>Edit</button
          ><button
            onclick={() =>
              action(
                "calendar.delete",
                { id: item.id },
                "Delete " + item.title,
                "confirm",
              )}>Delete</button
          >
        </div>
      </article>{/each}
    <details>
      <summary>{editId ? "Edit event" : "Create event"}</summary>
      <div class="stack">
        <label>Title<input bind:value={title} /></label><label
          >Starts<input type="datetime-local" bind:value={start} /></label
        ><label>Ends<input type="datetime-local" bind:value={end} /></label
        ><button onclick={calendarSave}>Review event</button>
      </div>
    </details>{/if}
  {#if tasks.length}<details>
      <summary>Recent actions</summary>{#each tasks
        .slice(-4)
        .reverse() as task}<p>
          {task.title} · {taskLabels[task.status]}
        </p>{/each}
    </details>{/if}
</section>

<style>
  .assistant-input {
    display: grid;
    gap: 10px;
  }
  form .row {
    flex-wrap: nowrap;
    margin-top: 6px;
  }
  input {
    width: 100%;
    flex: 1;
  }
  .response {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 140px;
    overflow: auto;
    padding: 10px;
    background: #111820;
    border-radius: 9px;
  }
  .request,
  .hint {
    font-size: 12px;
    margin: 0;
  }
  .request {
    color: var(--muted);
  }
  .permission {
    border: 1px solid var(--warning);
    padding: 12px;
    border-radius: 10px;
  }
  .permission p {
    font-size: 12px;
    margin-top: 6px;
  }
  .permission button {
    flex: 1;
  }
  .item {
    border-top: 1px solid var(--border);
    padding: 12px 0;
  }
  .item small {
    display: block;
    margin: 4px 0;
  }
  .item .row button {
    font-size: 12px;
  }
  nav button {
    font-size: 12px;
  }
  details p {
    font-size: 11px;
  }
</style>
