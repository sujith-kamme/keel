import { describe, expect, it } from "vitest";
import { chatHistory } from "./history";

const dec = (id: string) => ({ decision_id: id, tool: "offer_refund", order_id: "ord_1", verdict: "ALLOW", reason_codes: ["OK"] });
const turn = (role: "customer" | "agent", text: string, decision_ids: string[] = []) => ({ role, text, decision_ids, created_at: "2026-01-01T00:00:00Z" });

describe("chatHistory", () => {
  it("attaches each turn's decisions in the turn's order and drops unknown ids", () => {
    const h = chatHistory({ turns: [turn("customer", "a"), turn("agent", "b", ["d2", "gone", "d1"])], decisions: [dec("d1"), dec("d2")] });
    expect(h).toEqual([
      { role: "customer", text: "a", decisions: [] },
      { role: "agent", text: "b", decisions: [dec("d2"), dec("d1")] },
    ]);
  });
});
