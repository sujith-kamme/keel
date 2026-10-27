import { describe, expect, it } from "vitest";
import { attachDecisions } from "./sessions-view";
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
