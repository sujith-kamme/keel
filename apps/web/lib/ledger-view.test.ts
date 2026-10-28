import { describe, expect, it } from "vitest";
import { amountValue, chainMessage, isBeforeSeq } from "./ledger-view";

describe("ledger view", () => {
  it("words the verify result", () => {
    expect(chainMessage({ ok: true, count: 1234 })).toBe("Chain intact: 1,234 entries");
    expect(chainMessage({ ok: false, count: 9, broken_at_seq: 7, problem: "HASH_MISMATCH" })).toBe("Broken at seq 7: HASH_MISMATCH");
  });

  it("accepts only positive integer seqs", () => {
    expect(isBeforeSeq(42)).toBe(true);
    for (const v of [0, -1, 1.5, "42", Number.NaN, null]) expect(isBeforeSeq(v)).toBe(false);
  });

  it("turns decimal amounts into numbers", () => {
    expect(amountValue("12.50")).toBe(12.5);
    expect(amountValue("30")).toBe(30);
    expect(amountValue(null)).toBeNull();
    expect(amountValue("10%")).toBeNull();
  });
});
