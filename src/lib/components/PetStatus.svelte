<script lang="ts">
  import type { PetState } from "../sim";
  let {
    pet,
    saving = false,
    onOpenSettings,
  }: {
    pet: PetState;
    saving?: boolean;
    open?: boolean;
    onToggle?: () => void;
    flashedStat?: string | null;
    onOpenSettings?: () => void;
  } = $props();
</script>

<div class="presence" data-interactive>
  <span>{pet.name}</span><small
    >{saving ? "Saving" : "Local features ready"}</small
  ><button aria-label="Open settings" onclick={onOpenSettings}>Settings</button>
</div>

<style>
  .presence {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--glass);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 6px 9px;
    box-shadow: var(--shadow);
    font-size: 12px;
  }
  .presence small {
    font-size: 10px;
  }
  .presence button {
    font-size: 11px;
    padding: 5px 8px;
  }
</style>
