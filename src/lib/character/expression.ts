export const COMPANION_EXPRESSIONS = [
  "neutral",
  "attentive",
  "curious",
  "happy",
  "pleased",
  "thinking",
  "listening",
  "speaking",
  "focused",
  "waiting",
  "success",
  "confused",
  "concerned",
  "sleepy",
  "sleeping",
  "dizzy",
  "surprised",
  "annoyed",
] as const;

export type CompanionExpression = (typeof COMPANION_EXPRESSIONS)[number];

export const COMPANION_SIGNALS = [
  "reminder",
  "timer",
  "notification",
  "permission_required",
  "offline",
  "reconnecting",
  "low_battery",
  "error",
  "focus",
  "dnd_active",
] as const;

export type CompanionSignal = (typeof COMPANION_SIGNALS)[number];

export function isCompanionExpression(value: string): value is CompanionExpression {
  return (COMPANION_EXPRESSIONS as readonly string[]).includes(value);
}

export function isCompanionSignal(value: string): value is CompanionSignal {
  return (COMPANION_SIGNALS as readonly string[]).includes(value);
}
