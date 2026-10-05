<script lang="ts">
  import { onMount } from "svelte";
  import { AssistantRuntime, taskMessage } from "../assistant/runtime";
  import { TimerService } from "../tasks/timerService";
  import type { CompanionAction } from "../tasks/action";
  import type { CompanionTask } from "../tasks/task";
  let {
    runtime = new AssistantRuntime(new TimerService()),
  }: { runtime?: AssistantRuntime } = $props();
  type Item = {
    id: string;
    title: string;
    itemType: string;
    createdAt: string;
  };
  let items = $state<Item[]>([]);
  let query = $state("");
  let response = $state("");
  let content = $state("");
  let title = $state("");
  let value = $state("");
  let kind = $state("text");
  let pending = $state<CompanionTask | null>(null);
  let busy = $state(false);
  async function load() {
    const t = await runtime.execute(
      { id: "pocket.list", payload: {}, permission: "none" },
      "List Pocket",
    );
    if (t.status === "succeeded") items = t.result as Item[];
    else response = "Couldn’t reach Pocket.";
  }
  onMount(() => {
    void load();
  });
  async function action(
    id: CompanionAction["id"],
    payload: unknown,
    label: string,
    permission: CompanionAction["permission"] = "none",
  ) {
    busy = true;
    try {
      const task = await runtime.execute({ id, payload, permission }, label);
      if (task.status === "permission_required") {
        pending = task;
        return;
      }
      response = taskMessage(task);
      if (
        task.result &&
        typeof task.result === "object" &&
        "content" in task.result &&
        !(
          "metadata" in task.result &&
          (task.result.metadata as { encoding?: string })?.encoding === "base64"
        ) &&
        typeof task.result.content === "string"
      )
        content = task.result.content;
      await load();
    } finally {
      busy = false;
    }
  }
  async function decide(allow: boolean) {
    if (!pending) return;
    busy = true;
    try {
      const t = await runtime.permission(pending.id, allow);
      response = allow ? taskMessage(t) : "Action denied.";
      pending = null;
      await load();
    } finally {
      busy = false;
    }
  }
</script>

<section aria-label="Pocket tray" class="stack">
  <label
    >Search Pocket<input
      bind:value={query}
      placeholder="Find saved items"
    /></label
  >
  {#if pending}<div class="card">
      <strong>{pending.title}?</strong>
      <p class="muted">
        {pending.action.id === "clipboard.to_pocket"
          ? "Read clipboard once and save its text locally."
          : "This removes the selected saved item."}
      </p>
      <div class="row">
        <button onclick={() => decide(true)}>Allow once</button><button
          onclick={() => decide(false)}>Deny</button
        >
      </div>
    </div>{/if}
  {#each items.filter((i) => i.title
      .toLowerCase()
      .includes(query.toLowerCase())) as item}<article>
      <strong>{item.title}</strong><small
        >{item.itemType} · {new Date(
          item.createdAt,
        ).toLocaleDateString()}</small
      >
      <div class="row">
        <button
          disabled={busy}
          onclick={() =>
            action("pocket.get", { id: item.id }, "Open " + item.title)}
          >Open</button
        >{#if item.itemType === "file"}<button
            onclick={() =>
              action(
                "pocket.export_file",
                { id: item.id },
                "Export " + item.title,
              )}>Export</button
          >{/if}<button
          disabled={busy}
          onclick={() =>
            action(
              "pocket.delete",
              { id: item.id },
              "Delete " + item.title,
              "confirm",
            )}>Delete</button
        >
      </div>
    </article>{/each}
  {#if !items.length}<p class="muted">
      Your tray is empty. Keep a thought, link or small file here.
    </p>{/if}
  {#if content}<label
      >Saved content<textarea readonly rows="3" value={content}
      ></textarea></label
    >
    <div class="row">
      <button
        onclick={() =>
          action("clipboard.write", { content }, "Copy saved content")}
        >Copy</button
      >{#if /^https?:\/\//.test(content)}<button
          onclick={() =>
            action("web.open", { url: content }, "Open saved link", "confirm")}
          >Open link</button
        >{/if}
    </div>{/if}
  <details>
    <summary>Add to Pocket</summary>
    <div class="stack">
      <label>Title<input bind:value={title} maxlength="120" /></label><label
        >Type<select bind:value={kind}
          ><option value="text">Text</option><option value="url">Link</option
          ><option value="file">Small file from inbox</option></select
        ></label
      ><label
        >{kind === "file" ? "Inbox file name" : "Content"}<textarea
          bind:value
          rows="3"></textarea></label
      ><button
        disabled={busy || !value.trim()}
        onclick={() =>
          action(
            `pocket.save_${kind}`,
            kind === "file"
              ? { name: value, title: title || value }
              : { content: value, title: title || "Saved item" },
            "Save to Pocket",
          )}>Save item</button
      >
    </div>
  </details>
  <button
    disabled={busy}
    onclick={() =>
      action(
        "clipboard.to_pocket",
        {},
        "Save clipboard to Pocket",
        "sensitive",
      )}>Save clipboard</button
  >{#if response}<p role="status">{response}</p>{/if}
</section>

<style>
  article {
    border-top: 1px solid var(--border);
    padding: 12px 0;
  }
  small {
    display: block;
    margin: 4px 0;
  }
  .row button {
    font-size: 12px;
  }
  .card .row button {
    flex: 1;
  }
</style>
