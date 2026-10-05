<script lang="ts">
  import SpriteRenderer from "./SpriteRenderer.svelte";
  import type { CompanionExpression, Reaction } from "../character";
  import {
    animationForExpression,
    animationForReaction,
  } from "../character";
  import type { Mood, MovementState } from "../sim/state";

  type Props = {
    expression: CompanionExpression;
    reaction?: Reaction | null;
    /** Temporary simulation-state passthrough; new features should use expression/reaction. */
    animation?: MovementState;
    /** Temporary tint/overlay passthrough for the sprite renderer. */
    mood?: Mood;
    size?: number;
    facing?: "left" | "right";
    breathe?: boolean;
  };

  let {
    expression,
    reaction = null,
    animation,
    mood = "happy",
    size = 140,
    facing = "right",
    breathe = true,
  }: Props = $props();

  let renderedAnimation = $derived(
    reaction
      ? animationForReaction(reaction)
      : animation ?? animationForExpression(expression),
  );
</script>

<SpriteRenderer
  mood={mood}
  animation={renderedAnimation}
  {size}
  {facing}
  {breathe}
/>
