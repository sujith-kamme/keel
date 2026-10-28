import { describe, expect, it } from "vitest";
import { buildDisputeRows, disputeErrorMessage, isDisputeId, operatorActions } from "./disputes-view";

describe("disputes view", () => {
  it("builds grid rows", () => {
    const rows = buildDisputeRows([{
      id: "PP-D-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", amount: "35.00", currency: "USD", status: "OPEN", stage: "INQUIRY",
      classification: null, reason_codes: [], action: null, action_error: null, outcome: "OPEN", created_at: "t", updated_at: "u",
    }]);
    expect(rows).toEqual([{ id: "PP-D-1", reason: "Item not received", amount: "35.00 USD", classification: "", action: "Classifying…", outcome: "OPEN", updatedAt: "u" }]);
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
