import { describe, expect, it, vi } from "vitest";
import type { TurnInput } from "./agent";
import { type ChatDeps, chatHistory, chatTurn } from "./chat";

type Decision = { decision_id: string; tool: string; order_id: string | null; verdict: string; reason_codes: string[] };

// A Keel that records turns and serves them back; `decide` is what the gateway recorded for a tool call.
function fakeKeel() {
  let agent = "agt_policy";
  const turns: { role: "customer" | "agent"; text: string; decision_ids: string[]; agent_id?: string }[] = [];
  const decisions: Decision[] = [];
  const keel: ChatDeps["keel"] = {
    detail: vi.fn(async () => ({ session: { agent_id: agent }, turns: [...turns], decisions: [...decisions] })),
    appendTurn: vi.fn(async (_id, t) => {
      turns.push(t);
    }),
    guard: vi.fn(async (b) => ({ final_reply: b.draft_reply, decision_id: `dec_g${turns.length}` })),
    token: vi.fn(async () => ({ agent_id: agent, capability_token: "tok_refund" })),
  };
  const decide = (d: Decision) => {
    decisions.push(d);
    if (d.tool === "handoff_to_refund" && d.verdict === "ALLOW") agent = "agt_refund";
    return d.decision_id;
  };
  return { keel, turns, decide };
}

const handoff = (verdict: string): Decision => ({ decision_id: "dec_h", tool: "handoff_to_refund", order_id: "ord_1", verdict, reason_codes: [] });

const input = { sessionId: "ses_1", token: "tok_policy", agentId: "agt_policy" as const, context: { customer_email: "a@b.c", verified: true, orders: [] }, customerText: "refund please" };

describe("chatTurn", () => {
  it("runs the refund agent on the same message after an allowed handoff and returns its token", async () => {
    const { keel, turns, decide } = fakeKeel();
    const seen: TurnInput[] = [];
    const agent = vi.fn(async (id: string, token: string) => ({
      turn: async (t: TurnInput) => {
        seen.push(t);
        const ids = id === "agt_policy" ? [decide(handoff("ALLOW"))] : [];
        return { reply: `${id} with ${token}`, decision_ids: ids };
      },
      close: async () => {},
    }));
    const out = await chatTurn({ keel, agent, followHandoff: true, fallback: "HANDOFF" }, input);
    expect(out.replies).toEqual([
      { agent_id: "agt_policy", text: "agt_policy with tok_policy" },
      { agent_id: "agt_refund", text: "agt_refund with tok_refund" },
    ]);
    expect(out).toMatchObject({ agentId: "agt_refund", token: "tok_refund" });
    expect(turns.map((t) => [t.role, t.agent_id])).toEqual([
      ["customer", undefined],
      ["agent", "agt_policy"],
      ["agent", "agt_refund"],
    ]);
    // Same customer message, not stored twice; the refund agent gets the history from before it.
    expect(seen[1]!.customerText).toBe("refund please");
    expect(seen[1]!.history).toEqual([]);
    // The refund hop's guard sees the conversation in real order.
    expect(vi.mocked(keel.guard).mock.calls[1]![0].conversation).toEqual([{ role: "customer", text: "refund please" }]);
  });

  it("gives the refund agent alternating messages on a later message", async () => {
    const { keel, turns, decide } = fakeKeel();
    turns.push({ role: "customer", text: "hi", decision_ids: [] }, { role: "agent", text: "hello", decision_ids: [] });
    const seen: TurnInput[] = [];
    const agent = vi.fn(async (id: string) => ({
      turn: async (t: TurnInput) => {
        seen.push(t);
        return { reply: id, decision_ids: id === "agt_policy" ? [decide(handoff("ALLOW"))] : [] };
      },
      close: async () => {},
    }));
    await chatTurn({ keel, agent, followHandoff: true, fallback: "HANDOFF" }, input);
    const roles = (t: TurnInput) => [...t.history.map((h) => h.role), "customer"];
    expect(roles(seen[0]!)).toEqual(["customer", "agent", "customer"]);
    expect(seen[1]!.history).toEqual(seen[0]!.history);
    expect(roles(seen[1]!)).toEqual(["customer", "agent", "customer"]);
    expect(seen[1]!.customerText).toBe("refund please");
    expect(vi.mocked(keel.guard).mock.calls[1]![0].conversation.map((c) => c.text)).toEqual(["hi", "hello", "refund please"]);
  });

  it("runs the session's current agent with a fresh token when the caller holds the old one", async () => {
    const { keel, decide } = fakeKeel();
    decide(handoff("ALLOW"));
    const agent = vi.fn(async (id: string, token: string) => ({ turn: async () => ({ reply: `${id} with ${token}`, decision_ids: [] }), close: async () => {} }));
    const out = await chatTurn({ keel, agent, followHandoff: true, fallback: "HANDOFF" }, input);
    expect(agent).toHaveBeenCalledTimes(1);
    expect(agent).toHaveBeenCalledWith("agt_refund", "tok_refund");
    expect(out).toEqual({ replies: [{ agent_id: "agt_refund", text: "agt_refund with tok_refund" }], agentId: "agt_refund", token: "tok_refund" });
  });

  it("throws when the token minted after an allowed handoff is not the refund agent's", async () => {
    const { keel, decide } = fakeKeel();
    keel.token = vi.fn(async () => ({ agent_id: "agt_policy", capability_token: "tok_x" }));
    const agent = vi.fn(async () => ({ turn: async () => ({ reply: "joining", decision_ids: [decide(handoff("ALLOW"))] }), close: async () => {} }));
    await expect(chatTurn({ keel, agent, followHandoff: true, fallback: "HANDOFF" }, input)).rejects.toThrow();
  });

  it("stays with the policy agent when Keel did not allow the handoff, whatever the reply says", async () => {
    const { keel, decide } = fakeKeel();
    const agent = vi.fn(async () => ({
      turn: async () => ({ reply: "A refunds specialist has joined.", decision_ids: [decide(handoff("HOLD"))] }),
      close: async () => {},
    }));
    const out = await chatTurn({ keel, agent, followHandoff: true, fallback: "HANDOFF" }, input);
    expect(out).toEqual({ replies: [{ agent_id: "agt_policy", text: "A refunds specialist has joined." }], agentId: "agt_policy", token: "tok_policy" });
    expect(agent).toHaveBeenCalledTimes(1);
    expect(keel.token).not.toHaveBeenCalled();
  });

  it("stops at the handoff when followHandoff is false", async () => {
    const { keel, decide } = fakeKeel();
    const agent = vi.fn(async () => ({ turn: async () => ({ reply: "joining", decision_ids: [decide(handoff("ALLOW"))] }), close: async () => {} }));
    const out = await chatTurn({ keel, agent, followHandoff: false, fallback: "HANDOFF" }, input);
    expect(out.replies).toHaveLength(1);
    expect(out.agentId).toBe("agt_refund");
    expect(agent).toHaveBeenCalledTimes(1);
    expect(keel.token).not.toHaveBeenCalled();
  });

  it("sends the fallback, never the draft, when the guard fails", async () => {
    const { keel, turns } = fakeKeel();
    keel.guard = vi.fn(async () => {
      throw new Error("down");
    });
    const agent = vi.fn(async () => ({ turn: async () => ({ reply: "draft", decision_ids: ["dec_1"] }), close: async () => {} }));
    const out = await chatTurn({ keel, agent, followHandoff: true, fallback: "HANDOFF" }, input);
    expect(out.replies).toEqual([{ agent_id: "agt_policy", text: "HANDOFF" }]);
    expect(turns.at(-1)).toEqual({ role: "agent", text: "HANDOFF", decision_ids: ["dec_1"], agent_id: "agt_policy" });
  });

  it("closes the agent's tool connection even when its turn throws", async () => {
    const { keel } = fakeKeel();
    const close = vi.fn(async () => {});
    const agent = vi.fn(async () => ({
      turn: async () => {
        throw new Error("model down");
      },
      close,
    }));
    await expect(chatTurn({ keel, agent, followHandoff: true, fallback: "HANDOFF" }, input)).rejects.toThrow("model down");
    expect(close).toHaveBeenCalled();
  });
});

describe("chatHistory", () => {
  it("attaches each turn's decisions in its own order", () => {
    const h = chatHistory({
      turns: [{ role: "agent", text: "b", decision_ids: ["d2", "gone", "d1"] }],
      decisions: [
        { decision_id: "d1", tool: "t1", order_id: null, verdict: "ALLOW", reason_codes: [] },
        { decision_id: "d2", tool: "t2", order_id: null, verdict: "ALLOW", reason_codes: [] },
      ],
    });
    expect(h[0]!.decisions!.map((d) => d.tool)).toEqual(["t2", "t1"]);
  });
});
