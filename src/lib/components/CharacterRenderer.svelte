<script lang="ts">
  import { onMount } from "svelte";
  import type { CompanionExpression, Reaction } from "../character";
  import type { Mood, MovementState } from "../sim/state";
  import { faceFor, motionAllowed } from "../product/presentation";
  let {
    expression,
    reaction = null,
    size = 140,
    breathe = true,
  }: {
    expression: CompanionExpression;
    reaction?: Reaction | null;
    size?: number;
    breathe?: boolean;
    animation?: MovementState;
    mood?: Mood;
    facing?: "left" | "right";
  } = $props();
  let active = $derived(reaction?.expression ?? expression);
  let face = $derived(faceFor(active));
  let blink = $state(false);
  let glance = $state(0);
  let motion = $state(false);
  onMount(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let count = 0;
    let close: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      motion = motionAllowed(
        media.matches,
        !document.hidden,
        document.hasFocus(),
      );
    };
    update();
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    const timer = setInterval(() => {
      if (!motion || active === "sleeping") return;
      count++;
      blink = true;
      glance = count % 3 === 0 ? (count % 2 ? 3 : -3) : 0;
      close = setTimeout(() => {
        blink = false;
      }, 130);
    }, 5700);
    return () => {
      clearInterval(timer);
      clearTimeout(close);
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  });
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 160 160"
  role="img"
  aria-label={`Companion: ${active}${reaction?.signal ? ", " + reaction.signal.replaceAll("_", " ") : ""}`}
  class:motion
  class:breathing={breathe && motion}
  class="character {active}"
  style={`--tilt:${face.tilt}deg`}
>
  <ellipse cx="80" cy="145" rx="43" ry="5" fill="#080b10" opacity=".22" />
  <g class="shell">
    <rect x="24" y="21" width="112" height="115" rx="34" fill="#929aa4" />
    <rect
      x="25"
      y="20"
      width="110"
      height="112"
      rx="33"
      fill="#c3c9cf"
      stroke="#d8dde2"
      stroke-width="1.5"
    />
    <path
      d="M41 113 Q80 128 119 113"
      fill="none"
      stroke="#9ca4ad"
      stroke-width="1"
    />
    <rect
      x="33"
      y="30"
      width="94"
      height="77"
      rx="25"
      fill="#11161d"
      stroke="#535d69"
      stroke-width="2"
    />
    <path
      d="M49 36 H111"
      stroke="#ffffff"
      stroke-opacity=".12"
      stroke-linecap="round"
    />
    <g transform={`translate(${face.gaze + glance},0)`} fill="#e4eff9">
      {#if face.curve && !blink}<path
          d="M54 69 Q61 57 68 69 M89 69 Q96 57 103 69"
          fill="none"
          stroke="#e4eff9"
          stroke-width="5"
          stroke-linecap="round"
        />
      {:else}<rect
          x="55"
          y={66 - (blink ? 2 : face.height) / 2}
          width="12"
          height={blink ? 2 : face.height}
          rx="6"
        /><rect
          x="91"
          y={66 - (blink ? 2 : face.height) / 2}
          width="12"
          height={blink ? 2 : face.height}
          rx="6"
        />{/if}
      {#if active === "dizzy"}<path
          d="M53 58 l16 16 m0 -16 l-16 16 M89 58 l16 16 m0 -16 l-16 16"
          stroke="#11161d"
          stroke-width="3"
        />{/if}
    </g>
    <rect
      class="indicator"
      x="71"
      y="117"
      width="18"
      height="3"
      rx="1.5"
      fill={reaction?.signal === "offline"
        ? "#919baa"
        : reaction?.signal === "permission_required" ||
            reaction?.signal === "low_battery"
          ? "#e2bb78"
          : active === "success"
            ? "#8fc9ad"
            : "#9abfdf"}
    />
  </g>
</svg>

<style>
  .character {
    overflow: visible;
    display: block;
  }
  .shell {
    transform-origin: 80px 90px;
    transform: rotate(var(--tilt));
    transition: transform 260ms ease;
  }
  .motion.thinking .shell,
  .motion.confused .shell {
    animation: consider 1.2s ease 1;
  }
  .motion.success .shell,
  .motion.attentive .shell {
    animation: ack 500ms ease 1;
  }
  .motion.dizzy .shell {
    animation: shake 450ms ease 1;
  }
  .motion.speaking .indicator,
  .motion.listening .indicator {
    animation: pulse 1s ease 3;
  }
  .breathing.neutral .shell {
    animation: breathe 9s ease 2;
  }
  .sleeping .indicator {
    opacity: 0.25;
  }
  @keyframes breathe {
    50% {
      transform: translateY(-1px);
    }
  }
  @keyframes consider {
    50% {
      transform: rotate(-5deg);
    }
  }
  @keyframes ack {
    50% {
      transform: translateY(-3px);
    }
  }
  @keyframes shake {
    25% {
      transform: rotate(-7deg);
    }
    75% {
      transform: rotate(7deg);
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .shell,
    .indicator {
      animation: none !important;
      transition: none;
    }
  }
</style>
