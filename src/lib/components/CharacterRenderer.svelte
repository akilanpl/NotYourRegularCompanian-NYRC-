<script lang="ts">
  import MochiSprite from "./MochiSprite.svelte";
  import type { CompanionExpression, Reaction } from "../character";
  import {
    donorAnimationForExpression,
    donorAnimationForReaction,
  } from "../character";
  import type { Mood, MovementState } from "../sim/state";

  type Props = {
    expression: CompanionExpression;
    reaction?: Reaction | null;
    /** Temporary donor-state passthrough; new features should use expression/reaction. */
    animation?: MovementState;
    /** Temporary tint/overlay passthrough for the donor renderer. */
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
      ? donorAnimationForReaction(reaction)
      : animation ?? donorAnimationForExpression(expression),
  );
</script>

<MochiSprite
  mood={mood}
  animation={renderedAnimation}
  {size}
  {facing}
  {breathe}
/>
