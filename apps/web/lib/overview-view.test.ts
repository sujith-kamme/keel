import { describe, expect, it } from "vitest";
import { activity, certStrip, dayLabel, usd } from "./overview-view";

describe("overview view", () => {
  it("formats decimal-string dollars with separators, without floats", () => {
    expect(usd("155.00")).toBe("$155.00");
    expect(usd("1234567.5")).toBe("$1,234,567.50");
    expect(usd("0")).toBe("$0.00");
    expect(usd("12")).toBe("$12.00");
    expect(usd("bad")).toBe("—");
  });

  it("words the certification strip for each state", () => {
    const base = { run_id: "run_1", reasons: [], current_versions: {} as never };
    expect(certStrip({ ...base, status: "CERTIFIED", leaks: 0, scenarios: 51, finished_at: "2026-10-28T21:37:10Z" })).toEqual({
      tone: "ok",
      title: "Certified",
      runId: "run_1",
      detail: "passed on the versions in production · 0 leaks in 51 scenarios · Oct 28, 21:37 UTC",
    });
    expect(certStrip({ ...base, status: "STALE", reasons: ["policy refund-standard changed", "agent_prompt changed"] })).toEqual({
      tone: "warn",
      title: "Stale",
      runId: "run_1",
      detail: "passed, but production has changed since: policy refund-standard changed; agent_prompt changed",
    });
    expect(certStrip({ ...base, status: "NOT_CERTIFIED", reasons: ["1 leak(s)"], leaks: 1, scenarios: 1, finished_at: null })).toMatchObject({
      tone: "neu",
      detail: "did not pass: 1 leak(s) · 1 leak in 1 scenario",
    });
    expect(certStrip({ ...base, status: "NOT_CERTIFIED", run_id: null, reasons: ["no guarded run"] })).toEqual({ tone: "neu", title: "Not certified", runId: null, detail: "No guarded run" });
    expect(certStrip(null)).toMatchObject({ tone: "neu", detail: "Couldn't load certification." });
  });

  it("turns a ledger row into a line of recent activity", () => {
    const row = {
      seq: 7,
      decision_id: "dec_1",
      created_at: "2026-10-28T18:26:00.000Z",
      session_id: "ses_1",
      order_id: "O-1",
      capture_id: null,
      dispute_id: null,
      mode: "LIVE",
      verdict: "BLOCK",
      reason_codes: ["OUTSIDE_WINDOW"],
      tool: "offer_refund",
      amount: "35",
      hash: "h",
      prev_hash: null,
      payload: {},
    };
    expect(activity(row)).toEqual({ seq: 7, time: "Oct 28, 18:26", event: "Refund · Outside the refund window", reference: "O-1", amount: "$35.00", decision: { label: "Blocked", tone: "bad" } });
    expect(activity({ ...row, tool: "dispute", order_id: null, dispute_id: "PP-D-1", verdict: "ALLOW", reason_codes: ["OK"], amount: null })).toMatchObject({
      event: "Dispute classified",
      reference: "PP-D-1",
      amount: null,
      decision: { label: "Allowed", tone: "ok" },
    });
    expect(activity({ ...row, tool: "something_new", reason_codes: ["NEW_CODE"] }).event).toBe("something_new · NEW_CODE");
  });

  it("labels chart days", () => {
    expect(dayLabel("2026-10-05")).toBe("Oct 5");
  });
});
