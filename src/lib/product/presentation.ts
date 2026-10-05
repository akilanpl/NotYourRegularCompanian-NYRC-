import type { CompanionExpression } from "../character";
import { defaultPersonality } from "../assistant/personality";
import type { TaskStatus } from "../tasks/task";
export const presets = {
  Balanced: { ...defaultPersonality },
  Quiet: {
    ...defaultPersonality,
    verbosity: 0.15,
    initiative: 0.15,
    expressiveness: 0.2,
    humor: 0.1,
  },
  Playful: {
    ...defaultPersonality,
    humor: 0.65,
    playfulness: 0.7,
    expressiveness: 0.6,
  },
  Professional: {
    ...defaultPersonality,
    formality: 0.85,
    humor: 0.1,
    playfulness: 0.1,
    verbosity: 0.3,
  },
};
export function normalizeName(value: string) {
  return (
    value
      .trim()
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .slice(0, 40) || "Companion"
  );
}
export const taskLabels: Record<TaskStatus, string> = {
  queued: "Queued",
  running: "Working",
  waiting_for_user: "Waiting for you",
  permission_required: "Permission needed",
  succeeded: "Complete",
  failed: "Couldn’t complete",
  cancelled: "Cancelled",
};
export function providerState(
  local: boolean,
  key: boolean,
  provider: string,
  result = "",
) {
  if (local) return "Local only";
  if (result === "Testing") return "Testing";
  if (result === "Connected") return "Connected";
  if (result === "Authentication failed") return result;
  if (result === "Offline") return result;
  return provider === "ollama" || key ? "Configured" : "Not configured";
}
export function motionAllowed(
  reduced: boolean,
  visible: boolean,
  focused: boolean,
) {
  return !reduced && visible && focused;
}
export function faceFor(expression: CompanionExpression) {
  const faces: Record<
    CompanionExpression,
    { height: number; gaze: number; tilt: number; curve: boolean }
  > = {
    neutral: { height: 17, gaze: 0, tilt: 0, curve: false },
    attentive: { height: 22, gaze: 0, tilt: 0, curve: false },
    curious: { height: 19, gaze: 5, tilt: -4, curve: false },
    happy: { height: 12, gaze: 0, tilt: 0, curve: true },
    pleased: { height: 9, gaze: 0, tilt: 2, curve: true },
    thinking: { height: 13, gaze: 7, tilt: -3, curve: false },
    listening: { height: 23, gaze: 0, tilt: 2, curve: false },
    speaking: { height: 19, gaze: 0, tilt: 0, curve: false },
    focused: { height: 11, gaze: 0, tilt: 0, curve: false },
    waiting: { height: 14, gaze: -4, tilt: 0, curve: false },
    success: { height: 12, gaze: 0, tilt: 0, curve: true },
    confused: { height: 16, gaze: -3, tilt: 6, curve: false },
    concerned: { height: 12, gaze: 0, tilt: 3, curve: false },
    sleepy: { height: 6, gaze: 0, tilt: 3, curve: false },
    sleeping: { height: 2, gaze: 0, tilt: 0, curve: false },
    dizzy: { height: 14, gaze: -5, tilt: 7, curve: false },
    surprised: { height: 28, gaze: 0, tilt: -2, curve: false },
    annoyed: { height: 5, gaze: 0, tilt: -3, curve: false },
  };
  return faces[expression];
}
export type Notice = {
  key: string;
  message: string;
  priority: number;
  at: number;
};
export function coalesceNotices(existing: Notice[], next: Notice) {
  return [...existing.filter((n) => n.key !== next.key), next]
    .sort((a, b) => b.priority - a.priority || b.at - a.at)
    .slice(0, 4);
}
