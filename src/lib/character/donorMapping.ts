import type { Mood, MovementState } from "../sim/state";
import type { CompanionExpression } from "./expression";
import type { CharacterGesture, Reaction } from "./reaction";

const EXPRESSION_ANIMATION: Record<CompanionExpression, MovementState> = {
  neutral: "idle",
  attentive: "look_cursor",
  curious: "peek",
  happy: "celebrate",
  pleased: "blush",
  thinking: "tilt_head",
  listening: "look_cursor",
  speaking: "nuzzle",
  focused: "sit",
  waiting: "sit",
  success: "celebrate",
  confused: "tilt_head",
  concerned: "sit",
  sleepy: "yawn",
  sleeping: "sleep",
  dizzy: "dizzy",
  surprised: "surprise",
  annoyed: "shake",
};

const GESTURE_ANIMATION: Record<CharacterGesture, MovementState> = {
  acknowledge: "blush",
  attend: "look_cursor",
  tilt: "tilt_head",
  settle: "sit",
  stumble: "dizzy",
  celebrate: "celebrate",
};

const LEGACY_MOOD_EXPRESSION: Record<Mood, CompanionExpression> = {
  happy: "happy",
  curious: "curious",
  tired: "sleepy",
  hungry: "concerned",
  bored: "waiting",
  lonely: "concerned",
};

export function donorAnimationForExpression(
  expression: CompanionExpression,
): MovementState {
  return EXPRESSION_ANIMATION[expression];
}

export function donorAnimationForReaction(reaction: Reaction): MovementState {
  return reaction.gesture
    ? GESTURE_ANIMATION[reaction.gesture]
    : donorAnimationForExpression(reaction.expression);
}

export function expressionForLegacyMood(mood: Mood): CompanionExpression {
  return LEGACY_MOOD_EXPRESSION[mood];
}
