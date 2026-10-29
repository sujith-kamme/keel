import { describe, expect, it } from "vitest";
import { amountValue, chainMessage, entrySentence, entryTitle, hashCheck, inRange, isBeforeSeq, shortHash, utcStamp } from "./ledger-view";

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

  it("formats hashes and UTC times", () => {
    expect(shortHash("a41f0000000009c2")).toBe("a41f…09c2");
    expect(utcStamp("2026-10-28T09:38:44Z")).toBe("Oct 28, 09:38:44");
    expect(utcStamp("nope")).toBe("—");
  });

  it("filters rows by range back from now", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    expect(inRange("2026-10-28T11:30:00Z", "1h", now)).toBe(true);
    expect(inRange("2026-10-28T10:30:00Z", "1h", now)).toBe(false);
    expect(inRange("2026-10-27T13:00:00Z", "24h", now)).toBe(true);
    expect(inRange("2026-10-20T12:00:00Z", "7d", now)).toBe(false);
    expect(inRange("2020-01-01T00:00:00Z", "all", now)).toBe(true);
  });

  it("words the entry's hash check", () => {
    expect(hashCheck({ prev: { seq: 9, hash: "h" }, hash_ok: true, link_ok: true })).toEqual({ ok: true, title: "Hash verified", detail: "This entry's hash matches its content and links to entry 9." });
    expect(hashCheck({ prev: null, hash_ok: true, link_ok: true }).detail).toContain("first entry");
    expect(hashCheck({ prev: { seq: 9, hash: "h" }, hash_ok: false, link_ok: false })).toEqual({
      ok: false,
      title: "Hash mismatch",
      detail: "This entry's hash doesn't match its content, and its previous hash doesn't match entry 9.",
    });
  });

  it("says what happened from the entry's own fields", () => {
    const base = { tool: "offer_refund", verdict: "BLOCK", reason_codes: ["OUTSIDE_WINDOW"], amount: "35.00", order_id: "9UM3", dispute_id: null };
    expect(entrySentence(base)).toBe("Refund of $35.00 on order 9UM3. Keel blocked it: outside the refund window.");
    expect(entrySentence({ ...base, tool: "get_order", verdict: "ALLOW", reason_codes: ["OK"], amount: null })).toBe("Order lookup on order 9UM3. Keel allowed it.");
    expect(entrySentence({ ...base, tool: "dispute", reason_codes: ["DISPUTE_WITHIN_POLICY"], order_id: null, dispute_id: "PP-1" })).toBe(
      "Keel classified dispute PP-1 of $35.00 as one to defend: agent acted within policy.",
    );
    expect(entrySentence({ ...base, tool: null, amount: "10%" })).toBe("Ledger entry on order 9UM3. Keel blocked it: outside the refund window.");
  });

  it("titles an entry", () => {
    expect(entryTitle({ tool: "offer_refund", verdict: "BLOCK" })).toBe("refund blocked");
    expect(entryTitle({ tool: "dispute", verdict: "BLOCK" })).toBe("dispute classified: defend");
    expect(entryTitle({ tool: null, verdict: "ALLOW" })).toBe("ledger entry allowed");
  });
});
