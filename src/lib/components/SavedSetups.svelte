<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../bridge/api";
  import { emit } from "../bridge/tauri";
  import type { UserAlias, AssistantMode } from "../tasks/scheduledItem";
  let aliases = $state<UserAlias[]>([]);
  let modes = $state<AssistantMode[]>([]);
  let phrase = $state("");
  let target = $state("");
  let targetType = $state<UserAlias["targetType"]>("website");
  let aliasId = $state("");
  let modeExtra = $state<unknown[]>([]);
  let modeId = $state("");
  let modeName = $state("");
  let volume = $state(30);
  let application = $state("");
  let website = $state("");
  let focus = $state(false);
  let message = $state("");
  let pending = $state<{
    kind: "alias" | "mode";
    id: string;
    name: string;
  } | null>(null);
  async function load() {
    try {
      [aliases, modes] = await Promise.all([
        api.listAliases(),
        api.listModes(),
      ]);
    } catch {
      message = "Couldn’t load saved setups.";
    }
  }
  onMount(() => {
    void load();
  });
  async function saveAlias() {
    try {
      const value = { phrase, targetType, target };
      if (aliasId) await api.updateAlias(aliasId, value);
      else await api.createAlias(value);
      aliasId = "";
      phrase = "";
      target = "";
      await load();
      await emit("setups:changed", {});
      message = "Alias saved";
    } catch {
      message = "Couldn’t save alias. Check the phrase and destination.";
    }
  }
  async function saveMode() {
    try {
      const actions = [
        ...modeExtra,
        { id: "system.volume.set", payload: { volume }, permission: "none" },
        ...(focus
          ? [{ id: "system.focus.enable", payload: {}, permission: "none" }]
          : []),
        ...(application
          ? [{ id: "app.open", payload: { application }, permission: "none" }]
          : []),
        ...(website
          ? [{ id: "web.open", payload: { url: website }, permission: "none" }]
          : []),
      ];
      const value = { name: modeName, actions };
      if (modeId) await api.updateMode(modeId, value);
      else await api.createMode(value);
      modeId = "";
      modeExtra = [];
      modeName = "";
      await load();
      await emit("setups:changed", {});
      message = "Mode saved";
    } catch {
      message = "Couldn’t save mode. Check the name and steps.";
    }
  }
  function editMode(mode: AssistantMode) {
    modeId = mode.id;
    modeName = mode.name;
    modeExtra = mode.actions.filter(
      (v) =>
        ![
          "system.volume.set",
          "system.focus.enable",
          "app.open",
          "web.open",
        ].includes(String((v as { id?: string }).id)),
    );
    const steps = mode.actions as {
      id: string;
      payload: Record<string, unknown>;
    }[];
    volume = Number(
      steps.find((s) => s.id === "system.volume.set")?.payload.volume ?? 30,
    );
    application = String(
      steps.find((s) => s.id === "app.open")?.payload.application ?? "",
    );
    website = String(steps.find((s) => s.id === "web.open")?.payload.url ?? "");
    focus = steps.some((s) => s.id === "system.focus.enable");
  }
  async function remove() {
    if (!pending) return;
    try {
      if (pending.kind === "alias") await api.deleteAlias(pending.id);
      else await api.deleteMode(pending.id);
      pending = null;
      await load();
      await emit("setups:changed", {});
      message = "Removed";
    } catch {
      message = "Couldn’t remove that setup.";
    }
  }
</script>

<details>
  <summary>Aliases & modes</summary>
  <div class="stack">
    {#if pending}<div class="card">
        <p>Delete “{pending.name}”?</p>
        <div class="row">
          <button onclick={remove}>Delete</button><button
            onclick={() => (pending = null)}>Keep</button
          >
        </div>
      </div>{/if}
    <h3>Aliases</h3>
    {#each aliases as alias}<div class="row">
        <span>{alias.phrase}</span><button
          onclick={() => {
            aliasId = alias.id;
            phrase = alias.phrase;
            target = alias.target;
            targetType = alias.targetType;
          }}>Edit</button
        ><button
          onclick={() =>
            (pending = { kind: "alias", id: alias.id, name: alias.phrase })}
          >Delete</button
        >
      </div>{/each}
    <label
      >Phrase<input bind:value={phrase} placeholder="Open my notes" /></label
    ><label
      >Destination type<select bind:value={targetType}
        ><option value="website">Website</option><option value="application"
          >Application</option
        ><option value="mode">Mode</option></select
      ></label
    ><label>Destination<input bind:value={target} /></label><button
      disabled={!phrase.trim() || !target.trim()}
      onclick={saveAlias}>{aliasId ? "Update alias" : "Save alias"}</button
    >
    <h3>Modes</h3>
    {#each modes as mode}<div class="row">
        <span>{mode.name} · {mode.actions.length} steps</span><button
          onclick={() => editMode(mode)}>Edit</button
        ><button
          onclick={() =>
            (pending = { kind: "mode", id: mode.id, name: mode.name })}
          >Delete</button
        >
      </div>{/each}
    {#if modeExtra.length}<small
        >{modeExtra.length} additional saved steps will be preserved.</small
      >{/if}<label>Mode name<input bind:value={modeName} /></label><label
      >Volume<input
        type="number"
        min="0"
        max="100"
        bind:value={volume}
      /></label
    ><label>Application (optional)<input bind:value={application} /></label
    ><label>Website (optional)<input bind:value={website} /></label><label
      >Request Focus control<input
        type="checkbox"
        bind:checked={focus}
      /></label
    ><small
      >Focus control is unavailable on this platform. Remaining supported steps
      can still complete.</small
    ><button disabled={!modeName.trim()} onclick={saveMode}
      >{modeId ? "Update mode" : "Save mode"}</button
    >{#if message}<p role="status">{message}</p>{/if}
  </div>
</details>
