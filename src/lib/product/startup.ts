export type StartupPhase = "preparing" | "ready" | "failed";
/** A delayed initial IPC snapshot must not overwrite a terminal event. */
export function advanceStartup(
  current: StartupPhase,
  incoming: unknown,
): StartupPhase {
  if (current !== "preparing") return current;
  return incoming === "ready" || incoming === "failed" ? incoming : current;
}
