import { describe, expect, it } from "vitest";
import type { CompanionExpression } from "./expression";
import {
  animationForExpression,
  animationForReaction,
  expressionForMood,
} from "./rendererMapping";
import { reactionsFor } from "./reaction";

describe("simulation choreography mapping", () => {
  it("maps every semantic expression to an existing movement state", () => {
    const expressions: CompanionExpression[] = [
      "neutral", "attentive", "curious", "happy", "pleased", "thinking",
      "listening", "speaking", "focused", "waiting", "success", "confused",
      "concerned", "sleepy", "sleeping", "dizzy", "surprised", "annoyed",
    ];
    expect(expressions.map(animationForExpression)).toEqual([
      "idle", "look_cursor", "peek", "celebrate", "blush", "tilt_head",
      "look_cursor", "nuzzle", "sit", "sit", "celebrate", "tilt_head",
      "sit", "yawn", "sleep", "dizzy", "surprise", "shake",
    ]);
  });

  it("prefers a reaction gesture hint and adapts legacy mood", () => {
    const success = reactionsFor("task_succeeded")[0];
    expect(animationForReaction(success)).toBe("celebrate");
    expect(expressionForMood("tired")).toBe("sleepy");
    expect(expressionForMood("happy")).toBe("happy");
  });
});
