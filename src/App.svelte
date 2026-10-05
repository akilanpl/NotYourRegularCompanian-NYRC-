<script lang="ts">
  import { advanceStartup } from "./lib/product/startup";
  import Startup from "./lib/components/Startup.svelte";
  import { invoke, listen, isTauri } from "./lib/bridge/tauri";
  import { onMount } from "svelte";
  import Onboarding from "./lib/components/Onboarding.svelte";
  import Pet from "./lib/components/Pet.svelte";
  import Settings from "./lib/components/Settings.svelte";

  // Cheap routing — settings window opens with #/settings.
  // Reactive so route updates if the hash changes at runtime.
  function currentRoute(): string {
    return window.location.hash.replace(/^#/, "") || "/";
  }

  let phase = $state<"preparing" | "ready" | "failed">(
    isTauri ? "preparing" : "ready",
  );
  let route = $state(currentRoute());
  const isSettings = $derived(route.startsWith("/settings"));

  onMount(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    if (isTauri)
      void listen<typeof phase>(
        "startup:phase",
        (value) => (phase = advanceStartup(phase, value)),
      )
        .then(async (stop) => {
          if (disposed) {
            stop();
            return;
          }
          off = stop;
          const snapshot = await invoke<typeof phase>("startup_phase");
          phase = advanceStartup(phase, snapshot);
        })
        .catch(() => {
          phase = advanceStartup(phase, "failed");
        });
    const onHashChange = () => {
      route = currentRoute();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      disposed = true;
      off?.();
      window.removeEventListener("hashchange", onHashChange);
    };
  });
</script>

{#if phase !== "ready"}
  <Startup {phase} />
{:else if isSettings}
  <Settings />
{:else}
  <Pet />
  <Onboarding />
{/if}
