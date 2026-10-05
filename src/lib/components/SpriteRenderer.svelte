<script lang="ts">
  // Legacy donor desktop renderer. New character intent enters via CharacterRenderer.
  import { onDestroy } from "svelte";
  import type { Mood, MovementState } from "../sim/state";

  type Props = {
    mood: Mood;
    animation: MovementState;
    size?: number;
    facing?: "left" | "right";
    blink?: boolean;
    breathe?: boolean;
  };

  let {
    mood,
    animation,
    size = 140,
    facing = "right",
    // `blink` is intentionally unused: the high-quality PNG sprites have eyes
    // baked in per pose, so a separate vector blink overlay would visibly drift
    // from each frame's eye position. Kept in the prop API for compatibility.
    blink: _blink = false,
    breathe = true,
  }: Props = $props();

  type FrameSrc = string | [string, string];

  // walk/run/eat hold a 2-frame pair that we swap on a timer to drive the
  // step / chew cycle independently from the CSS bob keyframe.
  // eat_2 is a single still — the sequence scheduler in actions.ts alternates
  // eat ↔ eat_2 itself to read as chewing, so we don't double-cycle here.
  const SRC: Record<MovementState, FrameSrc> = {
    idle: "/sprites/companion-idle.png",
    walk: ["/sprites/companion-walk-1.png", "/sprites/companion-walk-2.png"],
    run: ["/sprites/companion-run-1.png", "/sprites/companion-run-2.png"],
    sleep: "/sprites/companion-sleep.png",
    jump: "/sprites/companion-jump.png",
    sit: "/sprites/companion-sit.png",
    look_cursor: "/sprites/companion-look-cursor.png",
    hide: "/sprites/companion-hide.png",
    celebrate: "/sprites/companion-celebrate.png",
    eat: "/sprites/companion-eat-1.png",
    eat_2: "/sprites/companion-eat-2.png",
    yawn: "/sprites/companion-yawn.png",
    roll: "/sprites/companion-roll.png",
    blush: "/sprites/companion-blush.png",
    // REQ-015 expressive set — single-frame poses driven by §9.11 choreography.
    stretch: "/sprites/companion-stretch.png",
    peek: "/sprites/companion-peek.png",
    tilt_head: "/sprites/companion-tilt-head.png",
    shake: "/sprites/companion-shake.png",
    nuzzle: "/sprites/companion-nuzzle.png",
    wiggle: "/sprites/companion-wiggle.png",
    dizzy: "/sprites/companion-dizzy.png",
    surprise: "/sprites/companion-surprise.png",
    // REQ-116 snack-specific eat frames (paired by the tray's step sequences,
    // same bite/chew rhythm as eat/eat_2).
    eat_strawberry: "/sprites/companion-eat-strawberry-1.png",
    eat_strawberry_2: "/sprites/companion-eat-strawberry-2.png",
    eat_cookie: "/sprites/companion-eat-cookie-1.png",
    eat_cookie_2: "/sprites/companion-eat-cookie-2.png",
  };

  // Subtle CSS tint per mood so the same base PNG reads as a different state
  // without redrawing the character.
  const MOOD_FILTER: Record<Mood, string> = {
    happy: "none",
    curious: "hue-rotate(-12deg) saturate(1.08)",
    tired: "hue-rotate(25deg) saturate(0.7) brightness(0.96)",
    hungry: "hue-rotate(-22deg) saturate(1.18)",
    bored: "saturate(0.45) brightness(0.97)",
    lonely: "hue-rotate(40deg) saturate(0.78) brightness(0.95)",
  };

  let frameIdx = $state(0);
  let cycleTimer: ReturnType<typeof setInterval> | undefined;

  $effect(() => {
    if (cycleTimer) {
      clearInterval(cycleTimer);
      cycleTimer = undefined;
    }
    const src = SRC[animation];
    if (Array.isArray(src)) {
      const periodMs = animation === "run" ? 160 : 280;
      cycleTimer = setInterval(() => {
        frameIdx = (frameIdx + 1) % 2;
      }, periodMs);
    } else {
      frameIdx = 0;
    }
  });

  onDestroy(() => {
    if (cycleTimer) clearInterval(cycleTimer);
  });

  let currentSrc = $derived.by(() => {
    const src = SRC[animation];
    return Array.isArray(src) ? src[frameIdx] : src;
  });

  let scaleX = $derived(facing === "left" ? -1 : 1);
  let isAsleep = $derived(animation === "sleep");
  // Covers eat/eat_2 and the REQ-116 snack-specific frames.
  let isEating = $derived(animation.startsWith("eat"));
  let moodFilter = $derived(MOOD_FILTER[mood]);
</script>

<div
  class="nyrc"
  style="--size: {size}px; --scale-x: {scaleX}; --mood-filter: {moodFilter};"
  class:breathe
  class:asleep={isAsleep}
  data-anim={animation}
>
  <img
    class="sprite"
    src={currentSrc}
    alt=""
    width={size}
    height={size}
    draggable="false"
    onerror={(e) => {
      // If a new pose PNG hasn't shipped yet (e.g., codex image-gen pending),
      // fall back to the idle frame so the pet never shows a broken icon.
      const img = e.currentTarget as HTMLImageElement;
      if (img.src.indexOf("/sprites/companion-idle.png") === -1) {
        img.src = "/sprites/companion-idle.png";
      }
    }}
  />

  {#if mood === "curious" && !isAsleep}
    <div class="mark mark-curious" aria-hidden="true">?</div>
  {/if}

  {#if mood === "hungry" && !isAsleep && !isEating}
    <div class="mark mark-hungry" aria-hidden="true">🍡</div>
  {/if}

  {#if mood === "bored" && !isAsleep && animation !== "blush" && animation !== "celebrate" && animation !== "yawn"}
    <div class="mark mark-bored" aria-hidden="true">…</div>
  {/if}

  {#if mood === "lonely" && !isAsleep && animation !== "blush"}
    <div class="mark mark-lonely" aria-hidden="true">♡</div>
  {/if}

  {#if mood === "happy" && animation === "celebrate"}
    <div class="mark mark-heart-l" aria-hidden="true">♥</div>
    <div class="mark mark-heart-r" aria-hidden="true">♥</div>
  {/if}

  {#if animation === "blush"}
    <div class="mark mark-heart-l" aria-hidden="true">♥</div>
  {/if}

  {#if animation === "yawn"}
    <div class="mark mark-zzz" aria-hidden="true">~</div>
  {/if}

  {#if isEating}
    <div class="mark mark-crumb" aria-hidden="true">·</div>
  {/if}
</div>

<style>
  .nyrc {
    width: var(--size);
    height: var(--size);
    position: relative;
    transform-origin: center bottom;
    will-change: transform;
  }

  .sprite {
    width: 100%;
    height: 100%;
    display: block;
    transform: scaleX(var(--scale-x));
    filter: var(--mood-filter);
    transition: filter 600ms ease;
    image-rendering: auto;
    user-select: none;
    -webkit-user-drag: none;
  }

  .nyrc.breathe .sprite {
    animation: breathe 3.6s ease-in-out infinite;
  }

  .nyrc.asleep .sprite {
    animation: snore 4s ease-in-out infinite;
  }

  .nyrc[data-anim="walk"] .sprite {
    animation: bob 0.6s ease-in-out infinite;
  }

  .nyrc[data-anim="run"] .sprite {
    animation: bob 0.32s ease-in-out infinite;
  }

  .nyrc[data-anim="jump"] .sprite {
    animation: hop 0.7s ease-out infinite;
  }

  .nyrc[data-anim="celebrate"] .sprite {
    animation: wiggle 0.6s ease-in-out infinite;
  }

  /* Munching = quick small vertical squash so the chew reads even on a still PNG. */
  .nyrc[data-anim="eat"] .sprite,
  .nyrc[data-anim="eat_2"] .sprite,
  .nyrc[data-anim="eat_strawberry"] .sprite,
  .nyrc[data-anim="eat_strawberry_2"] .sprite,
  .nyrc[data-anim="eat_cookie"] .sprite,
  .nyrc[data-anim="eat_cookie_2"] .sprite {
    animation: chew 0.32s ease-in-out infinite;
  }

  /* Yawning = slow stretch upward. */
  .nyrc[data-anim="yawn"] .sprite {
    animation: yawnStretch 1.2s ease-in-out infinite;
  }

  /* Rolling = continuous tilt, paired with the side-rolled sprite. */
  .nyrc[data-anim="roll"] .sprite {
    animation: rollSpin 0.7s linear infinite;
  }

  /* Pat reaction: tiny lean forward. */
  .nyrc[data-anim="blush"] .sprite {
    animation: leanIn 0.7s ease-in-out infinite;
  }

  /* REQ-100 — expressive set (REQ-015) motion. Each pose is a single PNG, so
     a transform-only keyframe carries the movement the name promises. */
  .nyrc[data-anim="stretch"] .sprite {
    animation: stretchUp 1.2s ease-in-out infinite;
  }

  .nyrc[data-anim="peek"] .sprite {
    animation: peekSide 1.4s ease-in-out infinite;
  }

  .nyrc[data-anim="tilt_head"] .sprite {
    animation: tiltHold 1.6s ease-in-out infinite;
  }

  .nyrc[data-anim="shake"] .sprite {
    animation: shakeX 0.4s ease-in-out infinite;
  }

  .nyrc[data-anim="nuzzle"] .sprite {
    animation: nuzzleIn 1.1s ease-in-out infinite;
  }

  .nyrc[data-anim="wiggle"] .sprite {
    animation: wiggle 0.45s ease-in-out infinite;
  }

  .nyrc[data-anim="dizzy"] .sprite {
    animation: dizzyWobble 0.9s linear infinite;
  }

  .nyrc[data-anim="surprise"] .sprite {
    animation: surprisePop 0.55s ease-out infinite;
  }

  @keyframes breathe {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) scale(1, 1);
    }
    50% {
      transform: scaleX(var(--scale-x)) scale(1.02, 0.98);
    }
  }

  @keyframes snore {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) scale(1, 1) translateY(0);
    }
    50% {
      transform: scaleX(var(--scale-x)) scale(1.04, 0.96) translateY(2px);
    }
  }

  @keyframes bob {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) translateY(0);
    }
    50% {
      transform: scaleX(var(--scale-x)) translateY(-4px);
    }
  }

  @keyframes hop {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) translateY(0) scale(1, 1);
    }
    40% {
      transform: scaleX(var(--scale-x)) translateY(-12px) scale(1.05, 0.95);
    }
  }

  @keyframes wiggle {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) rotate(-3deg);
    }
    50% {
      transform: scaleX(var(--scale-x)) rotate(3deg);
    }
  }

  @keyframes chew {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) scale(1, 1);
    }
    50% {
      transform: scaleX(var(--scale-x)) scale(1.04, 0.94);
    }
  }

  @keyframes yawnStretch {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) scale(1, 1) translateY(0);
    }
    50% {
      transform: scaleX(var(--scale-x)) scale(1.03, 1.06) translateY(-3px);
    }
  }

  @keyframes rollSpin {
    0% {
      transform: scaleX(var(--scale-x)) rotate(-12deg) translateX(-3px);
    }
    50% {
      transform: scaleX(var(--scale-x)) rotate(12deg) translateX(3px);
    }
    100% {
      transform: scaleX(var(--scale-x)) rotate(-12deg) translateX(-3px);
    }
  }

  @keyframes leanIn {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) translateY(0) rotate(-2deg);
    }
    50% {
      transform: scaleX(var(--scale-x)) translateY(2px) rotate(2deg);
    }
  }

  @keyframes stretchUp {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) scale(1, 1) translateY(0);
    }
    50% {
      transform: scaleX(var(--scale-x)) scale(0.97, 1.07) translateY(-3px);
    }
  }

  @keyframes peekSide {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) translateX(0) rotate(0deg);
    }
    50% {
      transform: scaleX(var(--scale-x)) translateX(4px) rotate(3deg);
    }
  }

  @keyframes tiltHold {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) rotate(-5deg);
    }
    50% {
      transform: scaleX(var(--scale-x)) rotate(-9deg) translateY(1px);
    }
  }

  @keyframes shakeX {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) translateX(-2px);
    }
    50% {
      transform: scaleX(var(--scale-x)) translateX(2px);
    }
  }

  @keyframes nuzzleIn {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) rotate(0deg) translateX(0);
    }
    50% {
      transform: scaleX(var(--scale-x)) rotate(4deg) translateX(3px) translateY(1px);
    }
  }

  @keyframes dizzyWobble {
    0% {
      transform: scaleX(var(--scale-x)) rotate(-8deg) translateX(-2px);
    }
    25% {
      transform: scaleX(var(--scale-x)) rotate(0deg) translateY(-2px);
    }
    50% {
      transform: scaleX(var(--scale-x)) rotate(8deg) translateX(2px);
    }
    75% {
      transform: scaleX(var(--scale-x)) rotate(0deg) translateY(2px);
    }
    100% {
      transform: scaleX(var(--scale-x)) rotate(-8deg) translateX(-2px);
    }
  }

  @keyframes surprisePop {
    0% {
      transform: scaleX(var(--scale-x)) scale(1, 1);
    }
    30% {
      transform: scaleX(var(--scale-x)) scale(1.07, 1.07) translateY(-2px);
    }
    100% {
      transform: scaleX(var(--scale-x)) scale(1, 1);
    }
  }

  .mark {
    position: absolute;
    pointer-events: none;
    font-weight: 700;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
  }

  .mark-curious {
    top: 6%;
    right: 8%;
    color: #3a2a36;
    font-size: calc(var(--size) * 0.16);
    animation: pop 1.2s ease-in-out infinite;
  }

  .mark-heart-l {
    top: 18%;
    left: 6%;
    color: #ff7aa1;
    font-size: calc(var(--size) * 0.13);
    animation: float 1.8s ease-in-out infinite;
  }

  .mark-heart-r {
    top: 22%;
    right: 8%;
    color: #ff9aaf;
    font-size: calc(var(--size) * 0.11);
    animation: float 1.8s ease-in-out infinite 0.3s;
  }

  .mark-zzz {
    top: 4%;
    right: 12%;
    color: #6b9fc4;
    font-size: calc(var(--size) * 0.18);
    animation: float 1.6s ease-in-out infinite;
  }

  .mark-crumb {
    top: 56%;
    left: 18%;
    color: #d27ba1;
    font-size: calc(var(--size) * 0.18);
    animation: float 1.1s ease-in-out infinite 0.1s;
  }

  .mark-hungry {
    top: 6%;
    right: 8%;
    font-size: calc(var(--size) * 0.16);
    animation: float 1.4s ease-in-out infinite;
  }

  .mark-bored {
    top: 8%;
    right: 10%;
    color: #6a5a6a;
    font-size: calc(var(--size) * 0.20);
    letter-spacing: 1px;
    animation: float 2s ease-in-out infinite;
  }

  .mark-lonely {
    top: 16%;
    right: 8%;
    color: #b3739a;
    font-size: calc(var(--size) * 0.15);
    animation: float 1.8s ease-in-out infinite;
  }

  @keyframes pop {
    0%,
    100% {
      transform: translateY(0) scale(1);
    }
    50% {
      transform: translateY(-3px) scale(1.1);
    }
  }

  @keyframes float {
    0%,
    100% {
      transform: translateY(0);
      opacity: 0.85;
    }
    50% {
      transform: translateY(-6px);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .nyrc.breathe .sprite,
    .nyrc.asleep .sprite,
    .nyrc[data-anim="walk"] .sprite,
    .nyrc[data-anim="run"] .sprite,
    .nyrc[data-anim="jump"] .sprite,
    .nyrc[data-anim="celebrate"] .sprite,
    .nyrc[data-anim="eat"] .sprite,
    .nyrc[data-anim="eat_2"] .sprite,
    .nyrc[data-anim="eat_strawberry"] .sprite,
    .nyrc[data-anim="eat_strawberry_2"] .sprite,
    .nyrc[data-anim="eat_cookie"] .sprite,
    .nyrc[data-anim="eat_cookie_2"] .sprite,
    .nyrc[data-anim="yawn"] .sprite,
    .nyrc[data-anim="roll"] .sprite,
    .nyrc[data-anim="blush"] .sprite,
    .nyrc[data-anim="stretch"] .sprite,
    .nyrc[data-anim="peek"] .sprite,
    .nyrc[data-anim="tilt_head"] .sprite,
    .nyrc[data-anim="shake"] .sprite,
    .nyrc[data-anim="nuzzle"] .sprite,
    .nyrc[data-anim="wiggle"] .sprite,
    .nyrc[data-anim="dizzy"] .sprite,
    .nyrc[data-anim="surprise"] .sprite,
    .mark {
      animation: none !important;
    }
  }
</style>
