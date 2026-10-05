import {
  isCompanionExpression,
  isCompanionSignal,
  type CompanionExpression,
  type CompanionSignal,
} from "./expression";

export const CHARACTER_GESTURES = [
  "acknowledge",
  "attend",
  "tilt",
  "settle",
  "stumble",
  "celebrate",
] as const;

export type CharacterGesture = (typeof CHARACTER_GESTURES)[number];

export const REACTION_SOUND_CUES = [
  "acknowledge",
  "confirm",
  "attention",
] as const;

export type ReactionSoundCue = (typeof REACTION_SOUND_CUES)[number];

export type Reaction = Readonly<{
  expression: CompanionExpression;
  gesture?: CharacterGesture;
  message?: string;
  soundCue?: ReactionSoundCue;
  intensity: number;
  durationMs: number;
  signal?: CompanionSignal;
}>;

export type ReactionInput = {
  expression: CompanionExpression;
  gesture?: CharacterGesture;
  message?: string;
  soundCue?: ReactionSoundCue;
  intensity?: number;
  durationMs?: number;
  signal?: CompanionSignal;
};

export type ReactionEvent =
  | "gentle_tap"
  | "repeated_interaction"
  | "excessive_taps"
  | "shake"
  | "user_returned"
  | "long_idle"
  | "listening"
  | "thinking"
  | "executing"
  | "task_succeeded"
  | "task_failed"
  | "waiting_for_user"
  | "permission_required"
  | "reminder_fired"
  | "alarm_fired"
  | "timer_finished"
  | "focus_started"
  | "focus_completed"
  | "dnd_active"
  | "offline"
  | "reconnecting"
  | "low_battery";

const DEFAULT_INTENSITY = 0.5;
const DEFAULT_DURATION_MS = 900;
const MAX_DURATION_MS = 60_000;

const gestureSet: ReadonlySet<string> = new Set(CHARACTER_GESTURES);
const soundCueSet: ReadonlySet<string> = new Set(REACTION_SOUND_CUES);
const allowedKeys = new Set([
  "expression",
  "gesture",
  "message",
  "soundCue",
  "intensity",
  "durationMs",
  "signal",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCharacterGesture(value: unknown): value is CharacterGesture {
  return typeof value === "string" && gestureSet.has(value);
}

function isReactionSoundCue(value: unknown): value is ReactionSoundCue {
  return typeof value === "string" && soundCueSet.has(value);
}

export function validateReaction(value: unknown): Reaction | null {
  if (!isRecord(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) {
    return null;
  }
  if (typeof value.expression !== "string" || !isCompanionExpression(value.expression)) {
    return null;
  }
  if (value.gesture !== undefined && !isCharacterGesture(value.gesture)) return null;
  if (value.message !== undefined && typeof value.message !== "string") return null;
  if (value.soundCue !== undefined && !isReactionSoundCue(value.soundCue)) return null;
  if (value.signal !== undefined && (
    typeof value.signal !== "string" || !isCompanionSignal(value.signal)
  )) {
    return null;
  }

  const intensity = value.intensity === undefined ? DEFAULT_INTENSITY : value.intensity;
  const durationMs = value.durationMs === undefined ? DEFAULT_DURATION_MS : value.durationMs;
  if (
    typeof intensity !== "number" ||
    !Number.isFinite(intensity) ||
    intensity < 0 ||
    intensity > 1 ||
    typeof durationMs !== "number" ||
    !Number.isInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > MAX_DURATION_MS
  ) {
    return null;
  }

  return {
    expression: value.expression,
    ...(value.gesture === undefined ? {} : { gesture: value.gesture }),
    ...(value.message === undefined ? {} : { message: value.message }),
    ...(value.soundCue === undefined ? {} : { soundCue: value.soundCue }),
    intensity,
    durationMs,
    ...(value.signal === undefined ? {} : { signal: value.signal }),
  };
}

export function createReaction(input: ReactionInput): Reaction {
  const reaction = validateReaction(input);
  if (!reaction) throw new RangeError("Invalid companion reaction");
  return reaction;
}

const REACTIONS: Record<ReactionEvent, readonly Reaction[]> = {
  gentle_tap: [
    createReaction({
      expression: "pleased",
      gesture: "acknowledge",
      soundCue: "acknowledge",
      intensity: 0.35,
      durationMs: 750,
    }),
  ],
  repeated_interaction: [
    createReaction({
      expression: "confused",
      gesture: "tilt",
      intensity: 0.4,
      durationMs: 900,
    }),
  ],
  excessive_taps: [
    createReaction({
      expression: "annoyed",
      gesture: "settle",
      intensity: 0.3,
      durationMs: 1_000,
    }),
  ],
  shake: [
    createReaction({ expression: "surprised", intensity: 0.55, durationMs: 350 }),
    createReaction({ expression: "dizzy", gesture: "stumble", intensity: 0.55, durationMs: 900 }),
    createReaction({ expression: "attentive", gesture: "settle", intensity: 0.25, durationMs: 650 }),
  ],
  user_returned: [
    createReaction({ expression: "attentive", gesture: "attend", intensity: 0.4, durationMs: 900 }),
  ],
  long_idle: [
    createReaction({ expression: "sleepy", gesture: "settle", intensity: 0.25, durationMs: 1_200 }),
  ],
  listening: [
    createReaction({ expression: "listening", gesture: "attend", intensity: 0.3, durationMs: 1_000 }),
  ],
  thinking: [
    createReaction({ expression: "thinking", gesture: "tilt", intensity: 0.3, durationMs: 1_100 }),
  ],
  executing: [
    createReaction({ expression: "focused", intensity: 0.35, durationMs: 1_200 }),
  ],
  task_succeeded: [
    createReaction({
      expression: "success",
      gesture: "celebrate",
      soundCue: "confirm",
      intensity: 0.5,
      durationMs: 1_100,
    }),
  ],
  task_failed: [
    createReaction({
      expression: "concerned",
      signal: "error",
      intensity: 0.3,
      durationMs: 1_200,
    }),
  ],
  waiting_for_user: [
    createReaction({ expression: "waiting", intensity: 0.25, durationMs: 1_000 }),
  ],
  permission_required: [
    createReaction({
      expression: "attentive",
      signal: "permission_required",
      intensity: 0.3,
      durationMs: 1_000,
    }),
  ],
  reminder_fired: [
    createReaction({
      expression: "attentive",
      signal: "reminder",
      soundCue: "attention",
      intensity: 0.35,
      durationMs: 1_000,
    }),
  ],
  alarm_fired: [
    createReaction({
      expression: "attentive",
      gesture: "attend",
      signal: "notification",
      soundCue: "attention",
      intensity: 0.55,
      durationMs: 1_200,
    }),
  ],
  timer_finished: [
    createReaction({
      expression: "success",
      signal: "timer",
      soundCue: "attention",
      intensity: 0.4,
      durationMs: 1_000,
    }),
  ],
  focus_started: [
    createReaction({ expression: "focused", signal: "focus", intensity: 0.35, durationMs: 900 }),
  ],
  focus_completed: [
    createReaction({
      expression: "pleased",
      signal: "focus",
      intensity: 0.4,
      durationMs: 1_000,
    }),
  ],
  dnd_active: [
    createReaction({ expression: "focused", signal: "dnd_active", intensity: 0.2, durationMs: 900 }),
  ],
  offline: [
    createReaction({ expression: "concerned", signal: "offline", intensity: 0.3, durationMs: 1_000 }),
  ],
  reconnecting: [
    createReaction({ expression: "thinking", signal: "reconnecting", intensity: 0.25, durationMs: 900 }),
  ],
  low_battery: [
    createReaction({ expression: "concerned", signal: "low_battery", intensity: 0.25, durationMs: 1_000 }),
  ],
};

export function reactionsFor(event: ReactionEvent): readonly Reaction[] {
  return REACTIONS[event];
}

export function reactionForInteraction(tapCount: number): Reaction {
  const count = Number.isFinite(tapCount) ? Math.max(1, Math.floor(tapCount)) : 1;
  const event: ReactionEvent =
    count >= 4 ? "excessive_taps" : count >= 2 ? "repeated_interaction" : "gentle_tap";
  return reactionsFor(event)[0];
}
