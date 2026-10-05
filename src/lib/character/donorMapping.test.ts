import { describe, expect, it } from "vitest";
import type { CompanionExpression } from "./expression";
import {
  donorAnimationForExpression,
  donorAnimationForReaction,
  expressionForLegacyMood,
} from "./donorMapping";
import { reactionsFor } from "./reaction";

describe("temporary donor animation mapping", () => {
  it("maps every semantic expression to an existing movement state", () => {
    const expressions: CompanionExpression[] = [
      "neutral", "attentive", "curious", "happy", "pleased", "thinking",
      "listening", "speaking", "focused", "waiting", "success", "confused",
      "concerned", "sleepy", "sleeping", "dizzy", "surprised", "annoyed",
    ];
    expect(expressions.map(donorAnimationForExpression)).toEqual([
      "idle", "look_cursor", "peek", "celebrate", "blush", "tilt_head",
      "look_cursor", "nuzzle", "sit", "sit", "celebrate", "tilt_head",
      "sit", "yawn", "sleep", "dizzy", "surprise", "shake",
    ]);
  });

  it("prefers a reaction gesture hint and adapts legacy mood", () => {
    const success = reactionsFor("task_succeeded")[0];
    expect(donorAnimationForReaction(success)).toBe("celebrate");
    expect(expressionForLegacyMood("tired")).toBe("sleepy");
    expect(expressionForLegacyMood("happy")).toBe("happy");
  });
});
