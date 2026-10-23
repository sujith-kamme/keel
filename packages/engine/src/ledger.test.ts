import { describe, expect, it } from "vitest";
import { type LedgerContent, type LedgerRecord, chainEntry, hashEntry, verifyChain } from "./ledger";

function content(n: number): LedgerContent {
  return {
    decision_id: `dec_${n}`,
    session_id: "ses_1",
    order_id: "O-1",
    capture_id: null,
    dispute_id: null,
    mode: "LIVE",
    verdict: "ALLOW",
    reason_codes: ["OK"],
    payload: { n, nested: { b: 2, a: 1 } },
  };
}

function chain(count: number): LedgerRecord[] {
  const records: LedgerRecord[] = [];
  for (let n = 0; n < count; n++) records.push(chainEntry(content(n), records.at(-1)?.hash ?? null));
  return records;
}

describe("ledger hash chain", () => {
  it("verifies an untouched chain", () => {
    expect(verifyChain(chain(3))).toEqual({ ok: true });
  });

  it("detects an edited payload", () => {
    const records = chain(3);
    records[1] = { ...records[1]!, payload: { n: 99 } };
    expect(verifyChain(records)).toEqual({ ok: false, index: 1, reason: "HASH_MISMATCH" });
  });

  it("detects an edited verdict", () => {
    const records = chain(3);
    records[2] = { ...records[2]!, verdict: "BLOCK" };
    expect(verifyChain(records)).toEqual({ ok: false, index: 2, reason: "HASH_MISMATCH" });
  });

  it("detects a deleted entry", () => {
    const records = chain(3);
    records.splice(1, 1);
    expect(verifyChain(records)).toEqual({ ok: false, index: 1, reason: "BROKEN_LINK" });
  });

  it("detects reordered entries", () => {
    const [a, b, c] = chain(3);
    expect(verifyChain([a!, c!, b!])).toEqual({ ok: false, index: 1, reason: "BROKEN_LINK" });
  });

  it("hashes the same content identically whatever its key order", () => {
    const reordered = { ...content(1), payload: { nested: { a: 1, b: 2 }, n: 1 } };
    expect(hashEntry(reordered, "abc")).toBe(hashEntry(content(1), "abc"));
  });
});
