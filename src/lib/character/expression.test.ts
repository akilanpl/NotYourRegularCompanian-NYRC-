import { describe, expect, it } from "vitest";
import {
  COMPANION_EXPRESSIONS,
  COMPANION_SIGNALS,
  isCompanionExpression,
  isCompanionSignal,
} from "./expression";

describe("companion expression vocabulary", () => {
  it("exposes the compact semantic expression set", () => {
    expect(COMPANION_EXPRESSIONS).toEqual([
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
    ]);
    expect(isCompanionExpression("focused")).toBe(true);
    expect(isCompanionExpression("companion-happy.png")).toBe(false);
  });

  it("keeps utility and system signals separate from expressions", () => {
    expect(COMPANION_SIGNALS).toContain("permission_required");
    expect(COMPANION_SIGNALS).toContain("low_battery");
    expect(isCompanionSignal("offline")).toBe(true);
    expect(isCompanionSignal("sleeping")).toBe(false);
  });
});
