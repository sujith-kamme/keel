import { describe, expect, it } from "vitest";
import { attachDecisions, matchesSearch, relativeTime, riskLevel, riskWidth, sessionState, sessionsHref, signalKind } from "./sessions-view";
import type { DecisionSummary, Turn } from "./keel";

const turn = (role: Turn["role"], text: string, decision_ids: string[] = []): Turn => ({
  role,
  text,
  decision_ids,
  created_at: "2026-01-01T00:00:00Z",
});
const dec = (decision_id: string): DecisionSummary => ({
  decision_id,
  tool: "refund",
  order_id: null,
  verdict: "ALLOW",
  reason_codes: [],
  created_at: "2026-01-01T00:00:00Z",
});

describe("attachDecisions", () => {
  it("keeps turn order", () => {
    const { turns } = attachDecisions([turn("customer", "a"), turn("agent", "b")], []);
    expect(turns.map((t) => t.text)).toEqual(["a", "b"]);
  });

  it("attaches by id in id order", () => {
    const { turns } = attachDecisions([turn("agent", "b", ["d2", "d1"])], [dec("d1"), dec("d2")]);
    expect(turns[0].decisions.map((d) => d.decision_id)).toEqual(["d2", "d1"]);
  });

  it("returns unlinked decisions in original order", () => {
    const { unlinked } = attachDecisions([turn("agent", "b", ["d2"])], [dec("d3"), dec("d2"), dec("d1")]);
    expect(unlinked.map((d) => d.decision_id)).toEqual(["d3", "d1"]);
  });

  it("ignores ids missing from the ledger", () => {
    const { turns } = attachDecisions([turn("agent", "b", ["gone", "d1"])], [dec("d1")]);
    expect(turns[0].decisions.map((d) => d.decision_id)).toEqual(["d1"]);
  });

  it("gives customer turns without ids an empty list", () => {
    const { turns } = attachDecisions([turn("customer", "a")], [dec("d1")]);
    expect(turns[0].decisions).toEqual([]);
  });
});

describe("risk helpers", () => {
  it("picks level by score and threshold", () => {
    expect(riskLevel(29, 50)).toBe("low");
    expect(riskLevel(30, 50)).toBe("medium");
    expect(riskLevel(49, 50)).toBe("medium");
    expect(riskLevel(50, 50)).toBe("high");
  });

  it("caps bar width", () => {
    expect(riskWidth(25, 50)).toBe(50);
    expect(riskWidth(80, 50)).toBe(100);
    expect(riskWidth(-5, 50)).toBe(0);
  });

  it("formats relative time and signals", () => {
    const now = new Date("2026-01-01T00:10:00Z");
    expect(relativeTime("2026-01-01T00:09:30Z", now)).toBe("just now");
    expect(relativeTime("2026-01-01T00:08:00Z", now)).toBe("2 min ago");
    expect(signalKind("INJECTION")).toBe("Prompt injection");
    expect(signalKind("NEW_KIND")).toBe("NEW_KIND");
  });
});

describe("sessionState", () => {
  it("labels and tones known states, neutral for others", () => {
    expect(sessionState("QUARANTINED")).toEqual({ label: "Quarantined", tone: "bad" });
    expect(sessionState("ACTIVE")).toEqual({ label: "Active", tone: "ok" });
    expect(sessionState("CLOSED")).toEqual({ label: "Closed", tone: "" });
  });
});

describe("matchesSearch", () => {
  const row = { claimed_email: "Maya@gmail.com", id: "ses_abc123", order_ids: ["5B20868483426524D"] };
  it("matches email, session id or order id, ignoring case", () => {
    expect(matchesSearch(row, "maya")).toBe(true);
    expect(matchesSearch(row, "ABC1")).toBe(true);
    expect(matchesSearch(row, "5b2086")).toBe(true);
    expect(matchesSearch(row, " ")).toBe(true);
    expect(matchesSearch(row, "sam")).toBe(false);
  });
});

describe("sessionsHref", () => {
  it("keeps the state and the page cursors", () => {
    expect(sessionsHref(null, [])).toBe("/sessions");
    expect(sessionsHref("QUARANTINED", [])).toBe("/sessions?state=QUARANTINED");
    expect(sessionsHref(null, ["ses_a", "ses_b"])).toBe("/sessions?pages=ses_a%2Cses_b");
  });
});
