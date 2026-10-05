<script lang="ts">
  import { onMount } from "svelte";
  import { api, type Settings } from "../bridge/api";
  import { emit } from "../bridge/tauri";
  import { normalizeName, presets } from "../product/presentation";
  import { nextTrapIndex } from "./focusTrap";
  import CharacterRenderer from "./CharacterRenderer.svelte";
  let settings = $state<Settings | null>(null);
  let step = $state(0);
  let name = $state("");
  let preset = $state<keyof typeof presets>("Balanced");
  let mode = $state("local");
  let error = $state("");
  let busy = $state(false);
  let surface = $state<HTMLElement>();
  function trap(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const nodes = Array.from(
      surface!.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input,select",
      ),
    );
    const next = nextTrapIndex({
      currentIndex: nodes.indexOf(document.activeElement as HTMLElement),
      count: nodes.length,
      shift: e.shiftKey,
    });
    if (next >= 0) {
      e.preventDefault();
      nodes[next].focus();
    }
  }
  $effect(() => {
    if (settings) {
      void step;
      queueMicrotask(() =>
        surface?.querySelector<HTMLElement>("input,select,button")?.focus(),
      );
    }
  });
  onMount(() => {
    if (api.hasBackend)
      void api
        .getSettings()
        .then((s) => {
          if (!s.onboardingComplete) {
            settings = s;
            name = s.petName === "NYRC" ? "" : s.petName;
          }
        })
        .catch(() => {});
  });
  async function finish() {
    if (!settings) return;
    busy = true;
    try {
      const saved = await api.saveSettings({
        ...settings,
        petName: normalizeName(name),
        personalityPreset: preset,
        personality: presets[preset],
        localOnlyMode: mode === "local",
        llmProvider: mode === "local" ? "none" : mode,
        cloudEndpoint:
          mode === "gemini"
            ? "https://generativelanguage.googleapis.com/v1beta"
            : settings.cloudEndpoint,
        onboardingComplete: true,
      });
      await emit("settings:changed", saved);
      settings = null;
    } catch {
      error = "Couldn’t save setup. Try again.";
    } finally {
      busy = false;
    }
  }
</script>

{#if settings}<div
    class="onboarding"
    data-interactive
    bind:this={surface!}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onkeydown={trap}
    aria-label="Welcome to NYRC"
  >
    <small>NYRC · {step + 1} / 4</small><CharacterRenderer
      expression="attentive"
      size={90}
    />
    {#if step === 0}<h1>A small presence.<br />A useful companion.</h1>
      <p class="muted">Useful when you need him. Alive when you don’t.</p>
    {:else if step === 1}<h1>Make it yours.</h1>
      <label
        >Companion name<input
          bind:value={name}
          maxlength="40"
          placeholder="Choose a name"
        /></label
      ><label
        >Personality<select bind:value={preset}
          >{#each Object.keys(presets) as option}<option>{option}</option
            >{/each}</select
        ></label
      >
    {:else if step === 2}<h1>Your AI, your choice.</h1>
      <label
        >AI mode<select bind:value={mode}
          ><option value="local">Local only</option><option value="ollama"
            >Ollama</option
          ><option value="openai">OpenAI-compatible</option><option
            value="gemini">Gemini</option
          ></select
        ></label
      >
      <p class="muted">
        Timers, reminders, Pocket and commands work without AI. Provider details
        can be added in Settings.
      </p>
    {:else}<h1>Ready when you are.</h1>
      <p>
        Clipboard reads and sensitive actions ask permission each time. Calendar
        is optional and starts disconnected.
      </p>
      <p class="muted">
        Your settings and saved items stay on this Mac. Cloud AI receives
        requests only when enabled.
      </p>{/if}
    {#if error}<p role="alert">{error}</p>{/if}
    <div class="row">
      {#if step > 0}<button onclick={() => step--} disabled={busy}>Back</button
        >{/if}<button
        class="primary"
        disabled={busy}
        onclick={() => (step < 3 ? step++ : void finish())}
        >{busy
          ? "Saving…"
          : step === 3
            ? "Start companion"
            : "Continue"}</button
      >
    </div>
  </div>{/if}

<style>
  .onboarding {
    position: absolute;
    inset: 8px;
    z-index: 50;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 18px;
    padding: 18px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .onboarding :global(svg) {
    align-self: center;
  }
  .onboarding h1 {
    font-size: 21px;
  }
  .row {
    margin-top: auto;
  }
  .primary {
    margin-left: auto;
  }
</style>
