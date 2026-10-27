import type { Extraction } from "@keel/core";
import { type LedgerContent, type TurnDecision, replayReply } from "@keel/engine";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type GuardOptions, KNOWN_POLICY_IDS, mountGuard } from "./guard";

const merchantKey = "m".repeat(32);
const now = new Date("2026-10-27T12:00:00Z");
const headers = { authorization: `Bearer ${merchantKey}`, "content-type": "application/json" };
const APPROVED = "Bereavement fares must be requested within 90 days.";

const extraction = (commitments: unknown[]): Extraction =>
  ({ reply_commitments: commitments, injection_signals: [], pii_mentions: [] }) as Extraction;
const empty = extraction([]);

function setup(over: Partial<GuardOptions> = {}) {
  const ledger: LedgerContent[] = [];
  const calls = { turnDecisions: [] as [string, string[]][], extract: [] as unknown[], policy: [] as string[] };
  const opts: GuardOptions = {
    merchantKey,
    session: async (id) =>
      id === "ses_live"
        ? { id, state: "ACTIVE", expires_at: "2026-10-27T12:30:00.000Z" }
        : id === "ses_old"
          ? { id, state: "ACTIVE", expires_at: "2026-10-27T12:00:00.000Z" }
          : null,
    turnDecisions: async (sid, ids) => {
      calls.turnDecisions.push([sid, ids]);
      return [];
    },
    policy: async (id) => {
      calls.policy.push(id);
      return id === "policy-bereavement" ? { id, approved_text: APPROVED } : null;
    },
    extract: async (input) => {
      calls.extract.push(input);
      return empty;
    },
    appendLedger: async (c) => void ledger.push(c),
    extractor: { model: "claude-haiku-5-5", prompt_version: "v1" },
    now: () => now,
    newId: (p) => `${p}_abc123`,
    ...over,
  };
  const app = new Hono();
  mountGuard(app, opts);
  return { app, ledger, calls };
}

const valid = { session_id: "ses_live", draft_reply: "Hello there", conversation: [], tool_calls_this_turn: [] };
const post = (app: Hono, body: unknown, h: Record<string, string> = headers) =>
  app.request("/v1/guard", { method: "POST", headers: h, body: JSON.stringify(body) });

describe("POST /v1/guard", () => {
  it("rejects a missing or wrong merchant key", async () => {
    const { app } = setup();
    for (const h of [{}, { authorization: `Bearer ${"x".repeat(32)}` }] as Record<string, string>[]) {
      const res = await post(app, valid, h);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  it.each([
    ["missing draft", { ...valid, draft_reply: undefined }],
    ["long draft", { ...valid, draft_reply: "a".repeat(4001) }],
    ["bad decision id", { ...valid, tool_calls_this_turn: ["nope"] }],
    ["extra key", { ...valid, extra: 1 }],
  ])("rejects %s", async (_n, body) => {
    const { app } = setup();
    const res = await post(app, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it.each(["ses_nope", "ses_old"])("returns 404 for %s", async (session_id) => {
    const { app, ledger } = setup();
    const res = await post(app, { ...valid, session_id });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(ledger).toHaveLength(0);
  });

  it("rewrites an unapproved bereavement claim, records one replayable entry", async () => {
    const { app, ledger } = setup({
      extract: async () => extraction([{ type: "POLICY_CLAIM", quoted_text: "full refund", policy_id: "policy-bereavement" }]),
    });
    const res = await post(app, { ...valid, draft_reply: "We give a full refund for bereavement." });
    const out = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(out).toMatchObject({ verdict: "REWRITE", reason_codes: ["POLICY_UNAPPROVED_CLAIM"], decision_id: "dec_abc123", session_state: "ACTIVE" });
    expect(out.final_reply).toContain(APPROVED);
    expect(ledger).toHaveLength(1);
    const p = ledger[0]!.payload as { tool: string; input: never; result: never };
    expect(p.tool).toBe("guard");
    expect(ledger[0]).toMatchObject({ decision_id: "dec_abc123", session_id: "ses_live", mode: "LIVE", verdict: "REWRITE" });
    expect(replayReply({ input: p.input, result: p.result }).same).toBe(true);
  });

  it("blocks a free-text refund", async () => {
    const { app } = setup({ extract: async () => extraction([{ type: "REFUND", quoted_text: "I'll refund you" }]) });
    const out = (await (await post(app, valid)).json()) as Record<string, unknown>;
    expect(out).toMatchObject({ verdict: "BLOCK", reason_codes: ["FREE_TEXT_COMMITMENT"] });
  });

  it("allows a refund backed by a same-session offer_refund", async () => {
    const ids = ["dec_one"];
    const backing: TurnDecision = { tool: "offer_refund", verdict: "ALLOW", args: { amount: "10.00" } };
    const { app, calls } = setup({
      turnDecisions: async (sid, got) => {
        calls.turnDecisions.push([sid, got]);
        return [backing];
      },
      extract: async () => extraction([{ type: "REFUND", quoted_text: "refund $10", amount: { value: "10.00", currency: "USD" } }]),
    });
    const out = (await (await post(app, { ...valid, draft_reply: "I refunded $10.", tool_calls_this_turn: ids })).json()) as Record<string, unknown>;
    expect(out).toMatchObject({ verdict: "ALLOW", final_reply: "I refunded $10." });
    expect(calls.turnDecisions).toEqual([["ses_live", ids]]);
  });

  it("fails closed when the extractor throws", async () => {
    const { app, ledger } = setup({
      extract: async () => {
        throw new TypeError("secret detail");
      },
    });
    const out = (await (await post(app, valid)).json()) as Record<string, unknown>;
    expect(out).toMatchObject({ verdict: "BLOCK", reason_codes: ["EXTRACTOR_UNAVAILABLE"] });
    expect(ledger).toHaveLength(1);
    expect((ledger[0]!.payload as { extractor_error: string }).extractor_error).toBe("TypeError");
  });

  it("fails closed when a policy lookup throws", async () => {
    const { app } = setup({
      policy: async () => {
        throw new Error("db down");
      },
      extract: async () => extraction([{ type: "POLICY_CLAIM", quoted_text: "x", policy_id: "policy-bereavement" }]),
    });
    const out = (await (await post(app, valid)).json()) as Record<string, unknown>;
    expect(out).toMatchObject({ verdict: "BLOCK", reason_codes: ["FREE_TEXT_COMMITMENT"] });
  });

  it("does not look up unknown policy ids", async () => {
    const { app, calls } = setup({
      extract: async () => extraction([{ type: "POLICY_CLAIM", quoted_text: "x", policy_id: "made-up" }]),
    });
    const out = (await (await post(app, valid)).json()) as Record<string, unknown>;
    expect(out.verdict).toBe("BLOCK");
    expect(calls.policy).not.toContain("made-up");
  });

  it("loads every known policy when the reply has a policy claim, and none otherwise", async () => {
    const withClaim = setup({ extract: async () => extraction([{ type: "POLICY_CLAIM", quoted_text: "x" }]) });
    await post(withClaim.app, valid);
    expect([...withClaim.calls.policy].sort()).toEqual([...KNOWN_POLICY_IDS].sort());
    const without = setup({ extract: async () => extraction([]) });
    await post(without.app, valid);
    expect(without.calls.policy).toEqual([]);
  });

  it("records extractor metadata and passes the last customer message", async () => {
    const { app, ledger, calls } = setup();
    const conversation = [
      { role: "customer", text: "first" },
      { role: "agent", text: "reply" },
      { role: "customer", text: "second" },
      { role: "agent", text: "again" },
    ];
    await post(app, { ...valid, conversation });
    await post(app, { ...valid, conversation: [{ role: "agent", text: "hi" }] });
    expect(calls.extract).toEqual([
      { draft: "Hello there", customer_message: "second", policy_ids: KNOWN_POLICY_IDS },
      { draft: "Hello there", customer_message: null, policy_ids: KNOWN_POLICY_IDS },
    ]);
    const meta = (ledger[0]!.payload as { extractor: { model: string; prompt_version: string; latency_ms: number } }).extractor;
    expect(meta).toMatchObject({ model: "claude-haiku-5-5", prompt_version: "v1" });
    expect(typeof meta.latency_ms).toBe("number");
  });

  it("takes session_state from the session row", async () => {
    const { app } = setup({ session: async (id) => ({ id, state: "HELD", expires_at: "2026-10-27T12:30:00.000Z" }) });
    expect(((await (await post(app, valid)).json()) as { session_state: string }).session_state).toBe("HELD");
  });
});
