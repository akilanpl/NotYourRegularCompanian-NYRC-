import { it, expect } from "vitest";
import { advanceStartup } from "./startup";
it("ignores an old preparing snapshot after readiness", () => {
  const phase = advanceStartup("preparing", "ready");
  expect(advanceStartup(phase, "preparing")).toBe("ready");
});
it("retains initialization failure over a delayed snapshot", () => {
  expect(advanceStartup("failed", "preparing")).toBe("failed");
});
it("accepts only closed startup phases", () => {
  expect(advanceStartup("preparing", { storagePath: "/private" })).toBe(
    "preparing",
  );
  expect(advanceStartup("preparing", "failed")).toBe("failed");
});
