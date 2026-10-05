import { describe, expect, it } from "vitest";
import { newPetState } from "../sim/state";
import {
  createReaction,
  reactionForInteraction,
  reactionsFor,
  validateReaction,
} from "./reaction";

describe("semantic reactions", () => {
  it("validates and supplies defaults for a reaction intent", () => {
    expect(
      createReaction({ expression: "success", gesture: "celebrate" }),
    ).toEqual({
      expression: "success",
      gesture: "celebrate",
      intensity: 0.5,
      durationMs: 900,
    });
  });

  it("rejects invalid values and renderer-specific fields", () => {
    expect(validateReaction({ expression: "unknown" })).toBeNull();
    expect(validateReaction({ expression: "happy", intensity: 1.1 })).toBeNull();
    expect(validateReaction({ expression: "happy", intensity: null })).toBeNull();
    expect(validateReaction({ expression: "happy", durationMs: 0 })).toBeNull();
    expect(validateReaction({ expression: "happy", filename: "companion-happy.png" })).toBeNull();
  });

  it("maps touch frequency to restrained acknowledgement reactions", () => {
    expect(reactionForInteraction(1).expression).toBe("pleased");
    expect(reactionForInteraction(2).expression).toBe("confused");
    expect(reactionForInteraction(4).expression).toBe("annoyed");
  });

  it("defines shake as surprise, dizziness, then recovery", () => {
    expect(reactionsFor("shake").map(({ expression }) => expression)).toEqual([
      "surprised",
      "dizzy",
      "attentive",
    ]);
  });

  it("covers future assistant, productivity, and system events", () => {
    expect(reactionsFor("listening")[0].expression).toBe("listening");
    expect(reactionsFor("task_succeeded")[0].expression).toBe("success");
    expect(reactionsFor("permission_required")[0].signal).toBe("permission_required");
    expect(reactionsFor("timer_finished")[0].signal).toBe("timer");
    expect(reactionsFor("focus_started")[0].signal).toBe("focus");
    expect(reactionsFor("dnd_active")[0].signal).toBe("dnd_active");
    expect(reactionsFor("offline")[0].signal).toBe("offline");
    expect(reactionsFor("reconnecting")[0].signal).toBe("reconnecting");
    expect(reactionsFor("low_battery")[0].signal).toBe("low_battery");
  });

  it("does not constrain the companion's name", () => {
    expect(newPetState("Nova").name).toBe("Nova");
    expect(newPetState("NYRC").name).toBe("NYRC");
  });
});
