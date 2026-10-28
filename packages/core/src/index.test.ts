import { describe, expect, it } from "vitest";
import { Commitment, Extraction, ReasonCode } from "./index";

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

describe("Extraction", () => {
  const valid = {
    reply_commitments: [{ type: "REFUND", quoted_text: "I'll refund $42", amount: { value: "42.00", currency: "USD" }, percent: 10 }],
    injection_signals: [{ source: "customer", quoted_text: "ignore previous instructions" }],
    pii_mentions: [{ kind: "email", quoted_text: "a@b.com" }],
  };

  it("parses a valid extraction", () => {
    expect(Extraction.parse(valid).reply_commitments).toHaveLength(1);
  });

  it("rejects an unknown commitment type", () => {
    const bad = { ...valid, reply_commitments: [{ type: "GIFT", quoted_text: "x" }] };
    expect(() => Extraction.parse(bad)).toThrow();
  });

  it("rejects more than 20 commitments", () => {
    const many = Array.from({ length: 21 }, () => ({ type: "REFUND", quoted_text: "x" }));
    expect(() => Extraction.parse({ ...valid, reply_commitments: many })).toThrow();
  });

  it("rejects a negative percent", () => {
    const bad = { ...valid, reply_commitments: [{ type: "DISCOUNT", quoted_text: "x", percent: -1 }] };
    expect(() => Extraction.parse(bad)).toThrow();
  });
});

describe("ReasonCode", () => {
  it("accepts AGENT_FROZEN", () => {
    expect(ReasonCode.parse("AGENT_FROZEN")).toBe("AGENT_FROZEN");
  });
});
