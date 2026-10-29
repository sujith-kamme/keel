import { describe, expect, it } from "vitest";
import { type DisputeItem, buildDisputeRows, disputeErrorMessage, disputeKpis, disputeTimeline, isDisputeId, operatorActions, syncedText } from "./disputes-view";

const item = (over: Partial<DisputeItem> = {}): DisputeItem => ({
  id: "PP-D-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", amount: "35.00", currency: "USD", status: "OPEN", stage: "INQUIRY",
  classification: null, reason_codes: [], action: null, action_error: null, outcome: "OPEN", created_at: "t", updated_at: "u", ...over,
});

describe("disputes view", () => {
  it("builds grid rows", () => {
    const rows = buildDisputeRows([item(), item({ id: "PP-D-2", currency: "EUR" })]);
    expect(rows[0]).toEqual({ id: "PP-D-1", reason: "Item not received", amount: "$35.00", classification: "", action: "Classifying…", outcome: "OPEN", createdAt: "t", updatedAt: "u" });
    expect(rows[1]!.amount).toBe("35.00 EUR");
    expect(buildDisputeRows([item({ classification: "REVIEW", outcome: "WON" })])[0]!.action).toBe("No action taken");
  });

  it("counts and totals outcomes and what needs an operator", () => {
    const k = disputeKpis([
      item({ outcome: "WON", amount: "35.00" }),
      item({ outcome: "WON", amount: "10.5" }),
      item({ outcome: "CONCEDED", amount: "80.00" }),
      item({ action: "AWAITING_OPERATOR", amount: "12.00" }),
      item({ action: "FAILED", amount: "1.00" }),
      item({ action: "WAITING_ON_PAYPAL" }),
    ]);
    expect(k.won).toEqual({ count: 2, total: "$45.50" });
    expect(k.conceded).toEqual({ count: 1, total: "$80.00" });
    expect(k.lost).toEqual({ count: 0, total: "$0.00" });
    expect(k.needsYou).toEqual({ count: 2, total: "$13.00" });
    expect(disputeKpis([item({ outcome: "WON" }), item({ outcome: "WON", currency: "EUR" })]).won.total).toBe("$35.00 + 35.00 EUR");
  });

  it("says when PayPal was last synced", () => {
    const now = new Date("2026-10-28T09:05:00Z");
    expect(syncedText("2026-10-28T09:03:00Z", now)).toBe("PayPal synced 2 min ago");
    expect(syncedText(null, now)).toBe("Not synced with PayPal yet");
  });

  it("builds a timeline from the times Keel recorded", () => {
    const view = { session_id: null, reason_codes: [], args: null, hash: "h" };
    const events = disputeTimeline({
      created_at: "2026-10-28T08:00:00Z",
      updated_at: "2026-10-28T10:00:00Z",
      outcome: "WON",
      status: "RESOLVED",
      stage: "CHARGEBACK",
      decision_id: "dec_c",
      evidence: [{ ...view, seq: 1, decision_id: "dec_e", tool: "offer_refund", verdict: "BLOCK", action: null, reviewer: null, created_at: "2026-10-01T00:00:00Z" }],
      decisions: [
        { ...view, seq: 9, decision_id: "dec_o", tool: "dispute_action", verdict: "BLOCK", action: "submit_evidence", reviewer: "ops", created_at: "2026-10-28T09:00:00Z" },
        { ...view, seq: 8, decision_id: "dec_c", tool: "dispute", verdict: "BLOCK", action: null, reviewer: null, created_at: "2026-10-28T08:01:00Z" },
      ],
    });
    expect(events.map((e) => [e.label, e.note, e.seq])).toEqual([
      ["First seen by Keel", null, null],
      ["Classified: defend", "matched 1 ledger entry", 8],
      ["Operator submitted evidence", "by ops", 9],
      ["Last updated · won", "PayPal: RESOLVED (CHARGEBACK)", null],
    ]);
  });

  it("validates case ids", () => {
    expect(isDisputeId("PP-R-PYN-10194897")).toBe(true);
    expect(isDisputeId("../x")).toBe(false);
    expect(isDisputeId("")).toBe(false);
  });

  it("offers only what PayPal allows, while the operator can still act", () => {
    const base = { outcome: "OPEN", action: "AWAITING_OPERATOR", classification: "REVIEW", offered: ["provide_evidence", "accept_claim"], has_evidence: true };
    expect(operatorActions(base)).toEqual(["evidence", "accept"]);
    expect(operatorActions({ ...base, has_evidence: false })).toEqual(["accept"]);
    expect(operatorActions({ ...base, offered: [] })).toEqual([]);
    expect(operatorActions({ ...base, action: "EVIDENCE_SUBMITTED" })).toEqual([]);
    expect(operatorActions({ ...base, outcome: "WON" })).toEqual([]);
    expect(operatorActions({ ...base, action: "FAILED" })).toEqual(["evidence", "accept"]);
  });

  it("explains API errors", () => {
    expect(disputeErrorMessage(409, "not_offered")).toContain("doesn't allow");
    expect(disputeErrorMessage(409, "ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE")).toContain("still be reviewing");
  });
});
