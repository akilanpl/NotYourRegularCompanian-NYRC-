/**
 * Thin wrapper around the tauri invoke API. Provides graceful fallbacks for the
 * pure-browser dev environment so vite preview / svelte-check don't break when
 * tauri is not present.
 */
import { invoke as rawInvoke } from "@tauri-apps/api/core";
import {
  emit as rawEmit,
  listen as rawListen,
  type UnlistenFn,
} from "@tauri-apps/api/event";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri) {
    throw new Error(`tauri is not available in this context (cmd=${cmd})`);
  }
  return rawInvoke<T>(cmd, args);
}

export async function listen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  if (!inTauri) {
    return async () => {};
  }
  return rawListen<T>(event, (e) => handler(e.payload));
}

/** Cross-window broadcast (e.g. settings → pet overlay). No-op outside Tauri. */
export async function emit(event: string, payload?: unknown): Promise<void> {
  if (!inTauri) return;
  return rawEmit(event, payload);
}

export const isTauri = inTauri;

/** Backend cancellation drops an in-flight service future; late results cannot execute a second operation. */
export async function invokeService<T>(action: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new Error("Action cancelled");
  const requestId = serviceRequestId();
  const cancel = () => { void invoke("cancel_assistant_service", {requestId}).catch(() => {}); };
  signal?.addEventListener("abort", cancel, {once: true});
  try { return await invoke<T>("assistant_service", {action, payload, requestId}); }
  finally { signal?.removeEventListener("abort", cancel); }
}

export function serviceRequestId(source: Pick<Crypto, "getRandomValues"> = crypto): string {
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2,"0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
