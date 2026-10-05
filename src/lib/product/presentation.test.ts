import { describe, it, expect } from "vitest";
import {
  faceFor,
  motionAllowed,
  normalizeName,
  presets,
  providerState,
  taskLabels,
  coalesceNotices,
} from "./presentation";
import { COMPANION_EXPRESSIONS } from "../character";
import { BodyCore } from "../body/core";
import { VirtualBodyAdapter } from "../body/adapters";
describe("product presentation contracts", () => {
  it.each(COMPANION_EXPRESSIONS)(
    "renders %s with a small-display aperture",
    (expression) => {
      const face = faceFor(expression);
      expect(face.height).toBeGreaterThan(0);
      expect(face.height).toBeLessThanOrEqual(28);
      expect(Math.abs(face.tilt)).toBeLessThan(10);
    },
  );
  it("keeps sleeping, surprised and focused faces distinguishable", () => {
    expect(faceFor("sleeping").height).toBeLessThan(faceFor("focused").height);
    expect(faceFor("surprised").height).toBeGreaterThan(
      faceFor("neutral").height,
    );
  });
  it("normalizes names without changing the product identity", () => {
    expect(normalizeName(" Nova ")).toBe("Nova");
    expect(normalizeName("")).toBe("Companion");
    expect(normalizeName("x".repeat(60))).toHaveLength(40);
  });
  it("offers bounded dimensions and useful quiet defaults", () => {
    for (const preset of Object.values(presets))
      for (const value of Object.values(preset)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    expect(presets.Quiet.initiative).toBeLessThan(presets.Balanced.initiative);
  });
  it.each([
    [true, false, "gemini", "", "Local only"],
    [false, false, "gemini", "", "Not configured"],
    [false, true, "gemini", "", "Configured"],
    [false, false, "ollama", "Testing", "Testing"],
    [false, true, "gemini", "Connected", "Connected"],
    [false, true, "gemini", "Authentication failed", "Authentication failed"],
    [false, false, "ollama", "Offline", "Offline"],
  ] as const)(
    "shows provider state without secrets",
    (local, key, provider, result, expected) =>
      expect(providerState(local, key, provider, result)).toBe(expected),
  );
  it("disables motion for hidden, unfocused or reduced-motion surfaces", () => {
    expect(motionAllowed(false, true, true)).toBe(true);
    expect(motionAllowed(true, true, true)).toBe(false);
    expect(motionAllowed(false, false, true)).toBe(false);
    expect(motionAllowed(false, true, false)).toBe(false);
  });
  it("labels paused tasks and cancellation explicitly", () => {
    expect(taskLabels.permission_required).toBe("Permission needed");
    expect(taskLabels.cancelled).toBe("Cancelled");
    expect(Object.keys(taskLabels)).toHaveLength(7);
  });
  it("coalesces repeat notifications and prioritizes urgent items with bounded history", () => {
    let n = [] as Parameters<typeof coalesceNotices>[0];
    for (let i = 0; i < 10; i++)
      n = coalesceNotices(n, {
        key: String(i),
        message: "notice",
        priority: i === 0 ? 3 : 1,
        at: i,
      });
    expect(n).toHaveLength(4);
    expect(n[0].key).toBe("0");
    n = coalesceNotices(n, {
      key: "0",
      message: "updated",
      priority: 3,
      at: 20,
    });
    expect(n[0].message).toBe("updated");
    expect(n.filter((x) => x.key === "0")).toHaveLength(1);
  });
  it("retains battery and disconnected device status while local body remains available", async () => {
    const core = new BodyCore(),
      body = new VirtualBodyAdapter();
    await core.connect(body);
    body.simulate("battery", { percent: 42 });
    expect(core.diagnostics()[0].batteryPercent).toBe(42);
    await core.disconnect("virtual");
    expect(core.diagnostics()[0].connected).toBe(false);
  });
});
