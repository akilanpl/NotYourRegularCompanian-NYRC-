<script lang="ts">
  import CharacterRenderer from "./CharacterRenderer.svelte";
  let { phase = "preparing" }: { phase?: "preparing" | "failed" } = $props();
</script>

<section class="startup" aria-label="Startup status" data-interactive>
  <CharacterRenderer
    expression={phase === "failed" ? "concerned" : "waiting"}
    size={110}
  />
  <h1>NYRC</h1>
  <p role="status">
    {phase === "failed"
      ? "Couldn’t prepare local storage."
      : "Preparing your companion…"}
  </p>
  <p class="muted">
    {phase === "failed"
      ? "Existing data has been retained. Restart NYRC after checking storage access. Details are in the local application log."
      : "Checking storage and safely restoring saved items. This can take longer when migrating existing data."}
  </p>
</section>

<style>
  .startup {
    position: absolute;
    inset: 8px;
    border-radius: 18px;
    padding: 24px;
    background: var(--surface);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    overflow: auto;
  }
  .startup h1 {
    margin-top: 12px;
  }
</style>
