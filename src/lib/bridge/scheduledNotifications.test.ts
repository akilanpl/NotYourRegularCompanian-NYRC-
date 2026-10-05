import { describe, expect, it, vi } from "vitest";
import {
  createScheduledNotifications,
  type ScheduledNotificationAdapter,
} from "./scheduledNotifications";

function adapter(
  options: {
    available?: boolean;
    granted?: boolean;
    permission?: NotificationPermission | null;
    requestResult?: NotificationPermission;
    send?: () => void;
  } = {},
): ScheduledNotificationAdapter {
  return {
    available: () => options.available ?? true,
    granted: async () => options.granted ?? false,
    permission: () => options.permission === undefined ? "default" : options.permission,
    request: async () => options.requestResult ?? "default",
    send: options.send ?? (() => {}),
  };
}

describe("scheduled notification permission", () => {
  it("distinguishes granted, denied, not requested, and unavailable", async () => {
    expect(await createScheduledNotifications(adapter({ granted: true })).permission())
      .toBe("granted");
    expect(await createScheduledNotifications(adapter({ permission: "denied" })).permission())
      .toBe("denied");
    expect(await createScheduledNotifications(adapter({ permission: "default" })).permission())
      .toBe("not_requested");
    expect(await createScheduledNotifications(adapter({ available: false })).permission())
      .toBe("unavailable");
  });

  it("requests permission only when explicitly invoked and never retries denied", async () => {
    const request = vi.fn(async () => "denied" as NotificationPermission);
    const service = createScheduledNotifications({
      ...adapter({ permission: "denied" }),
      request,
    });
    expect(await service.permission()).toBe("denied");
    expect(await service.request()).toBe("denied");
    expect(request).not.toHaveBeenCalled();

    const explicit = createScheduledNotifications({
      ...adapter({ permission: "default" }),
      request: async () => "granted",
    });
    expect(await explicit.request()).toBe("granted");
  });

  it("does not lose the in-app flow when OS notification delivery fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const service = createScheduledNotifications(
      adapter({ granted: true, send: () => { throw new Error("unavailable"); } }),
    );
    expect(await service.send("NYRC", "Reminder")).toBe(false);
    expect(await service.permission()).toBe("granted");
    warn.mockRestore();
  });

  it("never requests permission during notification delivery", async () => {
    let requested = false;
    const service = createScheduledNotifications({
      ...adapter({ permission: "default" }),
      request: async () => {
        requested = true;
        return "granted";
      },
    });
    expect(await service.send("NYRC", "Reminder")).toBe(false);
    expect(requested).toBe(false);
  });
});
