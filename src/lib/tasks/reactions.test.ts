import { describe, expect, it } from "vitest";
import { reactionForTaskStatus } from "./reactions";

describe("scheduled task reactions", () => {
  it("acknowledges reminder and alarm creation", () => {
    expect(reactionForTaskStatus("succeeded", "reminder.create").expression)
      .toBe("pleased");
    expect(reactionForTaskStatus("succeeded", "alarm.create").expression)
      .toBe("pleased");
  });

  it("acknowledges dismiss and cancel without a celebratory reaction", () => {
    expect(reactionForTaskStatus("succeeded", "reminder.dismiss").expression)
      .toBe("neutral");
    expect(reactionForTaskStatus("succeeded", "alarm.cancel").expression)
      .toBe("neutral");
  });

  it("uses the concerned error reaction for failed scheduling", () => {
    expect(reactionForTaskStatus("failed", "reminder.create")).toMatchObject({
      expression: "concerned",
      signal: "error",
    });
  });

  it("maps partially successful modes to a concerned but non-fatal reaction", () => {
    expect(reactionForTaskStatus("succeeded", "mode.activate", {
      status: "partial_success",
      steps: [],
    })).toMatchObject({ expression: "concerned", signal: "error" });
  });
});
