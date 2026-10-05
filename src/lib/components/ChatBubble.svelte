<script lang="ts">
  import type { Mood } from "../sim/state";

  type Props = { text: string; mood: Mood; side?: "above" | "below" };
  let { text, side = "above" }: Props = $props();

</script>

<div
  class="bubble"
  data-side={side}
  style="--bg: var(--surface);"
  role="status"
  aria-live="polite"
  aria-atomic="true"
>
  <p>{text}</p>
  <div class="tail" aria-hidden="true"></div>
</div>

<style>
  .bubble {
    position: relative;
    background: var(--bg);
    color: var(--nyrc-text);
    border-radius: 14px;
    padding: 10px 14px 32px;
    font-size: 13px;
    line-height: 1.4;
    border:1px solid var(--border);
    box-shadow:var(--shadow);
    animation: pop 220ms cubic-bezier(0.34, 1.4, 0.64, 1) both;
  }
  .bubble p {
    margin: 0;
    word-break: break-word;
  }
  /* Tail position is driven by --tail-x set on the wrapping bubble-anchor in
     Pet.svelte so it points at the pet centre regardless of clamp/flip. */
  .tail {
    position: absolute;
    /* Center the 16px-wide tail under --tail-x. */
    left: calc(var(--tail-x, 22px) - 8px);
    width: 0;
    height: 0;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
  }
  .bubble[data-side="above"] .tail {
    bottom: -8px;
    border-top: 8px solid var(--bg);
  }
  .bubble[data-side="below"] .tail {
    top: -8px;
    border-bottom: 8px solid var(--bg);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.92);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
