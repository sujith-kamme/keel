import type { Extraction } from "@keel/core";
import type { LedgerContent, ReplyInput, TurnDecision } from "@keel/engine";
import { decideReply } from "@keel/engine";
import type { ExtractInput } from "@keel/extractor";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { merchantAuth } from "./merchant-auth";

export const KNOWN_POLICY_IDS = ["refund-standard", "discount-goodwill", "policy-returns", "policy-bereavement", "policy-shipping"];

export interface GuardOptions {
  merchantKey: string;
  session: (id: string) => Promise<{ id: string; state: string; expires_at: string } | null>;
  /** Only ledger rows belonging to this session. */
  turnDecisions: (sessionId: string, ids: string[]) => Promise<TurnDecision[]>;
  /** The active approved policy JSON, or null. */
  policy: (policyId: string) => Promise<unknown>;
  extract: (input: ExtractInput) => Promise<Extraction>;
  appendLedger: (content: LedgerContent) => Promise<unknown>;
  extractor: { model: string; prompt_version: string };
  now: () => Date;
  newId: (prefix: string) => string;
}

const Guard = z.strictObject({
  session_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  draft_reply: z.string().min(1).max(4000),
  conversation: z.array(z.strictObject({ role: z.enum(["customer", "agent"]), text: z.string().max(4000) })).max(50),
  tool_calls_this_turn: z.array(z.string().regex(/^dec_[A-Za-z0-9]{1,64}$/)).max(10),
});

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/** Fail closed: a missing, malformed or throwing lookup yields null, which decideReply blocks. */
async function lookup(opts: GuardOptions, id: string): Promise<{ approved_text: string } | null> {
  if (!KNOWN_POLICY_IDS.includes(id)) return null;
  try {
    const policy = await opts.policy(id);
    const text = typeof policy === "object" && policy !== null ? (policy as { approved_text?: unknown }).approved_text : undefined;
    return typeof text === "string" ? { approved_text: text } : null;
  } catch {
    return null;
  }
}

/** Word path: checks an agent's draft reply before the customer sees it (docs/FSD.md FR-EXT). */
export function mountGuard(app: Hono, opts: GuardOptions): void {
  const authorized = merchantAuth(opts.merchantKey);

  app.post("/v1/guard", async (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    const req = await body(c, Guard);
    if (!req) return c.json({ error: "invalid_request" }, 400);
    const session = await opts.session(req.session_id);
    if (!session || new Date(session.expires_at) <= opts.now()) return c.json({ error: "not_found" }, 404);

    const turn_decisions = await opts.turnDecisions(req.session_id, req.tool_calls_this_turn);
    const customer_message = req.conversation.findLast((t) => t.role === "customer")?.text ?? null;

    let extraction: Extraction | null = null;
    let extractor_error: string | undefined;
    const started = performance.now();
    try {
      extraction = await opts.extract({ draft: req.draft_reply, customer_message, policy_ids: KNOWN_POLICY_IDS });
    } catch (e) {
      extractor_error = e instanceof Error ? e.name : "UnknownError";
    }
    const latency_ms = Math.round(performance.now() - started);

    const policies: ReplyInput["policies"] = {};
    for (const id of new Set(extraction?.reply_commitments.map((m) => m.policy_id).filter((p) => p !== undefined))) {
      policies[id] = await lookup(opts, id);
    }

    const input: ReplyInput = { draft: req.draft_reply, extraction, turn_decisions, policies };
    const result = decideReply(input);
    const decision_id = opts.newId("dec");
    await opts.appendLedger({
      decision_id,
      session_id: req.session_id,
      order_id: null,
      capture_id: null,
      dispute_id: null,
      mode: "LIVE",
      verdict: result.verdict,
      reason_codes: result.reason_codes,
      payload: {
        tool: "guard",
        input,
        result,
        extractor: { ...opts.extractor, latency_ms },
        ...(extractor_error ? { extractor_error } : {}),
      },
    });
    return c.json({ verdict: result.verdict, reason_codes: result.reason_codes, final_reply: result.final_reply, decision_id, session_state: session.state });
  });
}
