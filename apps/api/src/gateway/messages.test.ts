import { describe, expect, it } from "vitest";
import { HOLD_MESSAGE } from "./messages";

describe("HOLD_MESSAGE (DP-7)", () => {
  it("never claims an action succeeded", () => {
    expect(HOLD_MESSAGE).not.toMatch(/\b(refunded|issued|approved|processed|completed|done)\b/i);
  });
});
