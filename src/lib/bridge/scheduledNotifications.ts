import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { api } from "./api";

export type ScheduledNotificationPermission =
  | "granted"
  | "denied"
  | "unavailable"
  | "not_requested";

export interface ScheduledNotificationAdapter {
  available(): boolean;
  granted(): Promise<boolean>;
  permission(): NotificationPermission | null;
  request(): Promise<NotificationPermission>;
  send(title: string, body: string): void;
}

const tauriNotifications: ScheduledNotificationAdapter = {
  available: () => api.hasBackend,
  granted: isPermissionGranted,
  permission: () => typeof Notification === "undefined" ? null : Notification.permission,
  request: requestPermission,
  send: (title, body) => sendNotification({ title, body }),
};

export function createScheduledNotifications(adapter: ScheduledNotificationAdapter, now: () => number = Date.now) {
  let sentAt: number[] = [];
  async function permission(): Promise<ScheduledNotificationPermission> {
    if (!adapter.available()) return "unavailable";
    try {
      if (await adapter.granted()) return "granted";
      const state = adapter.permission();
      if (state === "denied") return "denied";
      if (state === "default") return "not_requested";
      return "unavailable";
    } catch (error) {
      console.warn("scheduled notification permission check failed", error);
      return "unavailable";
    }
  }

  async function request(): Promise<ScheduledNotificationPermission> {
    if (!adapter.available()) return "unavailable";
    const browserPermission = adapter.permission();
    if (browserPermission === "granted") return "granted";
    if (browserPermission === "denied") return "denied";
    try {
      const state = await adapter.request();
      return state === "granted" ? "granted" : state === "denied" ? "denied" : "not_requested";
    } catch (error) {
      console.warn("scheduled notification permission request failed", error);
      return "unavailable";
    }
  }

  async function send(title: string, body: string): Promise<boolean> {
    if (await permission() !== "granted") return false;
    try {
      const at = now();
      sentAt = sentAt.filter(t => at >= t && at - t < 10000);
      if (sentAt.length >= 3) return false; // all alerts remain in the bounded in-app queue and durable reminder list
      sentAt.push(at);
      adapter.send(title.slice(0,200), body.slice(0,1000));
      return true;
    } catch (error) {
      console.warn("scheduled desktop notification failed", error);
      return false;
    }
  }

  return { permission, request, send };
}

const scheduledNotifications = createScheduledNotifications(tauriNotifications);

export const getScheduledNotificationPermission = scheduledNotifications.permission;
export const requestScheduledNotificationPermission = scheduledNotifications.request;
export const sendScheduledNotification = scheduledNotifications.send;
