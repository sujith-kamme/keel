import type { Extraction } from "@keel/core";
import type { LedgerContent, ReplyInput, TurnDecision } from "@keel/engine";
import { QUARANTINE_TEMPLATE, SAFE_FALLBACK, decideReply } from "@keel/engine";
import type { ExtractInput, ExtractorModel } from "@keel/extractor";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { ledgerMode } from "../mode";
import { within } from "../within";
import { merchantAuth } from "./merchant-auth";

/** The settings read is a cached DB read; one that hangs this long fails closed. */
const SETTINGS_READ_MS = 1000;

export const KNOWN_POLICY_IDS = ["refund-standard", "discount-goodwill", "policy-returns", "policy-bereavement", "policy-shipping"];

export interface GuardOptions {
  merchantKey: string;
  session: (id: string) => Promise<{ id: string; state: string; agent_id: string; expires_at: string } | null>;
  /** Only ledger rows belonging to this session. */
  turnDecisions: (sessionId: string, ids: string[]) => Promise<TurnDecision[]>;
  /** Executed refund/discount ALLOWs from this session, which may back a restated commitment. */
  sessionDecisions: (sessionId: string, excludeIds: string[]) => Promise<TurnDecision[]>;
  /** The active approved policy JSON, or null. */
  policy: (policyId: string) => Promise<unknown>;
  control: (sessionId: string) => Promise<{ state: string; agent_frozen: boolean; score: number; mode: string; guard_mode: string }>;
  assess: (sessionId: string) => Promise<{ score: number; quarantined: boolean }>;
  /** Runs the extractor with the config `extractor()` returned for this call. */
  extract: (input: ExtractInput, cfg: { model: ExtractorModel; timeout_ms: number }) => Promise<Extraction>;
  appendLedger: (content: LedgerContent) => Promise<unknown>;
  /** Read per call: the ledger stamp names the model that call used. */
  extractor: () => Promise<{ model: ExtractorModel; prompt_version: string; timeout_ms: number }>;
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

    let ctl: Awaited<ReturnType<GuardOptions["control"]>>;
    try {
      ctl = await opts.control(req.session_id);
    } catch {
      const decision_id = opts.newId("dec");
      await opts.appendLedger({
        decision_id,
        session_id: req.session_id,
        order_id: null,
        capture_id: null,
        dispute_id: null,
        mode: "LIVE",
        verdict: "BLOCK",
        reason_codes: ["VERIFIER_UNAVAILABLE"],
        payload: { tool: "guard", agent_id: session.agent_id, draft: req.draft_reply, control_error: true },
      });
      return c.json({ verdict: "BLOCK", reason_codes: ["VERIFIER_UNAVAILABLE"], final_reply: SAFE_FALLBACK, decision_id, session_state: session.state, shadow: false });
    }
    const shadow = ctl.guard_mode === "SHADOW";
    // A shadow guard records the real decision but lets the agent's draft through.
    const held = (decision_id: string) =>
      c.json({
        verdict: "HOLD",
        reason_codes: ["RISK_THRESHOLD"],
        final_reply: shadow ? req.draft_reply : QUARANTINE_TEMPLATE,
        decision_id,
        session_state: "QUARANTINED",
        shadow,
      });
    const hold = async (risk_score: number) => {
      const decision_id = opts.newId("dec");
      await opts.appendLedger({
        decision_id,
        session_id: req.session_id,
        order_id: null,
        capture_id: null,
        dispute_id: null,
        mode: ledgerMode(ctl.mode, "QUARANTINED"),
        verdict: "HOLD",
        reason_codes: ["RISK_THRESHOLD"],
        payload: { tool: "guard", agent_id: session.agent_id, draft: req.draft_reply, quarantined: true, risk_score },
      });
      return held(decision_id);
    };
    if (ctl.state === "QUARANTINED") return hold(ctl.score);

    const turn_decisions = await opts.turnDecisions(req.session_id, req.tool_calls_this_turn);
    // Fail closed: a failed lookup means fewer backings, so more blocking.
    let session_decisions: TurnDecision[] = [];
    try {
      session_decisions = await opts.sessionDecisions(req.session_id, req.tool_calls_this_turn);
    } catch {
      console.error("session decisions lookup failed", req.session_id);
    }
    const customer_message = req.conversation.findLast((t) => t.role === "customer")?.text ?? null;

    // A failed or hung settings read is an extractor failure: fail closed like any other.
    let extractor: { model: string | null; prompt_version: string | null } = { model: null, prompt_version: null };
    let extraction: Extraction | null = null;
    let extractor_error: string | undefined;
    const started = performance.now();
    try {
      const { timeout_ms, ...stamp } = await within(opts.extractor(), SETTINGS_READ_MS);
      extractor = stamp;
      extraction = await opts.extract({ draft: req.draft_reply, customer_message, policy_ids: KNOWN_POLICY_IDS }, { model: stamp.model, timeout_ms });
    } catch (e) {
      extractor_error = e instanceof Error ? e.name : "UnknownError";
    }
    const latency_ms = Math.round(performance.now() - started);

    // Any policy claim loads every known policy: the extractor may leave policy_id out,
    // and decideReply then backs the claim by whichever approved text the draft quotes.
    // Ids outside KNOWN_POLICY_IDS are recorded as null so the claim still blocks.
    const commitments = extraction?.reply_commitments ?? [];
    const ids = commitments.some((m) => m.type === "POLICY_CLAIM") ? KNOWN_POLICY_IDS : [];
    const policies: ReplyInput["policies"] = {};
    for (const id of new Set([...ids, ...commitments.flatMap((m) => (m.policy_id === undefined ? [] : [m.policy_id]))])) {
      policies[id] = await lookup(opts, id);
    }

    const input: ReplyInput = { draft: req.draft_reply, extraction, turn_decisions, session_decisions, policies };
    const result = decideReply(input);
    const decision_id = opts.newId("dec");
    await opts.appendLedger({
      decision_id,
      session_id: req.session_id,
      order_id: null,
      capture_id: null,
      dispute_id: null,
      mode: ledgerMode(ctl.mode, ctl.state),
      verdict: result.verdict,
      reason_codes: result.reason_codes,
      payload: {
        tool: "guard",
        agent_id: session.agent_id,
        input,
        result,
        extractor: { ...extractor, latency_ms },
        ...(extractor_error ? { extractor_error } : {}),
        risk_score: ctl.score,
      },
    });
    let risk: Awaited<ReturnType<GuardOptions["assess"]>> | null = null;
    try {
      risk = await opts.assess(req.session_id);
    } catch {
      console.error("risk assess failed", req.session_id);
    }
    // The guard row above records the draft's verdict; the reply sent is the quarantine one.
    if (risk?.quarantined) return hold(risk.score);
    return c.json({
      verdict: result.verdict,
      reason_codes: result.reason_codes,
      final_reply: shadow ? req.draft_reply : result.final_reply,
      decision_id,
      session_state: session.state,
      shadow,
    });
  });
}
