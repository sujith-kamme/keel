import { describe, expect, it } from "vitest";
import { Commitment } from "./index";

describe("Commitment", () => {
  it("accepts a tool-call refund", () => {
    const parsed = Commitment.parse({
      id: "c1",
      type: "REFUND",
      source: "TOOL_CALL",
      order_id: "O-1",
      amount: { value: "45.00", currency: "USD" },
    });
    expect(parsed.amount?.value).toBe("45.00");
  });

  it("rejects a malformed amount", () => {
    expect(() =>
      Commitment.parse({ id: "c2", type: "REFUND", source: "TOOL_CALL", amount: { value: "45.001", currency: "USD" } }),
    ).toThrow();
  });
});
